import { defineTool } from '@deepseek-ai/dsh-tools';
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection';
import { createRequire } from 'node:module';
import { defineDomain } from '@deepseek-ai/dsh-storage-domain';
import { UpdateMonitor, initialMaintenanceState, startUpdateLoop } from './updates.mjs';
const require = createRequire(import.meta.url);
const hostRequire = createRequire(require.resolve('@deepseek-ai/dsh-storage-domain'));
const { z } = hostRequire('zod');
const stateSchema = z.object({
    version: z.literal(1),
    enabled: z.boolean(),
    intervalHours: z.number().int().min(1).max(720),
    lastAttempt: z.number().nullable(),
    lastSuccess: z.number().nullable(),
    nextDueAt: z.number(),
    lastError: z.string().nullable(),
    failures: z.number().int().nonnegative(),
    snapshots: z.record(z.string(), z.object({
        adopted: z.string(),
        head: z.string(),
        release: z.string().nullable(),
        checkedAt: z.number()
    })),
    notices: z.array(z.object({
        id: z.string(),
        kind: z.literal('review'),
        repo: z.string(),
        head: z.string(),
        release: z.string().nullable(),
        date: z.string().nullable(),
        url: z.string(),
        files: z.array(z.string()),
        incomplete: z.boolean(),
        reason: z.string(),
        acknowledged: z.boolean()
    })).max(12)
});
export const maintenanceDomain = defineDomain({
    name: 'codex_eyes_hands_maintenance',
    version: 1,
    tables: {},
    global: {
        schema: stateSchema,
        initial: initialMaintenanceState()
    }
});

export function createMaintenanceHandler({ monitor, ownerSignal }) {
    return async (endpoint, payload, signal, peer)=>{
        if (peer?.principal?.kind !== 'owner') return {
            ok: false,
            error: {
                code: 'forbidden',
                message: 'Only the authenticated owner may manage this plugin.',
                details: {}
            }
        };
        try {
            signal = ownerSignal ? signal ? AbortSignal.any([
                signal,
                ownerSignal
            ]) : ownerSignal : signal;
            signal?.throwIfAborted();
            let value;
            if (endpoint === 'summary') value = monitor.load();
            else if (endpoint === 'status') value = {
                updates: monitor.load(),
                pluginVersion: '2.4.3'
            };
            else if (endpoint === 'updates/check') value = await monitor.check(true, signal);
            else if (endpoint === 'updates/settings') value = await monitor.settings(payload ?? {});
            else if (endpoint === 'updates/acknowledge') value = await monitor.acknowledge();
            else throw Error('Unknown maintenance endpoint');
            return {
                ok: true,
                value
            };
        } catch (e) {
            return {
                ok: false,
                error: {
                    code: 'maintenance/error',
                    message: e instanceof Error ? e.message : '维护操作失败',
                    details: {}
                }
            };
        }
    };
}
export function installMaintenance(ctx) {
    let current;
    ctx.inject([
        'storageDomain',
        'connection'
    ], (c)=>{
        if (!c.storageDomain || !c.connection) return;
        c.effect(()=>{
            let domain, closed = false, unregister = async ()=>{}, stop = async ()=>{};
            const control = new AbortController();
            const ready = (async ()=>{
                domain = await c.storageDomain.open(maintenanceDomain);
                if (closed) return;
                const monitor = new UpdateMonitor({
                    load: ()=>domain.global.get(),
                    save: (s)=>domain.global.set(s)
                });
                current = {
                    monitor
                };
                const handler = createMaintenanceHandler({ monitor, ownerSignal: control.signal });
                const routes = ['summary', 'status', 'updates/check', 'updates/settings', 'updates/acknowledge'];
                const disposers = [];
                unregister = async () => { await Promise.all(disposers.splice(0).map(dispose => dispose())); };
                try {
                    for (const endpoint of routes) disposers.push(c.connection.fetch.register({
                        path: '/api/codex-eyes-hands/' + endpoint,
                        methods: ['POST'], requestBody: 'buffered',
                        async fetch(request) {
                            if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
                                return new Response('content type must be application/json', {status: 415});
                            }
                            let body;
                            try { body = await request.json(); } catch { return new Response('body is not JSON', {status: 400}); }
                            const parsed = clientRequestSchema.safeParse(body);
                            if (!parsed.success || parsed.data.method !== 'codex-eyes-hands/' + endpoint) return new Response('invalid RPC envelope', {status: 400});
                            // The native exact-route registry admits owner peers only before invoking this handler.
                            const result = await handler(endpoint, parsed.data.payload, request.signal, c.connection.browserPeer);
                            return Response.json({type: 'server-response', rpcId: parsed.data.rpcId, result});
                        },
                    }));
                } catch (error) { await unregister(); throw error; }
                stop = startUpdateLoop(monitor, {
                    signal: control.signal
                });
            })();
            void ready.catch(()=>{
                c.logger?.warn('Codex maintenance initialization failed; inspect plugin status.');
            });
            return async ()=>{
                closed = true;
                control.abort(new Error('Plugin unloaded'));
                await ready.catch(()=>{});
                const pending = current?.monitor.pending;
                current = undefined;
                await stop();
                await pending?.catch(()=>{});
                await unregister();
                await domain?.close();
            };
        });
    });
    ctx.inject([
        'tools'
    ], (c)=>{
        if (!c.tools) return;
        c.tools.register(defineTool({
            name: 'codex_status',
            description: '只读查看本插件的上游检查结果。不查看或管理DSH原生组件、不触发更新、不改检查周期。',
            parameters: {
                section: {
                    type: 'string',
                    enum: [
                        'updates'
                    ],
                    required: true
                }
            },
            output: {
                schema: {
                    type: 'string'
                },
                render: (_a, v)=>[
                        {
                            type: 'text',
                            text: v
                        }
                    ]
            },
            isConcurrencySafe: ()=>true,
            execute: async (args)=>{
                if (!current) throw Error('维护服务未就绪');
                return JSON.stringify(current.monitor.load());
            }
        }));
    });
    return {
        async command (inv) {
            const input = inv.rawInput.trim();
            if (/^features(?:\s|$)/.test(input)) return {kind:'error',text:'本插件已取消四项官方组件的内置与管理，请在DSH官方设置中操作。'};
            if (!/^updates(?:\s|$)/.test(input)) return null;
            if (!current) return {
                kind: 'error',
                text: '维护服务未就绪：需要DSH原生存储和认证连接。'
            };
            try {
                const parts = input.split(/\s+/);
                let result;
                if (parts.length === 1) result = current.monitor.load();
                else if (parts[1] === 'check' && parts.length === 2) result = await current.monitor.check(true, inv.signal);
                else if (parts[1] === 'ack' && parts.length === 2) result = await current.monitor.acknowledge();
                else if ([
                    'on',
                    'off'
                ].includes(parts[1]) && parts.length <= 3) result = await current.monitor.settings({
                    enabled: parts[1] === 'on',
                    intervalHours: parts[2] ? Number(parts[2]) : current.monitor.load().intervalHours
                });
                else throw Error('用法：/codex updates [check|ack|on [小时]|off]');
                return {
                    kind: 'success',
                    text: JSON.stringify(result, null, 2)
                };
            } catch (e) {
                return {
                    kind: 'error',
                    text: e.message
                };
            }
        }
    };
}
