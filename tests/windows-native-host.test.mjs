import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {resolveCodexCommand} from '../plugin/resolve-codex.mjs';
const enabled=process.platform==='win32'&&process.env.CEH_TEST_NATIVE_STARTUP==='1';
test('actual installed Codex initializes under DSH managed hidden spawn with no new Codex console window',{skip:!enabled,timeout:20000},async()=>{
 const host=createRequire(path.join(process.env.DSH_TEST_INSTALL_DIR,'package.json'));
 const {Context}=host('@deepseek-ai/cordis');const {LocalSubprocessRuntime}=host('@deepseek-ai/dsh-subprocess-local');
 const koffi=host('koffi'),u=koffi.load('user32.dll');
 const proc=koffi.proto('bool __stdcall CehWindowProbe(void *hwnd, intptr_t param)');
 const enumerate=u.func('bool __stdcall EnumWindows(CehWindowProbe *callback, intptr_t param)');
 const visible=u.func('bool __stdcall IsWindowVisible(void *hwnd)');
 const title=u.func('int __stdcall GetWindowTextW(void *hwnd, _Out_ uint16_t *text, int count)');
 const windows=()=>{const result=new Map();const cb=koffi.register(h=>{if(visible(h)){const b=Buffer.alloc(4096);const n=title(h,b,2048);if(n)result.set(String(h),b.toString('utf16le',0,n*2));}return true;},koffi.pointer(proc));try{enumerate(cb,0);}finally{koffi.unregister(cb);}return result;};
 const before=windows();const unexpected=new Set();let samples=0;const argv=resolveCodexCommand();assert.equal(argv.length,1);assert.ok(argv[0].endsWith('codex.exe'));
 const sample=()=>{samples++;for(const [h,name] of windows())if(!before.has(h)&&(/\\codex(?:\.exe)?(?:\s|$)/i.test(name)||name.toLowerCase().includes(argv[0].toLowerCase())))unexpected.add(name);};
 const timer=setInterval(sample,25);const runtime=new LocalSubprocessRuntime(new Context());let child;
 try{
  child=runtime.spawn({argv:[...argv,'app-server','--stdio'],cwd:process.cwd(),env:{ELECTRON_RUN_AS_NODE:'1'},stdio:{stdin:'pipe',stdout:'pipe',stderr:'pipe'},graceMs:1000});
  let text='';child.stderr.resume();
  const ready=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('initialize timeout')),8000);child.stdout.on('data',b=>{text+=b;for(const line of text.split('\n'))try{const m=JSON.parse(line);if(m.id===1){clearTimeout(timeout);resolve(m);}}catch{}});child.done.catch(e=>{clearTimeout(timeout);reject(e);});});
  child.stdin.write(JSON.stringify({id:1,method:'initialize',params:{clientInfo:{name:'ceh-hidden-startup-test',version:'1.0'},capabilities:{experimentalApi:true}}})+'\n');
  const response=await ready;assert.ok(response.result);assert.ok(!response.error);
  await new Promise(r=>setTimeout(r,1200));sample();assert.ok(samples>=5);assert.deepEqual([...unexpected],[]);
  console.log(JSON.stringify({actualNativeExecutable:argv[0],initialize:'success',modelTurnsStarted:0,windowSamples:samples,newCodexConsoleWindows:unexpected.size}));
 }finally{clearInterval(timer);if(child){child.terminate();const outcome=await child.done;assert.equal(await child.waitForExit(AbortSignal.timeout(5000)),true);console.log('Managed test child terminated and range empty:',JSON.stringify(outcome));}}
});
