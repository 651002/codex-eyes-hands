import test from 'node:test';
import assert from 'node:assert/strict';
import { FeatureManager, OFFICIAL_FEATURES } from '../plugin/features.mjs';
function setup({ enabled = false, version = '0.2.2-rc.5', phase = 'active', available = true, application = 'applied' } = {}) {
    const rows = OFFICIAL_FEATURES.map((f)=>({
            name: f.package,
            version,
            availability: available ? 'installation' : 'missing',
            official: true,
            enabled,
            rows: [
                {
                    entryId: f.id,
                    moduleName: f.package
                }
            ]
        }));
    const changes = [];
    let backups = 0;
    const manager = {
        listBundles: async ()=>rows,
        listPlugins: async ()=>rows.map((r)=>({
                    entryId: r.rows[0].entryId,
                    fiberPhase: phase
                })),
        setBundleEnabled: async (name, value)=>{
            changes.push({
                name,
                value
            });
            rows.find((r)=>r.name === name).enabled = value;
            return {
                application,
                changed: true,
                target: name
            };
        }
    };
    const features = new FeatureManager({
        manager,
        hostVersion: '0.2.2-rc.5',
        backup: async ()=>{
            backups++;
        }
    });
    return {
        features,
        changes,
        get backups () {
            return backups;
        }
    };
}
test('compatibility check does not enable anything', async ()=>{
    const h = setup();
    const rows = await h.features.list();
    assert.equal(rows.length, 4);
    assert.equal(h.changes.length, 0);
    assert.equal(rows[0].status, 'disabled');
});
test('matching active bundle is not loaded a second time', async ()=>{
    const h = setup({
        enabled: true
    });
    const r = await h.features.set('terminal', true);
    assert.equal(r.changed, false);
    assert.equal(h.changes.length, 0);
    assert.equal(h.backups, 0);
});
test('known shipped bundle enables through official manager after backup', async ()=>{
    const h = setup();
    const r = await h.features.set('terminal', true);
    assert.equal(h.backups, 1);
    assert.equal(h.changes[0].name, '@deepseek-ai/dsh-experimental-terminal-bundle');
    assert.equal(r.application, 'applied');
});
test('version mismatch and missing package refuse writes instead of downloading', async ()=>{
    for (const options of [
        {
            version: '0.2.2-rc.4'
        },
        {
            available: false
        }
    ]){
        const h = setup(options);
        await assert.rejects(h.features.set('terminal', true));
        assert.equal(h.changes.length, 0);
    }
});
test('enabled selection is not sufficient evidence of runtime health', async ()=>{
    const h = setup({
        enabled: true,
        phase: 'failed'
    });
    const r = await h.features.list();
    assert.notEqual(r[0].status, 'running');
});
test('restart-required is kept distinct from live activation', async ()=>{
    const h = setup({
        application: 'restart-required'
    });
    const r = await h.features.set('terminal', true);
    assert.equal(r.application, 'restart-required');
});
test('unknown package and nonboolean activation cannot reach manager', async ()=>{
    const h = setup();
    await assert.rejects(h.features.set('arbitrary-package', true));
    await assert.rejects(h.features.set('terminal', 'true'));
    assert.equal(h.changes.length, 0);
});
test('backup failure blocks configuration changes', async ()=>{
    const manager = {
        listBundles: async ()=>[
                {
                    name: OFFICIAL_FEATURES[0].package,
                    version: '0.2.2-rc.5',
                    enabled: false,
                    availability: 'installation',
                    rows: []
                }
            ],
        listPlugins: async ()=>[],
        setBundleEnabled: ()=>assert.fail('must not write')
    };
    const f = new FeatureManager({
        manager,
        hostVersion: '0.2.2-rc.5',
        backup: async ()=>{
            throw Error('backup failed');
        }
    });
    await assert.rejects(f.set('terminal', true), /backup failed/);
});
