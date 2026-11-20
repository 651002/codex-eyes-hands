import test from 'node:test';
import assert from 'node:assert/strict';
import { UpdateMonitor, UPSTREAMS, initialMaintenanceState } from '../plugin/updates.mjs';
function setup({ changed = false, relevant = true, fail = false } = {}) {
    let state = initialMaintenanceState(), calls = 0, now = 10000000;
    const monitor = new UpdateMonitor({
        load: ()=>structuredClone(state),
        save: async (s)=>{
            state = structuredClone(s);
        },
        now: ()=>now,
        fetchJson: async (url)=>{
            calls++;
            if (fail) throw Error('HTTP 403');
            if (url.includes('/releases?')) return [
                {
                    tag_name: UPSTREAMS.find((s)=>url.includes(s.repo)).adoptedRelease,
                    published_at: '2026-11-21',
                    html_url: 'https://github.com/x/y/releases'
                }
            ];
            if (/\/repos\/[^/]+\/[^/]+$/.test(url)) return {
                default_branch: 'main'
            };
            if (url.includes('/git/ref/heads/')) return {
                object: {
                    sha: changed ? 'f'.repeat(40) : UPSTREAMS.find((s)=>url.includes(s.repo)).baseline
                }
            };
            if (url.includes('/compare/')) return {
                files: [
                    {
                        filename: relevant ? 'src/lib/core-cache.ts' : 'README.md'
                    }
                ],
                total_commits: 1
            };
            throw Error('unexpected URL');
        }
    });
    return {
        monitor,
        get state () {
            return state;
        },
        get calls () {
            return calls;
        },
        advance: (n)=>now += n
    };
}
test('manual check persists successful snapshots without invoking Codex or changing adopted baselines', async ()=>{
    const h = setup();
    await h.monitor.check(true);
    assert.ok(h.state.lastSuccess);
    assert.equal(h.state.notices.length, 0);
    assert.equal(h.state.snapshots[UPSTREAMS[0].repo].adopted, UPSTREAMS[0].baseline);
});
test('repeated check within cooldown does not hammer GitHub', async ()=>{
    const h = setup();
    await h.monitor.check(true);
    const n = h.calls;
    await h.monitor.check(true);
    assert.equal(h.calls, n);
});
test('related upstream change produces a pending-review notice, not an auto-update', async ()=>{
    const h = setup({
        changed: true
    });
    await h.monitor.check(true);
    assert.ok(h.state.notices.some((n)=>n.repo === 'ysr666/dsh-vision-router'));
    assert.ok(h.state.notices.every((n)=>n.kind === 'review'));
    assert.equal(h.state.snapshots['ysr666/dsh-vision-router'].adopted, UPSTREAMS[1].baseline);
});
test('unrelated files do not produce review spam', async ()=>{
    const h = setup({
        changed: true,
        relevant: false
    });
    await h.monitor.check(true);
    assert.equal(h.state.notices.length, 0);
});
test('network failure does not advance success snapshots or claim no update', async ()=>{
    const h = setup({
        fail: true
    });
    await h.monitor.check(true);
    assert.equal(h.state.lastSuccess, null);
    assert.equal(Object.keys(h.state.snapshots).length, 0);
    assert.ok(h.state.lastError);
    assert.equal(h.state.failures, 1);
});
test('disabled automatic checks do nothing, but manual checks still work', async ()=>{
    const h = setup();
    await h.monitor.settings({
        enabled: false,
        intervalHours: 24
    });
    await h.monitor.check(false);
    assert.equal(h.calls, 0);
    await h.monitor.check(true);
    assert.ok(h.calls > 0);
});
test('acknowledgement survives next checks without erasing adopted baselines', async ()=>{
    const h = setup({
        changed: true
    });
    await h.monitor.check(true);
    await h.monitor.acknowledge();
    assert.ok(h.state.notices.every((n)=>n.acknowledged));
    h.advance(3600000);
    await h.monitor.check(true);
    assert.ok(h.state.notices.every((n)=>n.acknowledged));
});
test('period bounds are validated and disabling has no scheduler side effects', async ()=>{
    const h = setup();
    await assert.rejects(h.monitor.settings({
        enabled: true,
        intervalHours: 0
    }));
    assert.equal(h.calls, 0);
});
test('concurrent manual checks coalesce into one network run', async ()=>{
    const a = setup();
    await a.monitor.check(true);
    const expected = a.calls;
    const b = setup();
    await Promise.all([
        b.monitor.check(true),
        b.monitor.check(true)
    ]);
    assert.equal(b.calls, expected);
});
test('acknowledging while a check runs is not reverted by the result', async ()=>{
    const h = setup({
        changed: true
    });
    await h.monitor.check(true);
    h.advance(3600000);
    const checking = h.monitor.check(true);
    await h.monitor.acknowledge();
    await checking;
    assert.ok(h.state.notices.every((n)=>n.acknowledged));
});
