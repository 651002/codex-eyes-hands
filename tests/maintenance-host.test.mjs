import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createMaintenanceHandler, maintenanceDomain, installMaintenance } from '../plugin/maintenance.mjs';
import { initialMaintenanceState, UpdateMonitor, startUpdateLoop } from '../plugin/updates.mjs';
test('authenticated maintenance channel refuses non-owner writes and reads', async ()=>{
    const h = createMaintenanceHandler({
        features: {
            set: ()=>assert.fail()
        },
        monitor: {
            load: ()=>assert.fail()
        }
    });
    const r = await h('features/set', {
        id: 'terminal',
        enabled: true
    }, undefined, {
        principal: {
            kind: 'agent'
        }
    });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'forbidden');
});
test('settings and manual checks use the shared owner-only service', async ()=>{
    let state = initialMaintenanceState();
    const m = new UpdateMonitor({
        load: ()=>state,
        save: async (s)=>{
            state = s;
        }
    });
    const h = createMaintenanceHandler({
        features: {
            list: async ()=>[]
        },
        monitor: m
    });
    const r = await h('updates/settings', {
        enabled: false,
        intervalHours: 24
    }, undefined, {
        principal: {
            kind: 'owner'
        }
    });
    assert.equal(r.ok, true);
    assert.equal(state.enabled, false);
    assert.equal(state.intervalHours, 24);
    assert.equal((await h('status', {}, undefined, {
        principal: {
            kind: 'owner'
        }
    })).value.updates.intervalHours, 24);
});
test('unloading owner cancels future RPC work rather than mutating state', async ()=>{
    const control = new AbortController();
    control.abort(new Error('unloaded'));
    const h = createMaintenanceHandler({
        features: {
            set: ()=>assert.fail()
        },
        monitor: {},
        ownerSignal: control.signal
    });
    assert.equal((await h('features/set', {}, undefined, {
        principal: {
            kind: 'owner'
        }
    })).ok, false);
});
test('official domain schema rejects malformed settings and supports reopened state', ()=>{
    const state = initialMaintenanceState();
    assert.deepEqual(maintenanceDomain.global.schema.parse(state), state);
    assert.throws(()=>maintenanceDomain.global.schema.parse({
            ...state,
            intervalHours: 0
        }));
    assert.equal(maintenanceDomain.name, 'codex_eyes_hands_maintenance');
});


test('scheduler belongs to plugin and stops timers on disposal', async ()=>{
    let callback, cleared = false, calls = 0;
    const stop = startUpdateLoop({
        check: async ()=>{
            calls++;
        }
    }, {
        setTimer: (fn)=>{
            callback = fn;
            return 1;
        },
        clearTimer: ()=>{
            cleared = true;
        }
    });
    callback();
    await new Promise((r)=>setImmediate(r));
    assert.equal(calls, 1);
    await stop();
    assert.equal(cleared, true);
    callback();
    assert.equal(calls, 1);
});
test('maintenance initialization and disposal release native domain and RPC', async ()=>{
    let cleanup, closed = 0, registered = 0, removed = 0, state = initialMaintenanceState();
    const domain = {
        global: {
            get: ()=>state,
            set: async (s)=>{
                state = s;
            }
        },
        close: async ()=>{
            closed++;
        }
    };
    const ctx = {
        logger: {
            warn: ()=>{}
        },
        inject: (deps, fn)=>{ assert.ok(!deps.includes('pluginManager')); fn(ctx); },
        effect: (fn)=>{
            cleanup = fn();
        },
        storageDomain: {
            open: async ()=>domain
        },
        pluginManager: {
            listBundles: async ()=>[],
            listPlugins: async ()=>[]
        },
        connection: {
            fetch: {
                register: ()=>{
                    registered++;
                    return async ()=>{
                        removed++;
                    };
                }
            }
        }
    };
    installMaintenance(ctx);
    await new Promise((r)=>setImmediate(r));
    assert.equal(registered, 5);
    await cleanup();
    assert.equal(closed, 1);
    assert.equal(removed, 5);
});
test('client factory registers a native localized slot (structural check, not browser rendering)', ()=>{
    let module, component;
    const source = fs.readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
    vm.runInNewContext(source, {
        window: {
            __ModuleLoader__: {
                load: (m)=>{
                    module = m;
                }
            }
        },
        setTimeout,
        clearTimeout
    });
    const snapshot = {
        locale: 'zh',
        revision: 1
    };
    const React = {
        createElement: (type, props, ...children)=>({
                type,
                props,
                children
            }),
        useSyncExternalStore: ()=>snapshot,
        useState: (initial)=>[
                initial,
                ()=>{}
            ],
        useEffect: ()=>{},
        Fragment: 'fragment'
    };
    const plugin = module.factory((name)=>{
        assert.equal(name, 'react');
        return React;
    });
    const words = {};
    plugin.apply({
        effect: (f)=>f(),
        locale: {
            register: (_n, w)=>{
                Object.assign(words, w);
                return ()=>{};
            },
            bind: ()=>(k)=>words.zh[k] || k,
            subscribe: ()=>()=>{},
            getSnapshot: ()=>snapshot
        },
        connection: {
            rpc: {
                call: ()=>assert.fail('Structural test must not fetch')
            }
        },
        slots: {
            inject: (_n, fn)=>fn(),
            register: (d, c)=>{
                assert.ok(['main', 'sidebar.panellist'].includes(d.name));
                if (d.name === 'main') component = c;
            }
        }
    });
    const tree = component();
    assert.equal(tree.type, 'main');
    assert.ok(JSON.stringify(tree).includes('codex-eyes-hands'));
    assert.ok(JSON.stringify(tree).includes('上游更新提醒'));
    assert.ok(!JSON.stringify(tree).includes('四项内置功能'));
    assert.ok(!source.includes('features/set'));
    assert.ok(!source.includes('document.body'));
    assert.ok(!source.includes('conversation.composer.dock'));
    assert.ok(source.includes("name:'main',key:PANEL"));
    assert.ok(source.includes("name:'sidebar.panellist',id:PANEL"));
});

