import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { apply, Config } from '../plugin/index.mjs';
const fake = fileURLToPath(new URL('./fixtures/fake-codex.mjs', import.meta.url));
function harness(mode = 'success', config = {}) {
    let provider, ended = false;
    const commands = new Map();
    const warnings = [];
    const skillFactories = [];
    const ctx = {
        tools: {
            register: ()=>()=>{}
        },
        skills: {
            registerProvider: (f)=>skillFactories.push(f)
        },
        logger: {
            warn: (s)=>warnings.push(s)
        },
        get: (n)=>undefined,
        inject: (_s, fn)=>fn(ctx),
        commands: {
            register: (c)=>commands.set(c.name, c)
        },
        subagents: {
            registerProvider: (p)=>{
                provider = p;
            }
        },
        subprocess: {
            spawn (spec) {
                const child = spawn(spec.argv[0], spec.argv.slice(1), {
                    cwd: spec.cwd,
                    env: {
                        ...process.env,
                        ...spec.env,
                        FAKE_CODEX_MODE: mode
                    },
                    windowsHide: true,
                    stdio: [
                        'pipe',
                        'pipe',
                        'pipe'
                    ]
                });
                const done = new Promise((resolve, reject)=>{
                    child.once('error', reject);
                    child.once('close', (code, signal)=>{
                        ended = true;
                        resolve({
                            exitCode: code,
                            signal
                        });
                    });
                });
                return {
                    stdin: child.stdin,
                    stdout: child.stdout,
                    stderr: child.stderr,
                    done,
                    terminate () {
                        child.kill();
                    },
                    async waitForExit () {
                        await done;
                        return true;
                    }
                };
            }
        }
    };
    apply(ctx, {
        codexPath: fake,
        timeoutSeconds: 10,
        ...config
    });
    return {
        ctx,
        commands,
        warnings,
        skillFactories,
        get provider () {
            return provider;
        },
        get ended () {
            return ended;
        }
    };
}
async function run(h) {
    const c = new AbortController();
    return h.provider.start({
        cwd: process.cwd(),
        prompt: [
            {
                type: 'text',
                text: 'Only this offline task'
            }
        ],
        signal: c.signal
    });
}
test('single bundle registers a unique official-based provider and attachment-aware command', ()=>{
    const h = harness();
    assert.equal(h.provider.name, 'codex-eyes-hands');
    assert.equal(h.commands.get('codex').input.attachments, true);
    assert.ok(Config);
});
test('official wire completes via real stdio framing and releases process', async ()=>{
    const h = harness();
    const job = await run(h);
    const r = await job.result;
    assert.equal(r.stopReason, 'completed');
    assert.equal(r.output[0].text, 'OFFLINE_VERIFIED_RESULT');
    await job.dispose();
    assert.equal(h.ended, true);
});
test('an empty completed answer is not success', async ()=>{
    const h = harness('empty');
    const job = await run(h);
    const r = await job.result;
    assert.notEqual(r.stopReason, 'completed');
    await job.dispose();
});
test('provider failure is not success and diagnostics do not echo child secrets', async ()=>{
    const h = harness('error');
    const job = await run(h);
    const r = await job.result;
    assert.notEqual(r.stopReason, 'completed');
    assert.ok(!JSON.stringify(r).includes('PRIVATE_TEST_SECRET_DO_NOT_LOG'));
    assert.ok(!h.warnings.join('').includes('PRIVATE_TEST_SECRET_DO_NOT_LOG'));
    await job.dispose();
});
test('disposing one hung activation cancels and releases its child', async ()=>{
    const h = harness('hang');
    const job = await run(h);
    await job.dispose();
    const r = await job.result;
    assert.notEqual(r.stopReason, 'completed');
    assert.equal(h.ended, true);
});
test('a timeout ends a hung child instead of claiming completion', async ()=>{
    const h = harness('hang', {
        timeoutSeconds: 1
    });
    const job = await run(h);
    const r = await job.result;
    assert.notEqual(r.stopReason, 'completed');
    await job.dispose();
    assert.equal(h.ended, true);
});
test('/codex doctor does not start a model task', async ()=>{
    const h = harness();
    const r = await h.commands.get('codex').handler({
        rawInput: 'doctor',
        attachments: []
    });
    assert.equal(r.kind, 'success');
    assert.ok(r.text.includes('未调用模型'));
    assert.equal(h.ended, false);
});
test('attachment command delegates to the correct parent with no image blocks sent to text model', async ()=>{
    const h = harness();
    let spec;
    h.ctx.subagents.startActivation = async (s)=>{
        spec = s;
        return {
            name: 'lead/agent-1',
            result: Promise.resolve({})
        };
    };
    h.ctx.get = ()=>({
            imageHostPath: ()=>fake
        });
    const parent = {
        id: 'parent-a'
    };
    const r = await h.commands.get('codex').handler({
        rawInput: '看图',
        attachments: [
            {
                type: 'image',
                attachment: {}
            }
        ],
        agent: parent,
        signal: new AbortController().signal
    });
    assert.equal(r.kind, 'success');
    assert.equal(spec.parent, parent);
    assert.equal(spec.delivery, 'parent');
    assert.equal(spec.prompt[0].type, 'text');
    assert.ok(spec.prompt[0].text.includes(JSON.stringify(fake)));
});
test('a bad attachment does not launch any child', async ()=>{
    const h = harness();
    let called = false;
    h.ctx.subagents.startActivation = async ()=>{
        called = true;
    };
    const r = await h.commands.get('codex').handler({
        rawInput: '看图',
        attachments: [
            {
                type: 'image',
                attachment: {}
            }
        ],
        agent: {},
        signal: new AbortController().signal
    });
    assert.equal(r.kind, 'error');
    assert.equal(called, false);
});
test('bundled safe Skill is served without changing legacy files', async ()=>{
    const h = harness();
    const provider = h.skillFactories[0]();
    const [candidate] = await provider.list();
    assert.equal(candidate.name, 'codex-bridge');
    const skill = await provider.get(candidate, {});
    assert.ok(skill.content.includes('不替用户宣称全权授权'));
    assert.ok(skill.content.includes('codex_task'));
    assert.ok(skill.path.endsWith('SKILL.md'));
});
