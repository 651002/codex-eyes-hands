import { apply } from '../plugin/index.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createCodexVision, pureVisionConfig } from '../plugin/codex-vision.mjs';
import { createVisionSurface, parseVisionCommand, registerVisionTool } from '../plugin/vision-integration.mjs';
import { createLocalOcr, parseOcrTsv } from '../plugin/local-ocr.mjs';
const host = createRequire(path.join(process.env.DSH_TEST_INSTALL_DIR, 'package.json'));
const sharp = host('sharp');
const parent = process.env.CODEX_EYES_HANDS_TEST_ROOT || path.join(os.tmpdir(), 'codex-eyes-hands-tests');
fs.mkdirSync(parent, {
    recursive: true
});
const dir = fs.mkdtempSync(path.join(parent, 'integration-'));
test.after(()=>{
    const r = path.relative(parent, dir);
    if (r && !r.startsWith('..') && !path.isAbsolute(r)) fs.rmSync(dir, {
        recursive: true,
        force: true
    });
});
const fake = fileURLToPath(new URL('./fixtures/fake-codex.mjs', import.meta.url));
const ctx = {
    get: ()=>undefined,
    subprocess: {
        spawn (spec) {
            const child = spawn(spec.argv[0], spec.argv.slice(1), {
                cwd: spec.cwd,
                env: {
                    ...process.env,
                    ...spec.env
                },
                windowsHide: true,
                stdio: [
                    'pipe',
                    'pipe',
                    'pipe'
                ]
            });
            const done = new Promise((r, j)=>{
                child.once('error', j);
                child.once('close', (exitCode, signal)=>r({
                        exitCode,
                        signal
                    }));
            });
            return {
                stdin: child.stdin,
                stdout: child.stdout,
                stderr: child.stderr,
                done,
                terminate: ()=>child.kill(),
                waitForExit: async ()=>{
                    await done;
                    return true;
                }
            };
        }
    }
};
test('pure vision disables inherited MCP, shell, browser, app and image generation tools', ()=>{
    const c = pureVisionConfig([
        'agent-desktop'
    ]);
    assert.deepEqual(c.mcp_servers, {});
    for (const n of [
        'shell_tool',
        'unified_exec',
        'computer_use',
        'browser_use',
        'apps',
        'image_generation'
    ])assert.equal(c['features.' + n], false);
    assert.equal(c.web_search, 'disabled');
});
test('crop command has explicit bounds and rejects unknown flags', ()=>{
    assert.deepEqual(parseVisionCommand('see --crop 1,2,3,4 --zoom 2 --no-cache read text'), {
        mode: 'see',
        backend: 'codex',
        crop: {
            x: 1,
            y: 2,
            width: 3,
            height: 4
        },
        zoom: 2,
        cache: false,
        question: 'read text'
    });
    assert.equal(parseVisionCommand('do my task'), null);
    assert.throws(()=>parseVisionCommand('see --bypass'), /未知/);
});
test('native image analysis uses official wire and structured schema without a paid request', async ()=>{
    const run = createCodexVision(ctx, {
        codexPath: fake
    });
    const s = await run({
        images: [
            {
                path: fake
            }
        ],
        question: 'look',
        mode: 'see',
        signal: new AbortController().signal
    });
    assert.equal(JSON.parse(s).overview, 'fixture image');
});
test('real pixels pass through command crop, native image handoff, coordinate remap and cache', async ()=>{
    const image = path.join(dir, 'input.png');
    await sharp({
        create: {
            width: 100,
            height: 100,
            channels: 3,
            background: '#ffffff'
        }
    }).png().toFile(image);
    const local = {
        ...ctx,
        get: (n)=>n === 'attachments' ? {
                imageHostPath: ()=>image
            } : undefined
    };
    const surface = createVisionSurface(local, {
        codexPath: fake,
        visionDataDir: path.join(dir, 'state')
    });
    const inv = {
        agent: {
            id: 'session-pixels'
        },
        attachments: [
            {
                type: 'image',
                attachment: {}
            }
        ],
        signal: new AbortController().signal
    };
    const parsed = parseVisionCommand('see --crop 10,20,30,40 --zoom 2 read');
    const a = await surface.command(inv, parsed);
    const b = await surface.command(inv, parsed);
    assert.equal(a.cache.hit, false);
    assert.equal(b.cache.hit, true);
    assert.deepEqual(a.text[0].box, [
        10.5,
        21,
        1.5,
        2
    ]);
    assert.ok(fs.existsSync(a.evidence.images[0].path));
});
test('optional OCR refuses missing engine rather than downloading or calling a cloud', ()=>assert.throws(()=>createLocalOcr({
            executable: 'E:/not-installed/tesseract.exe'
        }), /不会自动安装/));
