import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'plugin/upstream');
fs.mkdirSync(out, {
    recursive: true
});
function replace(s, from, to) {
    if (!s.includes(from)) throw Error('Upstream marker missing: ' + from.slice(0, 60));
    return s.replace(from, to);
}
for (const f of [
    'index',
    'run',
    'wire'
]){
    let s = fs.readFileSync(path.join(root, 'vendor/deepseek-subagent-codex', f + '.ts'), 'utf8');
    if (f === 'run') {
        const begin = s.indexOf('interface CodexPackageManifest');
        const end = s.indexOf('/** Profile-selectable');
        if (begin < 0 || end < begin) throw Error('Missing official CLI resolution block');
        s = s.slice(0, begin) + s.slice(end);
        s = s.replace("import { readFileSync, writeFileSync } from 'node:fs'\n", '').replace("import { createRequire } from 'node:module'\n", '').replace("import { dirname, resolve } from 'node:path'\n", '');
        s = "import { resolveCodexCommand } from '../resolve-codex.mjs'\n" + s;
        s = replace(s, "export function codexAppServerArgv(): string[] {\n  return [process.execPath, CODEX_PACKAGE_BIN, 'app-server', '--stdio']\n}", "export function codexAppServerArgv(codexPath?: string): string[] {\n  return [...resolveCodexCommand({codexPath}), 'app-server', '--stdio']\n}");
        s = replace(s, 'argv: codexAppServerArgv(),', "argv: [...codexAppServerArgv(spec.env.CODEX_EYES_HANDS_CODEX_PATH), ...((spec as any).vision ? ['-c', 'mcp_servers={}'] : [])],");
        s = replace(s, '  const texts = textTask(request.prompt)', "  const timeout = Number(spec.env.CODEX_EYES_HANDS_TIMEOUT_MS ?? 900000)\n  if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 86400000) throw new Error('Invalid Codex timeout')\n  request = { ...request, signal: AbortSignal.any([request.signal, AbortSignal.timeout(timeout)]) }\n  const texts = textTask(request.prompt)");
        s = replace(s, 'writeFileSync(process.stderr.fd, bytes)', 'void bytes // Drain stderr without publishing credentials, prompts, or arbitrary child errors.');
    }
    if (f === 'wire') {
        s = replace(s, "name: 'deepseek-harness',", "name: 'codex-eyes-hands',");
        s = replace(s, "title: 'DeepSeek Harness',", "title: 'DSH Codex eyes and hands',");
        s = replace(s, "never: { approvalPolicy: 'never' },", "never: { approvalPolicy: 'never', sandbox: 'workspace-write' },");
        s = replace(s, '      ephemeral: true,', "      ephemeral: true,\n      developerInstructions: 'You are a task executor delegated by DSH. Respect the task scope and Codex permissions. Prefer an available agent-desktop MCP for desktop control. Do not recursively invoke codex-eyes-hands or codex-bridge. Never claim user authorization that was not supplied. Report verified results, output paths, and limitations.',");
    }
    if (f === 'run') {
        s = replace(s, '    spec.model,\n  )', '    spec.model,\n    (spec as any).vision,\n  )');
    }
    if (f === 'wire') {
        s = replace(s, '    private readonly model?: string,', '    private readonly model?: string,\n    private readonly vision?: { images: string[]; schema: JsonObject; config: JsonObject },');
        s = replace(s, "      ephemeral: true,", "      ephemeral: true,\n      ...(this.vision ? { sandbox: 'read-only', config: this.vision.config } : {}),");
        s = replace(s, "...THREAD_PERMISSION_PARAMS[this.permissionMode],", "...(this.vision ? { approvalPolicy: 'never' } : THREAD_PERMISSION_PARAMS[this.permissionMode]),");
        s = replace(s, "input: texts.map(text => ({ type: 'text', text, text_elements: [] })),", "input: [...texts.map(text => ({ type: 'text', text, text_elements: [] })), ...(this.vision?.images.map(path => ({ type: 'localImage', path })) ?? [])],\n        ...(this.vision ? { outputSchema: this.vision.schema } : {}),");
    }
    let js = stripTypeScriptTypes(s, {
        mode: 'transform'
    }).replaceAll("'./run.ts'", "'./run.mjs'").replaceAll("'./wire.ts'", "'./wire.mjs'");
    fs.writeFileSync(path.join(out, f + '.mjs'), '// Adapted from DeepSeek Harness; MIT, Copyright (c) 2026 DeepSeek. See vendor/deepseek-subagent-codex/LICENSE.\n' + js);
}
console.log('Built official-based DSH adapter (3 modules).');
