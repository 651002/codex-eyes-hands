import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseLegacyImage } from '../plugin/image-messages.mjs';
const legacy=p=>'[图片附件] 用户附带了一张图片（image/png），当前模型不支持图片输入，已落地为本地文件。\n本地文件绝对路径: '+p+'\n请先用本地视觉工具（codex-bridge 技能的 see 模式）查看该图片，拿到文字描述后再回答用户。';
test('legacy wrapper is separated from the exact user question, never arbitrary prose',()=>{
 const p=path.join(os.tmpdir(),'dsh-incoming-images','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png');
 const v=parseLegacyImage(legacy(p)+'\n为什么安装失败？');
 assert.equal(v.file,p); assert.equal(v.rest,'\n为什么安装失败？');
 assert.equal(parseLegacyImage('引用：'+legacy(p)),null);
 assert.equal(parseLegacyImage(legacy('C:/private/key.png')),null);
});

const { ImageMessages, compactVision } = await import('../plugin/image-messages.mjs');
const base=process.env.CODEX_EYES_HANDS_TEST_ROOT || 'E:/Codex/备份仓库/2026-11-20/codex-eyes-hands插件升级_20261120_150016/测试临时文件';
fs.mkdirSync(base,{recursive:true});
test('background image admission preserves original question and image while keeping long OCR out of model text',async()=>{
 const dir=fs.mkdtempSync(path.join(base,'image-message-'));const input=path.join(os.tmpdir(),'dsh-incoming-images','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png');
 // No file read is needed for a native image reference.
 let runs=0;const full={overview:'安装失败的截图',text:[{text:'ERROR '.repeat(3000)}],elements:[],uncertainties:[],cache:{hit:false}};
 const attachments={imageHostPath:()=>input};
 const service=new ImageMessages({directory:dir,attachments:()=>attachments,vision:async()=>{runs++;return full;}});
 const message={id:'message-1',source:{kind:'user'},content:[{type:'image',attachment:{attachmentId:'sha256:test'}},{type:'text',text:'为什么安装失败？'}]};
 const out=await service.process({agent:{id:'session-1'},messages:[message],signal:new AbortController().signal,modelSelection:{}},false);
 assert.equal(runs,1);assert.equal(out[0].id,message.id);assert.equal(out[0].content[0],message.content[0]);assert.equal(out[0].content[1].text,'为什么安装失败？');
 const marker=out[0].content.at(-1).text;assert.ok(marker.startsWith('[codex-image] '));assert.ok(marker.length<1800);assert.ok(!marker.includes('ERROR '.repeat(1000)));
 const id=JSON.parse(marker.slice('[codex-image] '.length)).id;
 assert.deepEqual(service.details(id,'session-1').full,full);assert.throws(()=>service.details(id,'other-session'),/会话/);
 const reopened=new ImageMessages({directory:dir,attachments:()=>attachments,vision:async()=>assert.fail()});
 assert.equal(reopened.details(id,'session-1').status,'done');
 assert.deepEqual(message.content.length,2); // never mutate source/history
 const same=await service.process({agent:{id:'session-1'},messages:[out[0]],signal:new AbortController().signal},false);assert.equal(runs,1);assert.deepEqual(same,out);
});

