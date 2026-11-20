import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCodexCommand } from '../plugin/resolve-codex.mjs';
test('missing explicit Codex fails instead of running a shell fallback', ()=>{
    assert.throws(()=>resolveCodexCommand({
            codexPath: 'E:/not-a-real-install/codex.exe'
        }), /not found|不存在/i);
});
test('reject command scripts and shell syntax in explicit paths', ()=>{
    assert.throws(()=>resolveCodexCommand({
            codexPath: 'cmd.exe /c echo hello'
        }), /absolute|绝对|not found|不存在/i);
});
test('existing local Codex resolves to an argument array without a shell', ()=>{
    const argv = resolveCodexCommand();
    assert.ok(Array.isArray(argv));
    assert.ok(argv.length >= 1);
    assert.ok(argv.every((x)=>typeof x === 'string'));
    assert.ok(!argv.includes('/c'));
});
