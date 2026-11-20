import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { VisionCache } from './vision-cache.mjs';
import { VisionEngine } from './vision.mjs';
import { createImageProcessor } from './images.mjs';
import { createLocalOcr } from './local-ocr.mjs';
import { createCodexVision, visionFingerprint } from './codex-vision.mjs';
const require = createRequire(import.meta.url);
export function parseVisionCommand(raw) {
    const match = raw.trim().match(/^(see|ocr|diff|ocr-local)(?=\s|$)\s*([\s\S]*)$/);
    if (!match) return null;
    const mode = match[1] === 'ocr-local' ? 'ocr' : match[1];
    let rest = match[2], options = {
        mode,
        backend: match[1] === 'ocr-local' ? 'local-ocr' : 'codex'
    };
    rest = rest.replace(/(?:^|\s)--(crop|zoom|chunk-height)\s+(\S+)/g, (_m, key, value)=>{
        if (key === 'crop') {
            const parts = value.split(',').map(Number);
            if (parts.length !== 4 || !parts.every(Number.isInteger)) throw Error('--crop 需要 x,y,width,height 整数');
            options.crop = {
                x: parts[0],
                y: parts[1],
                width: parts[2],
                height: parts[3]
            };
        } else if (key === 'zoom') options.zoom = Number(value);
        else options.chunkHeight = Number(value);
        return ' ';
    });
    rest = rest.replace(/(?:^|\s)--no-cache(?=\s|$)/g, ()=>{
        options.cache = false;
        return ' ';
    });
    if (/(?:^|\s)--\S/.test(rest)) throw Error('未知视觉参数；支持 --crop、--zoom、--chunk-height、--no-cache');
    return {
        ...options,
        question: rest.trim() || undefined
    };
}
export function createVisionSurface(ctx, config) {
    let engine, processor;
    function imageProcessor() {
        if (processor) return processor;
        let sharp;
        try {
            const host = createRequire(require.resolve('@deepseek-ai/dsh-attachment-local'));
            sharp = host('sharp');
        } catch  {
            throw Error('当前 DSH 未提供 sharp 图像组件；不自动下载依赖。');
        }
        const dir = config.visionDataDir || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'cache/codex-eyes-hands');
        if (!path.isAbsolute(dir)) throw Error('visionDataDir 必须为绝对路径');
        processor = createImageProcessor({
            sharp,
            directory: path.join(dir, 'images')
        });
        return processor;
    }
    function visionEngine() {
        if (engine) return engine;
        const dir = config.visionDataDir || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'cache/codex-eyes-hands');
        engine = new VisionEngine({
            cache: new VisionCache({
                directory: path.join(dir, 'results'),
                ttlMs: (config.visionCacheHours ?? 24) * 3600000,
                maxEntries: config.visionCacheEntries ?? 128
            }),
            cacheEnabled: config.visionCacheEnabled !== false,
            prepare: (data, opts)=>imageProcessor().prepare(data, opts),
            fingerprint: (backend)=>visionFingerprint(config, backend),
            analyze: createCodexVision(ctx, config),
            localOcr: async (req)=>createLocalOcr({
                    executable: config.ocrPath,
                    language: config.ocrLanguage || 'eng'
                })(req)
        });
        return engine;
    }
    async function attachments(inv) {
        const out = [];
        const store = ctx.get('attachments');
        for (const b of inv.attachments){
            const p = b.type === 'image' ? store?.imageHostPath(b.attachment) : store?.fileHostPath(b.attachment);
            if (!p || !path.isAbsolute(p)) throw Error('图片附件没有本机可读路径');
            const s = fs.statSync(p);
            if (!s.isFile() || s.size > 52428800) throw Error('图片必须为不超过 50 MiB 的普通文件');
            out.push({
                data: fs.readFileSync(p),
                sourcePath: p
            });
        }
        return out;
    }
    return {
        async command (inv, parsed) {
            const inputs = await attachments(inv);
            if (parsed.mode === 'diff') {
                if (parsed.crop || parsed.zoom || parsed.chunkHeight || parsed.cache === false || parsed.question) throw Error('/codex diff 只接受两张图片，不接受识图参数');
                if (inputs.length !== 2) throw Error('/codex diff 需要恰好两张图片');
                return imageProcessor().diff(inputs[0].data, inputs[1].data, {
                    signal: inv.signal
                });
            }
            if (inputs.length !== 1) throw Error('/codex see、ocr、ocr-local 需要恰好一张图片；长图会自动分块');
            return visionEngine().analyze({
                ...parsed,
                ...inputs[0],
                scope: String(inv.agent.id),
                signal: inv.signal
            });
        },
        async tool (args, exec) {
            if (!exec.agent) throw Error('视觉工具需要当前 DSH 会话');
            const backend = ctx.get('fs');
            if (!backend) throw Error('当前会话没有文件读取服务');
            const cwd = await ctx.get('workingDirectory')?.ensure(exec.agent, exec.signal);
            const target = await backend.resolve(args.file_path, {
                cwd,
                signal: exec.signal
            });
            const info = await backend.stat(target, exec.signal);
            if (info?.type !== 'file') throw Error('图片路径不是普通文件');
            const data = Buffer.from(await backend.readBytes(target, exec.signal, 52428800));
            return visionEngine().analyze({
                scope: String(exec.agent.id),
                data,
                sourcePath: backend.processPath(target),
                mode: args.mode || 'see',
                backend: args.backend || 'codex',
                question: args.question,
                crop: args.crop,
                zoom: args.zoom,
                cache: args.cache,
                signal: exec.signal
            });
        }
    };
}
export function registerVisionTool(ctx, surface) {
    ctx.inject([
        'tools',
        'fs'
    ], (c)=>c.tools.register(defineTool({
            name: 'codex_vision',
            description: '仅识别图片、提取文字或检查局部细节，返回结构化文字、原图坐标、不确定项与本会话缓存来源。不执行电脑操作；已有原生视觉够用时不重复委派。',
            parameters: {
                file_path: {
                    type: 'string',
                    required: true,
                    description: '当前 DSH 文件系统可读取的图片路径。'
                },
                question: {
                    type: 'string',
                    description: '要检查的具体问题；换问题不会复用旧答案。'
                },
                mode: {
                    type: 'string',
                    enum: [
                        'see',
                        'ocr'
                    ]
                },
                backend: {
                    type: 'string',
                    enum: [
                        'codex',
                        'local-ocr'
                    ],
                    description: '默认 Codex；local-ocr 仅用于 ocr 且需用户配置已有 Tesseract。'
                },
                zoom: {
                    type: 'number',
                    description: '1 到 4 倍放大。'
                },
                crop: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        x: {
                            type: 'number',
                            required: true
                        },
                        y: {
                            type: 'number',
                            required: true
                        },
                        width: {
                            type: 'number',
                            required: true
                        },
                        height: {
                            type: 'number',
                            required: true
                        }
                    },
                    description: '原图像素坐标裁剪，x,y,width,height。'
                },
                cache: {
                    type: 'boolean',
                    description: 'false 强制重新识别，不影响电脑执行任务。'
                }
            },
            output: {
                schema: {
                    type: 'string'
                },
                render: (_args, value)=>[
                        {
                            type: 'text',
                            text: value
                        }
                    ]
            },
            isConcurrencySafe: ()=>true,
            execute: async (args, exec)=>JSON.stringify(await surface.tool(args, exec))
        })));
}