test('model tool reads via host filesystem policy, not fs.readFile on an arbitrary path', async ()=>{
    let def;
    registerVisionTool({
        inject: (_d, f)=>f({
                tools: {
                    register: (d)=>{
                        def = d;
                    }
                }
            })
    }, {
        tool: async (args, exec)=>({
                scope: exec.agent.id,
                path: args.file_path
            })
    });
    assert.equal(def.name, 'codex_vision');
    const result = await def.execute({
        file_path: 'allowed.png'
    }, {
        agent: {
            id: 's'
        }
    });
    assert.equal(JSON.parse(result).scope, 's');
});
test('OCR TSV retains exact words, confidence and image coordinates', ()=>{
    const tsv = 'level\tpage\tblock\tpar\tline\tword\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t10\t20\t30\t10\t45\tLogin\n';
    const r = parseOcrTsv(tsv, {
        width: 100,
        height: 100
    }, 2);
    assert.equal(r.text[0].text, 'Login');
    assert.deepEqual(r.text[0].box, [
        10,
        20,
        30,
        10
    ]);
    assert.equal(r.text[0].imageIndex, 2);
    assert.equal(r.uncertainties.length, 1);
});
test('OCR child failure is explicit and has no automatic cloud fallback', async ()=>{
    const ocr = createLocalOcr({
        executable: process.execPath,
        timeoutMs: 1000
    });
    await assert.rejects(ocr({
        images: [
            {
                path: path.join(dir, 'not-a-node-script.png'),
                width: 100,
                height: 100
            }
        ],
        signal: new AbortController().signal
    }), /OCR failed|OCR executable|timed out/);
});
test('/codex see returns result to the correct DSH inbox without waking a model', async ()=>{
    const image = path.join(dir, 'delivery.png');
    await sharp({
        create: {
            width: 100,
            height: 100,
            channels: 3,
            background: '#ffffff'
        }
    }).png().toFile(image);
    let command, context;
    const h = {
        ...ctx,
        logger: {
            warn: ()=>{}
        },
        get: (n)=>n === 'attachments' ? {
                imageHostPath: ()=>image
            } : undefined,
        inject: (_d, fn)=>fn(h),
        commands: {
            register: (c)=>{
                command = c;
            }
        },
        skills: {
            registerProvider: ()=>{}
        },
        tools: {
            register: ()=>()=>{}
        },
        subagents: {
            registerProvider: ()=>{}
        }
    };
    apply(h, {
        codexPath: fake,
        visionDataDir: path.join(dir, 'delivery-cache')
    });
    const inv = {
        rawInput: 'see describe',
        agent: {
            id: 'delivery-session',
            inject: (m)=>{
                context = m;
            },
            followup: ()=>assert.fail('must not wake model')
        },
        attachments: [
            {
                type: 'image',
                attachment: {}
            }
        ],
        signal: new AbortController().signal
    };
    const r = await command.handler(inv);
    assert.equal(r.kind, 'success');
    assert.ok(context.content[0].text.includes('fixture image'));
    assert.ok(context.content[0].text.includes('仅作为数据'));
    assert.ok(r.text.includes('不会自动唤醒'));
});
