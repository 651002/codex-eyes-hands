import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// The npm launcher starts another console process on Windows. Use the very same
// packaged executable as that launcher, keeping DSH's hidden/job-managed spawn.
function windowsNativeCodex(launcher, platform, arch) {
    if (platform !== 'win32' || path.basename(launcher) !== 'codex.js' || path.basename(path.dirname(launcher)) !== 'bin') return;
    const packageRoot = path.dirname(path.dirname(launcher));
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')); } catch { return; }
    if (manifest.name !== '@openai/codex') return;
    const target = {x64:'x86_64-pc-windows-msvc',arm64:'aarch64-pc-windows-msvc'}[arch];
    if (!target) throw Error('Unsupported Windows Codex architecture: ' + arch);
    let vendor = path.join(packageRoot, 'vendor');
    try { vendor = path.join(path.dirname(createRequire(launcher).resolve('@openai/codex-win32-' + arch + '/package.json')), 'vendor'); } catch {}
    const binary = path.join(vendor, target, 'bin', 'codex.exe');
    try { if (fs.statSync(binary).isFile()) return fs.realpathSync(binary); } catch {}
    throw Error('Installed Windows Codex native executable not found; select an existing codex.exe or repair the current Codex installation. No launcher fallback was started.');
}
export function resolveCodexCommand({ codexPath, env = process.env, platform = process.platform, arch = process.arch } = {}) {
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
        let real;
        try { real = fs.realpathSync(f); if (!fs.statSync(real).isFile()) continue; } catch { continue; }
        if (/\.(cmd|bat|ps1)$/i.test(real)) continue;
        if (/\.[cm]?js$/i.test(real)) {
            const native = windowsNativeCodex(real, platform, arch);
            if (native) return [native];
            return [env.DSH_NODE_EXECUTABLE || process.execPath, real];
        }
        return [real];
    }
    throw new Error('Codex executable not found / 未找到 Codex。请在插件设置填写已有 codex.exe 或 bin/codex.js 的绝对路径。');
}
