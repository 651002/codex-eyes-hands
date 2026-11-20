// Adapted from DeepSeek Harness; MIT, Copyright (c) 2026 DeepSeek. See vendor/deepseek-subagent-codex/LICENSE.
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol';
const THREAD_PERMISSION_PARAMS = {
    never: {
        approvalPolicy: 'never',
        sandbox: 'workspace-write'
    },
    'approve-for-me': {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
        sandbox: 'workspace-write'
    },
    'dangerously-bypass-approvals-and-sandbox': {
        approvalPolicy: 'never',
        sandbox: 'danger-full-access'
    }
};
function object(value, label) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`subagent-codex: app-server returned invalid ${label}`);
    }
    return value;
}
function string(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`subagent-codex: app-server returned invalid ${label}`);
    }
    return value;
}
function unattendedDecision(params) {
    const available = params.availableDecisions;
    if (available === undefined || available === null) return 'decline';
    if (Array.isArray(available)) {
        if (available.includes('cancel')) return 'cancel';
        if (available.includes('decline')) return 'decline';
    }
    throw new Error('subagent-codex: app-server offered no unattended approval decision');
}
function numericHttpStatus(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65_535 ? value : undefined;
}
function objectFailureInfo(value) {
    const keys = Object.keys(value);
    const category = keys[0];
    if (keys.length !== 1 || category === undefined) {
        return {
            category: 'unknown'
        };
    }
    const detail = value[category];
    if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) {
        return {
            category: 'unknown'
        };
    }
    const fields = detail;
    switch(category){
        case 'httpConnectionFailed':
        case 'responseStreamConnectionFailed':
        case 'responseStreamDisconnected':
        case 'responseTooManyFailedAttempts':
            {
                const httpStatus = numericHttpStatus(fields.httpStatusCode);
                return httpStatus === undefined ? {
                    category: 'transport'
                } : {
                    category: 'transport',
                    httpStatus
                };
            }
        case 'activeTurnNotSteerable':
            return {
                category: 'product-error'
            };
        default:
            return {
                category: 'unknown'
            };
    }
}
function failureInfo(turn) {
    if (turn.status !== 'failed') return {
        category: 'unknown'
    };
    const error = turn.error;
    if (error === null || typeof error !== 'object' || Array.isArray(error)) {
        return {
            category: 'unknown'
        };
    }
    const info = error.codexErrorInfo;
    if (typeof info === 'string') {
        switch(info){
            case 'contextWindowExceeded':
                return {
                    category: 'limit',
                    maxTokens: true
                };
            case 'sessionBudgetExceeded':
            case 'usageLimitExceeded':
                return {
                    category: 'limit'
                };
            case 'serverOverloaded':
            case 'internalServerError':
                return {
                    category: 'service'
                };
            case 'cyberPolicy':
            case 'misalignmentPolicyViolation':
            case 'unauthorized':
                return {
                    category: 'access-policy'
                };
            case 'badRequest':
            case 'threadRollbackFailed':
            case 'other':
                return {
                    category: 'product-error'
                };
            case 'sandboxError':
                return {
                    category: 'access-policy',
                    sandboxFailure: true
                };
            default:
                return {
                    category: 'unknown'
                };
        }
    }
    return info !== null && typeof info === 'object' && !Array.isArray(info) ? objectFailureInfo(info) : {
        category: 'unknown'
    };
}
function unattendedDiagnostic(mode, request, decision, reason) {
    return `Codex unattended decision (mode: ${mode}; request: ${request}; decision: ${decision}): ${reason}`;
}
function thrown(value) {
    return value instanceof Error ? value : new Error(String(value));
}
function abortError(signal) {
    return signal.reason instanceof Error ? signal.reason : new Error(`subagent-codex: app-server request aborted: ${String(signal.reason)}`);
}
async function raceAbort(pending, signal) {
    if (signal.aborted) {
        void pending.catch(()=>{});
        throw abortError(signal);
    }
    let rejectAbort;
    const aborted = new Promise((_resolve, reject)=>{
        rejectAbort = reject;
    });
    const onAbort = ()=>{
        rejectAbort(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, {
        once: true
    });
    try {
        return await Promise.race([
            pending,
            aborted
        ]);
    } finally{
        signal.removeEventListener('abort', onAbort);
    }
}
export class CodexAppServerWire {
    input;
    permissionMode;
    model;
    vision;
    transport;
    fatal = Promise.withResolvers();
    threadId;
    turnId;
    pendingTurnId;
    turnCompleted;
    earlyTurnNotifications = [];
    lastFinalAnswer;
    lastPartialAnswer;
    lastUnphasedAnswer;
    diagnostic;
    failure;
    diagnosticOrder = 0;
    observationOrder = 0;
    pendingDiagnostic;
    inputEnded = false;
    terminalObserved = false;
    closed = false;
    constructor(input, output, permissionMode, model, vision){
        this.input = input;
        this.permissionMode = permissionMode;
        this.model = model;
        this.vision = vision;
        this.transport = new JsonRpcLineTransport(input, output);
        void this.fatal.promise.catch(()=>{});
        this.transport.onRequest((method, params)=>this.handleServerRequest(method, params));
        this.transport.onNotification((method, params)=>{
            try {
                this.handleNotification(method, params);
            } catch (error) {
                this.fail(thrown(error));
            }
        });
        this.input.on('error', this.onInputError);
        this.input.on('end', this.onInputEnd);
        output.on('error', this.onOutputError);
    }
    start() {
        this.transport.start();
    }
    endedBeforeTerminal() {
        return this.inputEnded && !this.terminalObserved;
    }
    async initialize(signal) {
        object(await this.guarded(this.transport.request('initialize', {
            clientInfo: {
                name: 'codex-eyes-hands',
                title: 'DSH Codex eyes and hands',
                version: '0.0.1'
            },
            capabilities: {
                experimentalApi: false,
                requestAttestation: false
            }
        }, signal), signal), 'initialize response');
        this.transport.notify('initialized');
        await this.guarded(this.transport.flush(), signal);
    }
    async startThread(cwd, signal) {
        const response = object(await this.guarded(this.transport.request('thread/start', {
            cwd,
            ephemeral: true,
            ...this.vision ? {
                sandbox: 'read-only',
                config: this.vision.config
            } : {},
            developerInstructions: 'You are a task executor delegated by DSH. Respect the task scope and Codex permissions. Prefer an available agent-desktop MCP for desktop control. Do not recursively invoke codex-eyes-hands or codex-bridge. Never claim user authorization that was not supplied. Report verified results, output paths, and limitations.',
            ...this.model === undefined ? {} : {
                model: this.model
            },
            ...this.vision ? {
                approvalPolicy: 'never'
            } : THREAD_PERMISSION_PARAMS[this.permissionMode]
        }, signal), signal), 'thread/start response');
        const thread = object(response.thread, 'thread/start thread');
        const id = string(thread.id, 'thread/start thread id');
        if (thread.ephemeral !== true) {
            throw new Error('subagent-codex: app-server did not create an ephemeral thread');
        }
        this.threadId = id;
    }
    async runTurn(texts, signal) {
        const completion = Promise.withResolvers();
        this.turnCompleted = completion;
        const threadId = this.threadId;
        try {
            const response = object(await this.guarded(this.transport.request('turn/start', {
                threadId,
                input: [
                    ...texts.map((text)=>({
                            type: 'text',
                            text,
                            text_elements: []
                        })),
                    ...this.vision?.images.map((path)=>({
                            type: 'localImage',
                            path
                        })) ?? []
                ],
                ...this.vision ? {
                    outputSchema: this.vision.schema
                } : {}
            }, signal), signal), 'turn/start response');
            const turn = object(response.turn, 'turn/start turn');
            this.commitTurnId(string(turn.id, 'turn/start turn id'));
        } catch (error) {
            this.recordFailure({
                stage: 'turn-start',
                category: 'unknown'
            });
            throw error;
        }
        let completed;
        let terminal;
        try {
            completed = await this.guarded(completion.promise, signal);
            terminal = object(completed.params.turn, 'turn/completed turn');
        } catch (error) {
            this.recordFailure({
                stage: 'turn',
                category: 'unknown'
            });
            throw error;
        }
        const status = terminal.status;
        if (status !== 'completed') {
            const parsed = failureInfo(terminal);
            this.recordFailure(parsed.httpStatus === undefined ? {
                stage: 'turn',
                category: parsed.category
            } : {
                stage: 'turn',
                category: parsed.category,
                httpStatus: parsed.httpStatus
            });
            if (parsed.sandboxFailure) {
                this.recordDiagnostic('sandbox execution', 'failed', 'Codex reported a sandbox failure', completed.order);
            }
            if (parsed.maxTokens) {
                return {
                    output: this.collectOutput(),
                    stopReason: 'max-tokens'
                };
            }
            const detail = status === 'failed' ? `: ${parsed.category}` : '';
            throw new Error(`subagent-codex: Codex turn ended with status ${String(status)}${detail}`);
        }
        const output = this.collectOutput();
        if (output.length === 0) {
            this.recordFailure({
                stage: 'turn',
                category: 'invalid-result'
            });
            throw new Error('subagent-codex: Codex completed without an answer');
        }
        return {
            output,
            stopReason: 'completed'
        };
    }
    interrupt() {
        if (this.threadId === undefined || this.turnId === undefined || this.closed) return;
        void this.transport.request('turn/interrupt', {
            threadId: this.threadId,
            turnId: this.turnId
        }).catch(()=>{});
    }
    collectOutput() {
        const selected = this.lastFinalAnswer ?? this.lastPartialAnswer ?? this.lastUnphasedAnswer;
        return selected !== undefined && selected.trim().length > 0 ? [
            {
                type: 'text',
                text: selected
            }
        ] : [];
    }
    collectDiagnostic() {
        return this.diagnostic;
    }
    collectFailure() {
        return this.failure;
    }
    close() {
        if (this.closed) return;
        this.closed = true;
        this.input.off('end', this.onInputEnd);
        this.transport.close();
    }
    async guarded(pending, signal) {
        const withFatal = Promise.race([
            this.fatal.promise,
            pending
        ]);
        return raceAbort(withFatal, signal);
    }
    fail(error) {
        this.fatal.reject(error);
    }
    onInputError = (error)=>{
        this.fail(error);
    };
    onOutputError = (error)=>{
        this.fail(error);
    };
    onInputEnd = ()=>{
        this.inputEnded = true;
        this.fail(new Error('subagent-codex: app-server protocol stream closed'));
    };
    observePendingTurnId(id) {
        if (this.turnCompleted === undefined) {
            throw new Error('subagent-codex: app-server referenced a turn before turn/start');
        }
        if (this.pendingTurnId !== undefined && this.pendingTurnId !== id) {
            throw new Error('subagent-codex: app-server referenced conflicting turns');
        }
        this.pendingTurnId = id;
    }
    commitTurnId(id) {
        if (this.pendingTurnId !== undefined && this.pendingTurnId !== id) {
            throw new Error('subagent-codex: turn/start response did not match the active turn');
        }
        this.turnId = id;
        const pendingDiagnostic = this.pendingDiagnostic;
        this.pendingDiagnostic = undefined;
        if (pendingDiagnostic !== undefined) {
            this.recordDiagnostic(pendingDiagnostic.request, pendingDiagnostic.decision, pendingDiagnostic.reason, pendingDiagnostic.order);
        }
        const notifications = this.earlyTurnNotifications.splice(0);
        for (const notification of notifications){
            this.handleNotification(notification.method, notification.params, notification.order);
        }
    }
    validateRunIds(params, nullableTurn = false) {
        if (params.threadId !== this.threadId) {
            throw new Error('subagent-codex: app-server request referenced another thread');
        }
        if (nullableTurn && params.turnId === null) return false;
        const id = string(params.turnId, 'server request turn id');
        if (this.turnId === undefined) {
            this.observePendingTurnId(id);
            return true;
        }
        if (id !== this.turnId) {
            throw new Error('subagent-codex: app-server request referenced another turn');
        }
        return false;
    }
    recordRequestDiagnostic(provisional, request, decision, reason) {
        const order = this.nextObservationOrder();
        if (provisional) {
            this.pendingDiagnostic = {
                order,
                request,
                decision,
                reason
            };
            return;
        }
        this.recordDiagnostic(request, decision, reason, order);
    }
    recordDiagnostic(request, decision, reason, order = this.nextObservationOrder()) {
        if (order < this.diagnosticOrder) return;
        this.diagnosticOrder = order;
        this.diagnostic = unattendedDiagnostic(this.permissionMode, request, decision, reason);
    }
    recordFailure(facts) {
        this.failure = facts;
    }
    nextObservationOrder() {
        this.observationOrder += 1;
        return this.observationOrder;
    }
    recordDeclinedItem(item, order) {
        if (item.type === 'commandExecution' && item.status === 'declined') {
            this.recordDiagnostic('command execution', 'declined', 'Codex declined the command under the selected permission mode', order);
            return true;
        }
        if (item.type === 'fileChange' && item.status === 'declined') {
            this.recordDiagnostic('file change', 'declined', 'Codex declined the file change under the selected permission mode', order);
            return true;
        }
        return false;
    }
    handleServerRequest(method, params) {
        try {
            switch(method){
                case 'item/commandExecution/requestApproval':
                    {
                        const provisional = this.validateRunIds(params);
                        const decision = unattendedDecision(params);
                        this.recordRequestDiagnostic(provisional, 'command approval', decision === 'cancel' ? 'cancelled' : 'declined', 'the provider does not grant interactive approval');
                        return Promise.resolve({
                            decision
                        });
                    }
                case 'item/fileChange/requestApproval':
                    {
                        const provisional = this.validateRunIds(params);
                        const decision = unattendedDecision(params);
                        this.recordRequestDiagnostic(provisional, 'file approval', decision === 'cancel' ? 'cancelled' : 'declined', 'the provider does not grant interactive approval');
                        return Promise.resolve({
                            decision
                        });
                    }
                case 'item/permissions/requestApproval':
                    this.recordRequestDiagnostic(this.validateRunIds(params), 'permission grant', 'denied', 'the provider grants no additional turn permissions');
                    return Promise.resolve({
                        permissions: {},
                        scope: 'turn'
                    });
                case 'item/tool/requestUserInput':
                    this.recordRequestDiagnostic(this.validateRunIds(params), 'user input', 'empty response', 'the provider does not collect interactive answers');
                    return Promise.resolve({
                        answers: {}
                    });
                case 'mcpServer/elicitation/request':
                    this.recordRequestDiagnostic(this.validateRunIds(params, true), 'MCP elicitation', 'declined', 'the provider does not collect interactive MCP input');
                    return Promise.resolve({
                        action: 'decline',
                        content: null,
                        _meta: null
                    });
                default:
                    throw new Error(`subagent-codex: unsupported app-server request ${JSON.stringify(method)}`);
            }
        } catch (error) {
            const normalized = thrown(error);
            this.fail(normalized);
            return Promise.reject(normalized);
        }
    }
    handleNotification(method, params, order) {
        if (method === 'turn/started') {
            const threadId = string(params.threadId, 'turn/started thread id');
            if (threadId !== this.threadId) return;
            const turn = object(params.turn, 'turn/started turn');
            if (this.turnCompleted !== undefined && this.turnId === undefined) {
                this.observePendingTurnId(string(turn.id, 'turn/started turn id'));
            }
            return;
        }
        if (method === 'item/completed') {
            const threadId = string(params.threadId, 'item/completed thread id');
            if (threadId !== this.threadId) return;
            const id = string(params.turnId, 'item/completed turn id');
            if (this.turnId === undefined) {
                if (this.turnCompleted !== undefined) {
                    this.observePendingTurnId(id);
                    this.earlyTurnNotifications.push({
                        method,
                        params,
                        order: this.nextObservationOrder()
                    });
                }
                return;
            }
            if (id !== this.turnId) return;
            const item = object(params.item, 'item/completed item');
            if (this.recordDeclinedItem(item, order)) return;
            if (item.type !== 'agentMessage') return;
            const text = typeof item.text === 'string' ? item.text : (()=>{
                throw new Error('subagent-codex: app-server returned an invalid agent message');
            })();
            if (item.phase === 'final_answer') {
                this.lastFinalAnswer = text;
            } else if (item.phase === 'partial_answer') {
                this.lastPartialAnswer = text;
            } else if (item.phase === null) {
                this.lastUnphasedAnswer = text;
            } else if (item.phase !== 'commentary') {
                throw new Error(`subagent-codex: app-server returned an unknown agent message phase ${JSON.stringify(item.phase)}`);
            }
            return;
        }
        if (method !== 'turn/completed') return;
        const threadId = string(params.threadId, 'turn/completed thread id');
        if (threadId !== this.threadId) return;
        const turn = object(params.turn, 'turn/completed turn');
        const id = string(turn.id, 'turn/completed turn id');
        const turnCompleted = this.turnCompleted;
        if (turnCompleted === undefined) return;
        if (this.turnId === undefined) {
            this.observePendingTurnId(id);
            this.earlyTurnNotifications.push({
                method,
                params,
                order: this.nextObservationOrder()
            });
            return;
        }
        if (id !== this.turnId) return;
        this.terminalObserved = true;
        if (![
            'completed',
            'interrupted',
            'failed'
        ].includes(String(turn.status))) {
            throw new Error(`subagent-codex: app-server returned invalid terminal turn status ${String(turn.status)}`);
        }
        turnCompleted.resolve({
            params,
            order: order ?? this.nextObservationOrder()
        });
    }
}