test('client update actions use its own namespace and never mutate native components',async()=>{
    let module,component,hook=0,done;
    const writes=[],calls=[],finished=new Promise(resolve=>{done=resolve;});
    const updates=initialMaintenanceState();
    const React={createElement:(type,props,...children)=>({type,props,children}),useSyncExternalStore:()=>({}),useEffect:()=>{},Fragment:'fragment',
        useState:initial=>{const i=hook++;return [i===0?updates:i===1?{updates,pluginVersion:'2.3.0'}:initial,value=>{writes.push(value);if(i===3&&value===false)done();}];}};
    vm.runInNewContext(fs.readFileSync(new URL('../client/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:value=>{module=value;}}},setTimeout,clearTimeout});
    const words={};module.factory(()=>React).apply({effect:fn=>fn(),locale:{register:(_n,value)=>Object.assign(words,value),bind:()=>key=>words.zh[key],subscribe:()=>()=>{},getSnapshot:()=>({})},
        connection:{rpc:{call:async(channel,endpoint)=>{calls.push({channel,endpoint});return {ok:true,value:endpoint.endsWith('/status')?{updates,pluginVersion:'2.3.0'}:updates};}}},
        slots:{inject:(_n,fn)=>fn(),register:(d,c)=>{if(d.name==='main')component=c;}}});
    function find(n){if(Array.isArray(n))return n.map(find).find(Boolean);if(!n||typeof n!=='object')return;if(n.type==='button'&&n.children.includes('立即检查'))return n;return find(n.children);}
    const button=find(component());assert.ok(button);button.props.onClick();await finished;
    assert.deepEqual(calls,[{channel:'/api',endpoint:'codex-eyes-hands/updates/check'},{channel:'/api',endpoint:'codex-eyes-hands/status'}]);
    assert.ok(writes.includes('操作已处理，请以上次成功检查时间为准。'));
});

test('desktop shared API serves maintenance RPC and enforces owner access', async () => {
    const host = createRequire(path.join(process.env.DSH_TEST_INSTALL_DIR, 'package.json'));
    const {Context} = host('@deepseek-ai/cordis');
    const {HostConnectionService} = host('@deepseek-ai/dsh-client-connection');
    const native = new HostConnectionService(new Context(), [], {});
    let cleanup, state = initialMaintenanceState();
    const domain = {global: {get: () => state, set: async s => {state = s;}}, close: async () => {}};
    const ctx = {
        logger: {warn: () => {}}, inject: (_deps, f) => f(ctx), effect: f => {cleanup = f();},
        storageDomain: {open: async () => domain},
        pluginManager: {listBundles: async () => [], listPlugins: async () => []},
        connection: native,
    };
    installMaintenance(ctx);
    await new Promise(resolve => setImmediate(resolve));
    const api = native.createSharedFetchHandler('/api');
    const request = (method = 'codex-eyes-hands/summary') => new Request('http://localhost/api/codex-eyes-hands/summary', {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({type: 'client-request', rpcId: 'audit-summary', method, payload: {}}),
    });
    try {
        const response = await api.fetch(request(), native.browserPeer);
        assert.equal(response.status, 200);
        const envelope = await response.json();
        assert.equal(envelope.type, 'server-response');
        assert.equal(envelope.rpcId, 'audit-summary');
        assert.equal(envelope.result.value.intervalHours, 168);
        const denied = await api.fetch(request(), {principal: {kind: 'guest'}});
        assert.equal(denied.status, 403);
        const mismatch = await api.fetch(request('updates/check'), native.browserPeer);
        assert.equal(mismatch.status, 400);
    } finally { await cleanup(); }
    const removed = await api.fetch(request(), native.browserPeer);
    assert.equal(removed.status, 404);
});

test('cancelled feature management endpoint cannot read or mutate native features',async()=>{
    let writes=0;
    const handler=createMaintenanceHandler({monitor:{load:()=>initialMaintenanceState()},features:{set:async()=>{writes++;return 'changed';},list:async()=>['terminal']}});
    const result=await handler('features/set',{id:'terminal',enabled:false},undefined,{principal:{kind:'owner'}});
    assert.equal(result.ok,false);
    assert.equal(writes,0);
    const status=await handler('status',{},undefined,{principal:{kind:'owner'}});
    assert.equal(Object.hasOwn(status.value,'features'),false);
});
test('bundle patch contains only Codex entries and never overrides native title updater',()=>{
    const host=createRequire(path.join(process.env.DSH_TEST_INSTALL_DIR,'package.json'));
    const {composeEntries,loadOverlayPatches}=host('@deepseek-ai/dsh-app-boot');
    const patch=loadOverlayPatches('test',new URL('../cordis.patch.yml',import.meta.url).pathname.replace(/^\//,''));
    const rows=composeEntries([[{insert:[{id:'session-title-llm',name:'stock-title'}]},...patch]]);
    assert.equal(rows.find(r=>r.id==='session-title-llm').disabled,undefined);
    assert.deepEqual(rows.filter(r=>r.id!=='session-title-llm').map(r=>r.id),['codex-eyes-hands','codex-eyes-hands-tool']);
});
