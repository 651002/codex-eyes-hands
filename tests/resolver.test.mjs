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

import fs from 'node:fs';
import path from 'node:path';
const testRoot=process.env.CODEX_EYES_HANDS_TEST_ROOT || 'E:/Codex/备份仓库/2026-11-20/codex-eyes-hands插件升级_20261120_150016/测试临时文件';
function codexFixture(arch='x64',legacy=false){
 const dir=fs.mkdtempSync(path.join(testRoot,'native-codex-')),root=path.join(dir,'node_modules/@openai/codex');fs.mkdirSync(path.join(root,'bin'),{recursive:true});
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'@openai/codex',version:'0.170.0',bin:{codex:'bin/codex.js'}}));
 const launcher=path.join(root,'bin/codex.js');fs.writeFileSync(launcher,'// offline fixture, never executed');
 const target=arch==='arm64'?'aarch64-pc-windows-msvc':'x86_64-pc-windows-msvc';
 const native=legacy?path.join(root,'vendor',target,'bin/codex.exe'):path.join(root,'node_modules/@openai/codex-win32-'+arch,'vendor',target,'bin/codex.exe');
 fs.mkdirSync(path.dirname(native),{recursive:true});fs.writeFileSync(native,'offline executable fixture; do not run');
 if(!legacy)fs.writeFileSync(path.join(root,'node_modules/@openai/codex-win32-'+arch,'package.json'),JSON.stringify({name:'@openai/codex',version:'0.170.0-win32-'+arch}));
 return {root,launcher,native};
}
test('Windows npm Codex uses its installed native executable directly, not the console-spawning JS launcher',()=>{
 const f=codexFixture();assert.deepEqual(resolveCodexCommand({codexPath:f.launcher,platform:'win32',arch:'x64'}),[fs.realpathSync(f.native)]);
});

test('Windows ARM64 and older bundled layouts choose only the matching native binary',()=>{
 for(const [arch,legacy] of [['arm64',false],['x64',true]]){const f=codexFixture(arch,legacy);assert.deepEqual(resolveCodexCommand({codexPath:f.launcher,platform:'win32',arch}),[fs.realpathSync(f.native)]);}
});
test('missing official native binary fails without invoking the window-spawning launcher',()=>{
 const f=codexFixture();fs.renameSync(f.native,f.native+'.fixture-disabled');
 assert.throws(()=>resolveCodexCommand({codexPath:f.launcher,platform:'win32',arch:'x64'}),/native executable not found/);
});
test('custom JS commands and non-Windows Codex resolution keep their original behavior',()=>{
 const f=codexFixture();assert.deepEqual(resolveCodexCommand({codexPath:f.launcher,platform:'linux',arch:'x64',env:{DSH_NODE_EXECUTABLE:process.execPath}}),[process.execPath,fs.realpathSync(f.launcher)]);
 const fake=path.resolve('tests/fixtures/fake-codex.mjs');assert.deepEqual(resolveCodexCommand({codexPath:fake,platform:'win32',arch:'x64',env:{DSH_NODE_EXECUTABLE:process.execPath}}),[process.execPath,fs.realpathSync(fake)]);
 assert.deepEqual(resolveCodexCommand({codexPath:f.native,platform:'win32'}),[fs.realpathSync(f.native)]);
});
