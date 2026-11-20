// Adapted from DeepSeek Harness; MIT, Copyright (c) 2026 DeepSeek. See vendor/deepseek-subagent-codex/LICENSE.
import { resolveCodexCommand } from '../resolve-codex.mjs';
import { randomUUID } from 'node:crypto';
import { brandString } from '@deepseek-ai/dsh-brand';
import { settleRunResult, subprocessRunHandle } from '@deepseek-ai/dsh-subagent';
import { CodexAppServerWire } from './wire.mjs';
export const DEFAULT_DISPOSE_GRACE_MS = 3_000;
export const CODEX_PERMISSION_MODES = [
    'never',
    'approve-for-me',
    'dangerously-bypass-approvals-and-sandbox'
];
export const DEFAULT_CODEX_PERMISSION_MODE = 'never';
function failureDiagnostic(facts) {
    const fields = [
        'product: Codex',
        `stage: ${facts.stage}`,
        `category: ${facts.category}`
    ];
    if (facts.httpStatus !== undefined) {
        fields.push(`HTTP status: ${facts.httpStatus}`);
    }
    const processFields = [
        [
            'exit code',
            facts.outcome?.exitCode
        ],
        [
            'signal',
            facts.outcome?.signal
        ]
    ];
    for (const [label, value] of processFields){
        if (value !== null && value !== undefined) fields.push(`${label}: ${value}`);
    }
    return `Product subagent failure (${fields.join('; ')})`;
}
class CodexRunFailure extends Error {
    facts;
    constructor(facts, cause){
        super(`subagent-codex: ${failureDiagnostic(facts)}`, cause === undefined ? undefined : {
            cause
        }), this.facts = facts;
        this.name = 'CodexRunFailure';
    }
}
export function codexStartupFailure(cause) {
    return new CodexRunFailure({
        stage: 'initialize',
        category: 'unknown'
    }, cause);
}
export function codexAppServerArgv(codexPath) {
    return [
        ...resolveCodexCommand({
            codexPath
        }),
        'app-server',
        '--stdio'
    ];
}
function thrown(value) {
    return value instanceof Error ? value : new Error(String(value));
}
export function textTask(prompt) {
    if (prompt.length === 0) {
        throw new Error('subagent-codex: the one-shot task must contain only text blocks');
    }
    const texts = [];
    for (const block of prompt){
        if (block.type !== 'text') {
            throw new Error('subagent-codex: the one-shot task must contain only text blocks');
        }
        texts.push(block.text);
    }
    if (texts.every((text)=>text.trim().length === 0)) {
        throw new Error('subagent-codex: the one-shot task must not be empty');
    }
    return texts;
}
export async function disposeCodexChild(wire, child) {
    wire.close();
    let outcome;
    void child.done.then((value)=>{
        outcome = value;
    }, ()=>{});
    try {
        child.stdin?.end();
    } catch  {}
    child.terminate();
    try {
        await child.waitForExit();
    } catch (error) {
        throw new CodexRunFailure({
            stage: 'teardown',
            category: 'unknown',
            outcome
        }, thrown(error));
    }
    await child.done.catch(()=>{});
}
export async function startCodexRun(request, spec) {
    const timeout = Number(spec.env.CODEX_EYES_HANDS_TIMEOUT_MS ?? 900000);
    if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 86400000) throw new Error('Invalid Codex timeout');
    request = {
        ...request,
        signal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(timeout)
        ])
    };
    const texts = textTask(request.prompt);
    if (request.signal.aborted) {
        throw new Error('subagent-codex: request was aborted before app-server startup');
    }
    let child;
    try {
        child = spec.spawn({
            argv: codexAppServerArgv(spec.env.CODEX_EYES_HANDS_CODEX_PATH),
            cwd: spec.cwd,
            stdio: {
                stdin: 'pipe',
                stdout: 'pipe',
                stderr: 'pipe'
            },
            graceMs: spec.disposeGraceMs,
            env: spec.env
        });
    } catch (error) {
        throw new CodexRunFailure({
            stage: 'initialize',
            category: 'unknown'
        }, thrown(error));
    }
    const wire = new CodexAppServerWire(child.stdout, child.stdin, spec.permissionMode, spec.model);
    const onStderr = (chunk)=>{
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        try {
            void bytes;
        } catch  {}
    };
    const onStderrError = ()=>{};
    child.stderr?.on('data', onStderr);
    child.stderr?.on('error', onStderrError);
    const disposeProcess = async ()=>{
        try {
            await disposeCodexChild(wire, child);
            await new Promise((resolve)=>{
                setImmediate(resolve);
            });
        } finally{
            child.stderr?.off('data', onStderr);
            child.stderr?.off('error', onStderrError);
        }
    };
    let processFailureFacts;
    const processFailure = child.done.then((outcome)=>{
        processFailureFacts = {
            stage: 'process',
            category: 'process',
            outcome
        };
        throw new CodexRunFailure(processFailureFacts);
    }, (error)=>{
        processFailureFacts = {
            stage: 'process',
            category: 'unknown'
        };
        throw new CodexRunFailure(processFailureFacts, thrown(error));
    });
    processFailure.catch(()=>{});
    const runAbort = new AbortController();
    const requestCancel = ()=>{
        if (runAbort.signal.aborted) return;
        runAbort.abort(new Error('subagent-codex: run cancelled locally'));
        wire.interrupt();
    };
    const onAbort = ()=>{
        requestCancel();
    };
    request.signal.addEventListener('abort', onAbort, {
        once: true
    });
    let startupStage = 'initialize';
    try {
        wire.start();
        await Promise.race([
            wire.initialize(request.signal),
            processFailure
        ]);
        startupStage = 'thread-start';
        await Promise.race([
            wire.startThread(spec.cwd, request.signal),
            processFailure
        ]);
    } catch (error) {
        request.signal.removeEventListener('abort', onAbort);
        const cancelledBeforeCleanup = runAbort.signal.aborted;
        if (!(error instanceof CodexRunFailure) && !cancelledBeforeCleanup) {
            await new Promise((resolve)=>{
                setImmediate(resolve);
            });
        }
        const failure = new CodexRunFailure({
            stage: startupStage,
            category: 'unknown',
            outcome: error instanceof CodexRunFailure ? error.facts.outcome : processFailureFacts?.outcome
        }, thrown(error));
        try {
            await disposeProcess();
        } catch (disposeError) {
            const cleanupFailure = thrown(disposeError);
            throw new AggregateError([
                failure,
                cleanupFailure
            ], `${failure.message}; ${cleanupFailure.message}`);
        }
        if (cancelledBeforeCleanup) {
            throw new Error('subagent-codex: request was aborted before run publication');
        }
        try {
            request.signal.throwIfAborted();
        } catch  {
            throw new Error('subagent-codex: request was aborted before run publication');
        }
        throw failure;
    }
    const collectOutput = ()=>wire.collectOutput();
    let diagnostic;
    const recordFailureDiagnostic = (facts)=>{
        const failure = failureDiagnostic(facts);
        const permission = wire.collectDiagnostic();
        diagnostic = permission === undefined ? failure : `${failure}\n${permission}`;
        return diagnostic;
    };
    const withProcessOutcome = (facts)=>{
        const outcome = processFailureFacts?.outcome;
        return outcome === undefined ? facts : {
            ...facts,
            outcome
        };
    };
    const publishedProcessFailure = processFailure.catch(async (error)=>{
        await new Promise((resolve)=>{
            setImmediate(resolve);
        });
        throw error;
    });
    const result = settleRunResult({
        attempt: async ()=>{
            try {
                const terminal = await Promise.race([
                    wire.runTurn(texts, runAbort.signal),
                    publishedProcessFailure
                ]);
                if (terminal.stopReason === 'completed') return terminal;
                await new Promise((resolve)=>{
                    setImmediate(resolve);
                });
                const facts = withProcessOutcome(wire.collectFailure());
                return {
                    ...terminal,
                    diagnostic: recordFailureDiagnostic(facts)
                };
            } catch (error) {
                await new Promise((resolve)=>{
                    setImmediate(resolve);
                });
                const endedBeforeTerminal = wire.endedBeforeTerminal();
                if (endedBeforeTerminal && processFailureFacts === undefined && !runAbort.signal.aborted) {
                    try {
                        const exited = await child.waitForExit(AbortSignal.timeout(Math.ceil(spec.disposeGraceMs)));
                        if (exited) await child.done;
                    } catch  {}
                }
                const facts = error instanceof CodexRunFailure ? error.facts : endedBeforeTerminal && processFailureFacts !== undefined ? processFailureFacts : withProcessOutcome(wire.collectFailure());
                recordFailureDiagnostic(facts);
                throw error instanceof CodexRunFailure ? error : new CodexRunFailure(facts, thrown(error));
            }
        },
        collectOutput,
        collectDiagnostic: ()=>diagnostic,
        cancelled: ()=>runAbort.signal.aborted,
        onError: spec.onError,
        signal: request.signal,
        onAbort
    });
    return subprocessRunHandle({
        id: brandString(randomUUID()),
        result,
        signal: request.signal,
        onAbort,
        requestCancel,
        teardown: disposeProcess
    });
}
