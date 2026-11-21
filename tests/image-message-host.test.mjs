import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { installImageExperience } from '../plugin/image-message-host.mjs';
const host=createRequire(path.join(process.env.DSH_TEST_INSTALL_DIR,'package.json'));
const {Context}=host('@deepseek-ai/cordis');
const {HostConnectionService}=host('@deepseek-ai/dsh-client-connection');
const {projectImagesForTextModel}=host('@deepseek-ai/dsh-llm');
const root=process.env.CODEX_EYES_HANDS_TEST_ROOT;
function fixture(config={}){
 let hook,runs=0;const effects=[];const connection=new HostConnectionService(new Context(),[],{});
 const attachments={imageHostPath:()=>'/offline-fixture.png'};
 const ctx={connection,attachments,llm:{resolveModelInfo:async()=>({inputModalities:['text']})},get:n=>n==='attachments'?attachments:undefined,on:(n,f)=>{if(n==='agent/pre-step')hook=f;},effect:f=>effects.push(f()),inject:(_deps,f)=>f(ctx)};
 const service=installImageExperience(ctx,{tool:async()=>{runs++;return {overview:'正确的摘要',text:[{text:'LONG '.repeat(10000)}],uncertainties:[]};},thumbnail:async()=>undefined},{visionDataDir:fs.mkdtempSync(path.join(root,'host-image-')),...config});
 return {ctx,service,effects,get hook(){return hook;},get runs(){return runs;},async close(){for(const e of effects.reverse())await e?.();}};
}
test('host hook records an image and compact result; native text-only projection excludes image bytes',async()=>{
 const f=fixture();const ref={attachmentId:'sha256:1234567890abcdef',mediaType:'image/png',width:10,height:10,bytes:100};
 const m={id:'host-m',role:'user',source:{kind:'user'},content:[{type:'image',attachment:ref},{type:'text',text:'原问题不变'}]};
 try{const p={agent:{id:'s'},messages:[m],signal:new AbortController().signal,modelSelection:{provider:'fixture',model:'text'}};const r=await f.hook(p,async()=>({kind:'enter',messages:p.messages}));
  assert.equal(f.runs,1);assert.equal(r.messages[0].content[0].type,'image');assert.equal(r.messages[0].content[1].text,'原问题不变');
  const projected=projectImagesForTextModel(r.messages);assert.ok(!JSON.stringify(projected).includes('"type":"image"'));assert.ok(JSON.stringify(projected).length<2500);assert.ok(JSON.stringify(projected).includes('正确的摘要'));
  f.ctx.llm.resolveModelInfo=async()=>({inputModalities:['text','image']});await f.hook(p,async()=>({kind:'enter',messages:p.messages}));assert.equal(f.runs,1);
 }finally{await f.close();}
});

test('shared image API validates envelopes and removes handlers on disposal',async()=>{
 const f=fixture();const record=f.service.record({overview:'private detail',text:[]},'owner-session');const api=f.ctx.connection.createSharedFetchHandler('/api');
 const req=method=>new Request('http://localhost/api/codex-eyes-hands/image/details',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'image-test',method,payload:{id:record.id}})});
 try{const res=await api.fetch(req('codex-eyes-hands/image/details'),f.ctx.connection.browserPeer);assert.equal(res.status,200);const v=await res.json();assert.equal(v.result.value.overview,'private detail');
  const bad=await api.fetch(req('other/method'),f.ctx.connection.browserPeer);assert.equal(bad.status,400);
  const peer={...f.ctx.connection.browserPeer,principal:{kind:'agent',agentId:'fixture-agent'}};const denied=await api.fetch(req('codex-eyes-hands/image/details'),peer);assert.equal(denied.status,403);
 }finally{await f.close();}
 const gone=await api.fetch(req('codex-eyes-hands/image/details'),f.ctx.connection.browserPeer);assert.notEqual(gone.status,200);
});
test('native text rule folds technical text only and keeps details closed',()=>{
 let plugin,rule,component;const source=fs.readFileSync(new URL('../client/client.js',import.meta.url),'utf8');
 const React={createElement:(type,props,...children)=>({type,props,children}),useId:()=> 'image-details-test',useEffect:()=>{},useState:v=>[v,()=>{}]};
 vm.runInNewContext(source,{window:{__ModuleLoader__:{load:x=>plugin=x.factory(n=>{if(n==='react')return React;return {};})}}});
 const ctx={uiConversation:{userText:{register:r=>rule=r}},effect:()=>{},locale:{bind:()=>x=>x},connection:{rpc:{call:()=>assert.fail('no fetch in structural render')}},slots:{inject:(_n,f)=>f(),register:(d,c)=>{if(d.key==='codex-image')component=c;}}};plugin.apply(ctx);
 const id='a'.repeat(64),text='[codex-image] '+JSON.stringify({id,status:'done',summary:'SHORT',keyText:['PRIVATE LONG OCR']})+'\n我的原话';
 const node=rule.match(text,0);assert.equal(text.slice(node.end),'\n我的原话');assert.equal(rule.match('引用 '+text,0),undefined);
 const tree=component({node});assert.ok(!JSON.stringify(tree).includes('PRIVATE LONG OCR'));assert.ok(JSON.stringify(tree).includes('"aria-expanded":false'));assert.ok(JSON.stringify(tree).includes('图片已读取'));
});

test('normal text does not resolve a model or start background vision',async()=>{
 const f=fixture();try{f.ctx.llm.resolveModelInfo=async()=>assert.fail('text messages must not do image work');
 const messages=[{id:'text',source:{kind:'user'},content:[{type:'text',text:'普通聊天'}]}];const r=await f.hook({messages,agent:{id:'s'},signal:new AbortController().signal},async()=>({kind:'enter',messages}));assert.equal(r.messages,messages);assert.equal(f.runs,0);
 }finally{await f.close();}
});

test('image UI never renders a second thumbnail when the message has a native image',()=>{
 let plugin,component;const React={createElement:(type,props,...children)=>({type,props,children}),useId:()=> 'unique',useEffect:()=>{},useState:value=>[value?.status?{...value,preview:'data:image/jpeg;base64,fixture'}:value,()=>{}]};
 vm.runInNewContext(fs.readFileSync(new URL('../client/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:x=>plugin=x.factory(n=>n==='react'?React:{})}}});
 plugin.apply({effect:()=>{},uiConversation:{userText:{register:()=>{}}},locale:{bind:()=>x=>x},connection:{},slots:{inject:(_n,f)=>f(),register:(d,c)=>{if(d.key==='codex-image')component=c;}}});
 const r=component({node:{data:{id:'a'.repeat(64),initial:{status:'done',summary:'fixture'}}}});assert.ok(!JSON.stringify(r).includes('"type":"img"'));
});
