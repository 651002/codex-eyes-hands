import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { apply as applyOfficial } from './upstream/index.mjs';
import { resolveCodexCommand } from './resolve-codex.mjs';
import { attachmentTask } from './attachments.mjs';
export const name = 'codex-eyes-hands';
export const inject = [
    'subagents',
    'subprocess'
];
export const Config = z.object({
    codexPath: z.string().description('已有 codex.exe 或 bin/codex.js 的绝对路径；留空自动查找，不安装第二份 Codex。'),
    model: z.string().description('留空沿用 Codex 自己选择的模型。'),
    permissionMode: z.union([
        'never',
        'approve-for-me',
        'dangerously-bypass-approvals-and-sandbox'
    ]).default('never').description('默认不扩大权限，使用 workspace-write；完全权限需用户明确选择。'),
    timeoutSeconds: z.number().min(1).max(86400).default(900),
    disposeGraceMs: z.number().min(1).max(30000).default(3000)
});
export function apply(ctx, config = {}) {
    const timeoutSeconds = config.timeoutSeconds ?? 900;
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 86400) throw Error('Invalid timeoutSeconds');
    applyOfficial(ctx, {
        providerName: 'codex-eyes-hands',
        model: config.model || undefined,
        permissionMode: config.permissionMode ?? 'never',
        disposeGraceMs: config.disposeGraceMs ?? 3000,
        env: {
            ELECTRON_RUN_AS_NODE: '1',
            CODEX_EYES_HANDS_TIMEOUT_MS: String(Math.round(timeoutSeconds * 1000)),
            ...config.codexPath ? {
                CODEX_EYES_HANDS_CODEX_PATH: config.codexPath
            } : {}
        }
    });
    ctx.inject([
        'skills'
    ], (c)=>{
        const skillPath = fileURLToPath(new URL('../SKILL.md', import.meta.url));
        const candidate = {
            name: 'codex-bridge',
            description: 'DSH 缺少能力或用户指定 Codex 时，用 codex_task 委派；图片/文件用 /codex。优先已有 DSH 工具，不递归调用自身。',
            invocation: {
                modelInvocable: true,
                userInvocable: true
            },
            provider: 'codex-eyes-hands',
            source: 'custom',
            rank: 300,
            locator: null
        };
        c.skills.registerProvider(()=>({
                name: candidate.provider,
                list: async ()=>[
                        candidate
                    ],
                get: async ()=>{
                    const { rank, locator, ...summary } = candidate;
                    return {
                        ...summary,
                        path: skillPath,
                        content: fs.readFileSync(skillPath, 'utf8'),
                        resourceBase: {
                            kind: 'directory',
                            path: fileURLToPath(new URL('../', import.meta.url))
                        }
                    };
                }
            }));
    });
    ctx.inject([
        'commands'
    ], (c)=>{
        c.commands.register({
            name: 'codex',
            description: '把任务和图片/文件交给 Codex，结果返回当前 DSH 会话；/codex doctor 检查入口。',
            input: {
                hint: '<任务> 或 doctor',
                attachments: true
            },
            async handler (inv) {
                if (inv.rawInput.trim() === 'doctor') {
                    if (inv.attachments.length) return {
                        kind: 'error',
                        text: 'doctor 不接受附件。'
                    };
                    try {
                        return {
                            kind: 'success',
                            text: JSON.stringify({
                                version: '2.0.0',
                                codex: resolveCodexCommand({
                                    codexPath: config.codexPath
                                }),
                                provider: 'codex-eyes-hands',
                                timeoutSeconds,
                                permissions: config.permissionMode ?? 'never',
                                note: '仅确认入口；未调用模型，未验证桌面操作。'
                            }, null, 2)
                        };
                    } catch (e) {
                        return {
                            kind: 'error',
                            text: e.message
                        };
                    }
                }
                try {
                    inv.signal.throwIfAborted();
                    const prompt = attachmentTask(inv.rawInput.trim(), inv.attachments, c.get('attachments'));
                    const started = await c.subagents.startActivation({
                        parent: inv.agent,
                        provider: 'codex-eyes-hands',
                        label: 'Codex: ' + inv.rawInput.trim().slice(0, 100),
                        prompt: [
                            {
                                type: 'text',
                                text: prompt
                            }
                        ],
                        signal: inv.signal,
                        delivery: 'parent'
                    });
                    void started.result.catch(()=>{});
                    return {
                        kind: 'success',
                        text: '已交给 Codex：' + started.name + '。这只是启动确认；最终结果会回到本会话。'
                    };
                } catch (e) {
                    return {
                        kind: 'error',
                        text: 'Codex 未启动：' + e.message
                    };
                }
            }
        });
    });
}
