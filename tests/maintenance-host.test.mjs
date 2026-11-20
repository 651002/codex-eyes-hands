import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createMaintenanceHandler, maintenanceDomain, installMaintenance } from '../plugin/maintenance.mjs';
import { initialMaintenanceState, UpdateMonitor, startUpdateLoop } from '../plugin/updates.mjs';
import { backupProfile } from '../plugin/profile-backup.mjs';
const parent = process.env.CODEX_EYES_HANDS_TEST_ROOT || path.join(os.tmpdir(), 'codex-eyes-hands-tests');
fs.mkdirSync(parent, {
    recursive: true
});
const dir = fs.mkdtempSync(path.join(parent, 'maintenance-'));
test.after(()=>{
    const r = path.relative(parent, dir);
    if (r && !r.startsWith('..') && !path.isAbsolute(r)) fs.rmSync(dir, {
        recursive: true,
        force: true
    });
});
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
    })).value.features.length, 0);
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
test('configuration backup preserves original bytes and produces ANSI restore BAT', async ()=>{
    const profile = path.join(dir, 'profile');
    fs.mkdirSync(profile);
    const original = Buffer.from('{"keep":"会话配置不动"}\n');
    fs.writeFileSync(path.join(profile, 'package.json'), original);
    fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), '# 原配置\n');
    const result = await backupProfile({
        profile,
        root: path.join(dir, 'backup'),
        now: new Date('2026-11-21T00:00:00+08:00')
    });
    assert.equal(result.length, 2);
    assert.deepEqual(fs.readFileSync(result[0].backup), original);
    assert.deepEqual(fs.readFileSync(result[0].source), original);
    for (const r of result){
        const bat = fs.readFileSync(r.restore);
        assert.ok([
            ...bat
        ].every((b)=>b < 128));
        assert.ok(bat.toString().includes('EncodedCommand'));
    }
});
test('missing profile refuses backup rather than guessing another config', async ()=>{
    await assert.rejects(backupProfile({
        profile: '',
        root: path.join(dir, 'backup')
    }), /DSH_PROFILE_DIR/);
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
        inject: (_d, fn)=>fn(ctx),
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
            rpc: {
                handle: ()=>{
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
    assert.equal(registered, 1);
    await cleanup();
    assert.equal(closed, 1);
    assert.equal(removed, 1);
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
                assert.equal(d.name, 'conversation.composer.dock');
                component = c;
            }
        }
    });
    const tree = component();
    assert.equal(tree.type, 'details');
    assert.ok(JSON.stringify(tree).includes('codex-eyes-hands 设置'));
    assert.ok(JSON.stringify(tree).includes('官方组件兼容检查'));
    assert.ok(!source.includes('document.body'));
});

test('client surfaces official restart-required result (VM interaction, not browser rendering)', async () => {
    let module, component, hook = 0, done;
    const writes = [];
    const finished = new Promise(resolve => { done = resolve; });
    const updates = initialMaintenanceState();
    const features = [{id: 'terminal', enabled: false, canEnable: true, status: 'disabled', version: '0.2.2-rc.5'}];
    const React = {
        createElement: (type, props, ...children) => ({type, props, children}),
        useSyncExternalStore: () => ({}),
        useState: initial => {
            const index = hook++;
            return [index === 0 ? updates : index === 1 ? {updates, features} : initial,
                value => { writes.push(value); if (index === 3 && value === false) done(); }];
        },
        useEffect: () => {}, Fragment: 'fragment'
    };
    vm.runInNewContext(fs.readFileSync(new URL('../client/client.js', import.meta.url), 'utf8'), {
        window: {confirm: () => true, __ModuleLoader__: {load: value => { module = value; }}},
        setTimeout, clearTimeout
    });
    const words = {};
    module.factory(() => React).apply({
        effect: fn => fn(),
        locale: {register: (_name, value) => Object.assign(words, value), bind: () => key => words.zh[key], subscribe: () => () => {}, getSnapshot: () => ({})},
        connection: {rpc: {call: async (_channel, endpoint) => ({ok: true, value: endpoint === 'features/set' ? {application: 'restart-required'} : {updates, features}})}},
        slots: {inject: (_name, fn) => fn(), register: (_descriptor, view) => { component = view; }}
    });
    function find(node) {
        if (Array.isArray(node)) return node.map(find).find(Boolean);
        if (!node || typeof node !== 'object') return;
        if (node.type === 'button' && node.children.includes('启用')) return node;
        return find(node.children);
    }
    const button = find(component());
    assert.ok(button);
    button.props.onClick();
    await finished;
    assert.ok(writes.includes('配置已保存，需要重启 DSH 才会生效。'));
});
