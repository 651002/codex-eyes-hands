import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export function resolveCodexCommand({ codexPath, env = process.env } = {}) {
    const explicit = codexPath || env.CODEX_EYES_HANDS_CODEX_PATH;
    const candidates = [];
    if (explicit) {
        if (!path.isAbsolute(explicit)) throw new Error('Codex path must be absolute / 必须使用绝对路径');
        candidates.push(explicit);
    } else {
        try {
            const m = require.resolve('@openai/codex/package.json');
            const j = JSON.parse(fs.readFileSync(m, 'utf8'));
            candidates.push(path.resolve(path.dirname(m), typeof j.bin === 'string' ? j.bin : j.bin.codex));
        } catch  {}
        for (const dir of [
            env.APPDATA && path.join(env.APPDATA, 'npm'),
            env.npm_config_prefix,
            path.dirname(process.execPath),
            ...(env.PATH || env.Path || '').split(path.delimiter)
        ].filter(Boolean)){
            candidates.push(path.join(dir, 'codex.exe'), path.join(dir, 'node_modules/@openai/codex/bin/codex.js'), path.resolve(dir, '../lib/node_modules/@openai/codex/bin/codex.js'), path.join(dir, 'codex'));
        }
        const app = env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'OpenAI/Codex/bin');
        if (app && fs.existsSync(app)) for (const item of fs.readdirSync(app, {
            withFileTypes: true
        }).filter((x)=>x.isDirectory()).sort((a, b)=>fs.statSync(path.join(app, b.name)).mtimeMs - fs.statSync(path.join(app, a.name)).mtimeMs))candidates.push(path.join(app, item.name, 'codex.exe'));
    }
    for (const f of candidates){
        try {
            const real = fs.realpathSync(f);
            if (!fs.statSync(real).isFile() || /\.(cmd|bat|ps1)$/i.test(real)) continue;
            if (/\.[cm]?js$/i.test(real)) return [
                env.DSH_NODE_EXECUTABLE || process.execPath,
                real
            ];
            return [
                real
            ];
        } catch  {}
    }
    throw new Error('Codex executable not found / 未找到 Codex。请在插件设置填写已有 codex.exe 或 bin/codex.js 的绝对路径。');
}
