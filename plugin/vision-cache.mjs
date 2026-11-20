import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export const digest = (value)=>createHash('sha256').update(value).digest('hex');
function waitFor(promise, signal) {
    if (!signal) return promise;
    signal.throwIfAborted();
    return new Promise((resolve, reject)=>{
        const abort = ()=>reject(signal.reason);
        signal.addEventListener('abort', abort, {
            once: true
        });
        promise.then(resolve, reject).finally(()=>signal.removeEventListener('abort', abort));
    });
}
export class VisionCache {
    constructor({ directory, ttlMs = 86400000, maxEntries = 128, maxBytes = 16777216, maxItemBytes = 524288, now = Date.now }){
        if (!path.isAbsolute(directory) || ![
            ttlMs,
            maxEntries,
            maxBytes,
            maxItemBytes
        ].every((n)=>Number.isFinite(n) && n > 0)) throw Error('Invalid vision cache configuration');
        Object.assign(this, {
            directory,
            ttlMs,
            maxEntries,
            maxBytes,
            maxItemBytes,
            now
        });
        this.inflight = new Map();
        fs.mkdirSync(directory, {
            recursive: true
        });
        this.prune();
    }
    file(scope, key) {
        if (typeof scope !== 'string' || !scope.trim()) throw Error('Vision cache requires a session scope');
        const dir = path.join(this.directory, digest(scope));
        if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw Error('Cache scope must not be a symbolic link');
        return path.join(dir, digest(key) + '.json');
    }
    get(scope, key) {
        const file = this.file(scope, key);
        try {
            const stat = fs.lstatSync(file);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > this.maxItemBytes) return undefined;
            const record = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (record.version !== 1 || record.key !== digest(key) || !Number.isFinite(record.expiresAt) || !record.value || typeof record.value !== 'object' || record.expiresAt <= this.now()) return undefined;
            fs.utimesSync(file, new Date(), new Date());
            return record.value;
        } catch  {
            return undefined;
        }
    }
    put(scope, key, value) {
        const file = this.file(scope, key);
        const text = JSON.stringify({
            version: 1,
            key: digest(key),
            createdAt: this.now(),
            expiresAt: this.now() + this.ttlMs,
            value
        });
        if (Buffer.byteLength(text) > this.maxItemBytes) return false;
        fs.mkdirSync(path.dirname(file), {
            recursive: true
        });
        const tmp = file + '.' + randomUUID() + '.tmp';
        try {
            fs.writeFileSync(tmp, text, {
                mode: 0o600
            });
            fs.renameSync(tmp, file);
        } finally{
            if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        }
        this.prune();
        return true;
    }
    prune() {
        const files = [];
        for (const scope of fs.readdirSync(this.directory, {
            withFileTypes: true
        })){
            if (!scope.isDirectory() || !/^[a-f0-9]{64}$/.test(scope.name)) continue;
            const dir = path.join(this.directory, scope.name);
            for (const e of fs.readdirSync(dir, {
                withFileTypes: true
            })){
                if (!e.isFile() || !/^[a-f0-9]{64}\.json$/.test(e.name)) continue;
                const file = path.join(dir, e.name);
                const stat = fs.lstatSync(file);
                let expired = false;
                try {
                    expired = JSON.parse(fs.readFileSync(file, 'utf8')).expiresAt <= this.now();
                } catch  {
                    expired = true;
                }
                if (expired || stat.size > this.maxItemBytes) {
                    fs.unlinkSync(file);
                    continue;
                }
                files.push({
                    file,
                    size: stat.size,
                    time: stat.mtimeMs
                });
            }
        }
        files.sort((a, b)=>a.time - b.time);
        let bytes = files.reduce((n, f)=>n + f.size, 0);
        while(files.length > this.maxEntries || bytes > this.maxBytes){
            const f = files.shift();
            fs.unlinkSync(f.file);
            bytes -= f.size;
        }
    }
    async share(scope, key, signal, produce) {
        signal?.throwIfAborted();
        const id = digest(scope + '\0' + key);
        let entry = this.inflight.get(id);
        if (!entry) {
            const control = new AbortController();
            entry = {
                control,
                waiters: 0,
                promise: undefined
            };
            entry.promise = Promise.resolve().then(()=>produce(control.signal)).finally(()=>this.inflight.delete(id));
            entry.promise.catch(()=>{});
            this.inflight.set(id, entry);
        }
        entry.waiters++;
        try {
            return await waitFor(entry.promise, signal);
        } finally{
            entry.waiters--;
            if (entry.waiters === 0 && this.inflight.get(id) === entry) entry.control.abort(new Error('All vision callers cancelled'));
        }
    }
}