test('failed vision is explicit, native vision does not pay again, and cancellation is recorded',async()=>{
 const dir=fs.mkdtempSync(path.join(base,'image-failure-'));let runs=0;
 const c=new AbortController();const m={id:'m',source:{kind:'user'},content:[{type:'image',attachment:{}},{type:'text',text:'检查错误'}]};
 const service=new ImageMessages({directory:dir,attachments:()=>({imageHostPath:()=>'/fixture.png'}),vision:async()=>{runs++;throw Error('fixture failure');}});
 const input={agent:{id:'s'},messages:[m],signal:c.signal};
 assert.deepEqual(await service.process(input,true),[m]);assert.equal(runs,0);
 const out=await service.process(input,false),id=JSON.parse(out[0].content.at(-1).text.slice(14)).id;
 assert.equal(service.details(id,'s').status,'failed');assert.ok(out[0].content.at(-1).text.includes('不能推断'));
 const cancel=new ImageMessages({directory:dir,attachments:()=>({imageHostPath:()=>'/cancel.png'}),vision:async()=>{c.abort(Error('stop'));throw c.signal.reason;}});
 await assert.rejects(cancel.process(input,false),/stop/);
 assert.ok(fs.readdirSync(dir).some(n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8')).status==='cancelled'));
});

test('old attachment text is recovered as an image without editing the original message',async()=>{
 const dir=fs.mkdtempSync(path.join(base,'legacy-'));
 const file=path.join(os.tmpdir(),'dsh-incoming-images','cccccccc-cccc-4ccc-8ccc-cccccccccccc.png');
 assert.ok(path.resolve(file).startsWith('E:'+path.sep),'Fixtures must stay on E drive');
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.from('OFFLINE_IMAGE_FIXTURE'));
 let saved=0;const ref={attachmentId:'sha256:offline-normalized'};
 const service=new ImageMessages({directory:dir,attachments:()=>({saveImage:async i=>{saved++;assert.equal(i.data.toString(),'OFFLINE_IMAGE_FIXTURE');return ref;},imageHostPath:()=>file}),vision:async()=>({overview:'fixture',text:[],uncertainties:[]}),thumbnail:async()=> 'data:image/png;base64,fixture'});
 const raw=legacy(file),m={id:'legacy-message',source:{kind:'user'},content:[{type:'text',text:raw},{type:'text',text:'保留我的问题，不能删。'}]};
 const r=await service.process({agent:{id:'legacy-s'},messages:[m],signal:new AbortController().signal},false);
 assert.equal(saved,1);assert.equal(r[0].content[0].type,'image');assert.equal(r[0].content[0].attachment,ref);assert.equal(r[0].content[1].text,m.content[1].text);assert.equal(m.content[0].text,raw);
 assert.equal((await service.legacyView(raw)).status,'done');assert.throws(()=>service.file('not-a-record'),/无效/);
});

test('retry is explicit, coalesces concurrent clicks and keeps full results session scoped',async()=>{
 const dir=fs.mkdtempSync(path.join(base,'image-retry-'));let runs=0,fail=true,release;
 const service=new ImageMessages({directory:dir,attachments:()=>({imageHostPath:()=>'/retry.png'}),vision:async()=>{runs++;if(fail)throw Error('retry fixture');await new Promise(r=>release=r);return {overview:'recovered',text:[],uncertainties:[]};}});
 const agent={id:'retry-session'},input={agent,messages:[{id:'retry-m',source:{kind:'user'},content:[{type:'image',attachment:{}}]}],signal:new AbortController().signal};
 const out=await service.process(input,false),id=JSON.parse(out[0].content.at(-1).text.slice(14)).id;assert.equal(runs,1);
 fail=false;const a=service.retry(id,agent,input.signal),b=service.retry(id,agent,input.signal);release();await Promise.all([a,b]);assert.equal(runs,2);assert.equal(service.details(id,agent.id).status,'done');
 await service.retry(id,agent,input.signal);assert.equal(runs,2);await assert.rejects(service.retry(id,{id:'different'},input.signal),/会话/);
});

test('after a compressor drops opaque image ids, current-session lookup recovers handles without another model call',async()=>{
 const dir=fs.mkdtempSync(path.join(base,'compressed-lookup-'));let calls=0;
 const service=new ImageMessages({directory:dir,attachments:()=>({}),vision:async()=>{calls++;assert.fail('lookup must not invoke a model');}});
 const record=service.record({overview:'安装截图：缺少依赖',text:[{text:'ERR_MODULE_NOT_FOUND'}],uncertainties:[]},'long-session');
 service.record({overview:'另一个会话的机密',text:[]},'other-session');
 const reopened=new ImageMessages({directory:dir,attachments:()=>({}),vision:async()=>assert.fail()});
 const found=reopened.recent('long-session');assert.equal(found.records.length,1);assert.equal(found.records[0].id,record.id);assert.equal(found.records[0].summary,'安装截图：缺少依赖');assert.ok(!JSON.stringify(found).includes('机密'));
 assert.equal(reopened.details(found.records[0].id,'long-session').full.text[0].text,'ERR_MODULE_NOT_FOUND');assert.equal(calls,0);
 assert.equal(reopened.recent('empty-session').records.length,0);assert.throws(()=>reopened.recent(''),/会话/);
});

test('recovered picture handles can be paged in long sessions without exposing another session',()=>{
 const dir=fs.mkdtempSync(path.join(base,'lookup-pages-'));const s=new ImageMessages({directory:dir});
 for(let i=0;i<12;i++)s.record({overview:'picture-'+i,text:[]},'paging');
 const a=s.recent('paging'),b=s.recent('paging',10,a.nextListOffset);
 assert.equal(a.records.length,10);assert.equal(b.records.length,2);assert.equal(b.nextListOffset,null);assert.equal(new Set([...a.records,...b.records].map(x=>x.id)).size,12);
 assert.throws(()=>s.recent('paging',10,-1),/偏移/);assert.throws(()=>s.recent('paging',100),/limit/);
});

test('new image group uses native source metadata outside the bubble without changing user attribution',async()=>{
 const dir=fs.mkdtempSync(path.join(base,'outside-source-'));
 const s=new ImageMessages({directory:dir,attachments:()=>({imageHostPath:r=>'/fixture-'+r.n+'.png'}),vision:async()=>({overview:'test',text:[],uncertainties:[]})});
 const source={kind:'user',requestId:'unchanged-request'};
 const m={id:'two-native',source,content:[{type:'image',attachment:{n:1}},{type:'image',attachment:{n:2}},{type:'text',text:'两张截图请比较'}]};
 const out=await s.process({agent:{id:'group-s'},messages:[m],signal:new AbortController().signal},false);
 assert.equal(out[0].source.kind,'user');assert.equal(out[0].source.requestId,source.requestId);assert.equal(out[0].source.codexEyesHands.images.length,2);
 assert.equal(source.codexEyesHands,undefined);assert.equal(m.content.length,3);
 for(const b of out[0].content.filter(b=>b.type==='text'&&b.text.startsWith('[codex-image] ')))assert.equal(JSON.parse(b.text.slice(14)).presentation,'outside');
});
