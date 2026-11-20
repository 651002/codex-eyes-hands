import { createHash } from 'node:crypto';
export const UPSTREAMS = [
    {
        repo: 'deepseek-ai/deepseek-harness',
        baseline: '9c2670d3bce5275e0d1610272958121af87787bb',
        adoptedRelease: 'dsh-v0.2.2-rc.5',
        paths: [
            'packages/subagent/',
            'packages/interaction/',
            'packages/api/session-controller/',
            'packages/attachment/',
            'packages/client/ui-attachment/',
            'packages/core/tools/',
            'packages/sdk/protocol/',
            'packages/client/client-connection/',
            'packages/experimental/terminal-bundle/',
            'packages/experimental/session-search/',
            'packages/experimental/forge',
            'packages/experimental/session-titles',
            'docs/upgrade-guide/'
        ]
    },
    {
        repo: 'ysr666/dsh-vision-router',
        baseline: 'e360d1ff975b53505b8d0f41e1f670cea27a3a37',
        adoptedRelease: 'v3.4.0',
        paths: [
            'src/lib/core-cache',
            'src/lib/structured-bootstrap',
            'src/lib/pixel-diff',
            'src/lib/grounding',
            'src/lib/native-ocr',
            'src/lib/vision-',
            'docs/progressive-tools-cache',
            'SECURITY.md'
        ]
    }
];
export const initialMaintenanceState = ()=>({
        version: 1,
        enabled: true,
        intervalHours: 168,
        lastAttempt: null,
        lastSuccess: null,
        nextDueAt: 0,
        lastError: null,
        failures: 0,
        snapshots: {},
        notices: []
    });
export async function githubJson(url, { signal } = {}) {
    if (!url.startsWith('https://api.github.com/repos/')) throw Error('Only public GitHub repo APIs are allowed');
    const r = await fetch(url, {
        headers: {
            accept: 'application/vnd.github+json',
            'user-agent': 'dsh-codex-eyes-hands-update-check'
        },
        redirect: 'error',
        signal: signal ? AbortSignal.any([
            signal,
            AbortSignal.timeout(15000)
        ]) : AbortSignal.timeout(15000)
    });
    if (!r.ok) throw Error('GitHub HTTP ' + r.status);
    let length = 0;
    const chunks = [];
    for await (const bytes of r.body){
        length += bytes.length;
        if (length > 3145728) throw Error('GitHub result exceeds 3 MiB');
        chunks.push(bytes);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export class UpdateMonitor {
    constructor({ load, save, fetchJson = githubJson, now = Date.now }){
        Object.assign(this, {
            load,
            save,
            fetchJson,
            now
        });
        this.pending = null;
    }
    async settings({ enabled, intervalHours }) {
        if (typeof enabled !== 'boolean' || !Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 720) throw Error('检查周期须为1至720小时');
        const current = this.load();
        await this.save({
            ...current,
            enabled,
            intervalHours,
            nextDueAt: current.lastSuccess ? current.lastSuccess + intervalHours * 3600000 : 0
        });
        return this.load();
    }
    async acknowledge() {
        const s = this.load();
        await this.save({
            ...s,
            notices: s.notices.map((n)=>({
                    ...n,
                    acknowledged: true
                }))
        });
        return this.load();
    }
    check(force = false, signal) {
        if (this.pending) return this.pending;
        this.pending = this.run(force, signal).finally(()=>{
            this.pending = null;
        });
        return this.pending;
    }
    async run(force, signal) {
        const s = this.load(), now = this.now();
        if (!force && (!s.enabled || now < s.nextDueAt)) return s;
        if (s.lastAttempt !== null && now - s.lastAttempt < 60000) return s;
        await this.save({
            ...s,
            lastAttempt: now
        });
        try {
            const snapshots = {
                ...s.snapshots
            }, notices = [
                ...s.notices
            ];
            for (const src of UPSTREAMS){
                signal?.throwIfAborted();
                const base = 'https://api.github.com/repos/' + src.repo;
                const meta = await this.fetchJson(base, {
                    signal
                });
                if (typeof meta.default_branch !== 'string') throw Error('Invalid GitHub default branch');
                const releases = await this.fetchJson(base + '/releases?per_page=1', {
                    signal
                });
                const ref = await this.fetchJson(base + '/git/ref/heads/' + encodeURIComponent(meta.default_branch), {
                    signal
                });
                const head = ref.object?.sha;
                if (!/^[a-f0-9]{40}$/.test(head || '')) throw Error('Invalid GitHub commit identity');
                const last = s.snapshots[src.repo];
                const from = last?.head ?? src.baseline;
                const release = releases[0]?.tag_name ?? null;
                const files = [];
                let incomplete = false;
                if (from !== head) {
                    const diff = await this.fetchJson(base + '/compare/' + from + '...' + head + '?per_page=1', {
                        signal
                    });
                    if (!Array.isArray(diff.files)) throw Error('GitHub compare did not return file evidence');
                    files.push(...diff.files.map((f)=>f.filename).filter((f)=>typeof f === 'string' && src.paths.some((p)=>f.startsWith(p))));
                    incomplete = diff.files.length >= 300;
                }
                const releaseChanged = release !== (last?.release ?? src.adoptedRelease);
                if (files.length || incomplete || releaseChanged) {
                    const id = createHash('sha256').update(src.repo + head + String(release)).digest('hex');
                    if (!notices.some((n)=>n.id === id)) notices.push({
                        id,
                        kind: 'review',
                        repo: src.repo,
                        head,
                        release,
                        date: releases[0]?.published_at ?? null,
                        url: 'https://github.com/' + src.repo + '/compare/' + from + '...' + head,
                        files: files.slice(0, 20),
                        incomplete,
                        reason: files.length ? '相关文件有变化，值得人工复查' : incomplete ? '比较文件数达到上限，不能断定无相关变化' : '有新发行，建议核对兼容性',
                        acknowledged: false
                    });
                }
                snapshots[src.repo] = {
                    adopted: src.baseline,
                    head,
                    release,
                    checkedAt: now
                };
            }
            const latest = this.load();
            await this.save({
                ...latest,
                snapshots,
                notices: notices.slice(-12).map((n)=>({
                        ...n,
                        acknowledged: latest.notices.find((old)=>old.id === n.id)?.acknowledged ?? n.acknowledged
                    })),
                lastSuccess: now,
                lastError: null,
                failures: 0,
                nextDueAt: now + latest.intervalHours * 3600000
            });
        } catch (e) {
            if (signal?.aborted) throw e;
            const latest = this.load(), failures = latest.failures + 1;
            await this.save({
                ...latest,
                failures,
                lastError: e instanceof Error ? e.message.slice(0, 250) : 'Update check failed',
                nextDueAt: now + Math.min(6, 2 ** Math.min(failures - 1, 3)) * 3600000
            });
        }
        return this.load();
    }
}
export function startUpdateLoop(monitor, { setTimer = setTimeout, clearTimer = clearTimeout, signal } = {}) {
    let stopped = false, timer, active = Promise.resolve();
    const schedule = (ms)=>{
        timer = setTimer(tick, ms);
        timer?.unref?.();
    };
    const tick = ()=>{
        if (stopped) return;
        active = monitor.check(false, signal).catch(()=>{}).finally(()=>{
            if (!stopped) schedule(3600000);
        });
    };
    schedule(30000);
    return async ()=>{
        stopped = true;
        clearTimer(timer);
        await active;
    };
}
