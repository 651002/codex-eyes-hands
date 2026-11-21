import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function harness(seed={}){
 const state=[],effects=[],changes=[];let index=0,rule,inside,outside,definition;const elements=[];
 const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props,children}),useId:()=> 'group-dialog',useEffect:(f,deps)=>effects.push({f,deps}),useState:initial=>{const i=index++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;changes.push(i);}];}};
 let plugin;vm.runInNewContext(fs.readFileSync(new URL('../client/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:m=>plugin=m.factory(n=>n==='react'?React:{})}},AbortController,setTimeout,clearTimeout});
 const calls=[];const ctx={effect:()=>{},locale:{bind:()=>x=>x},uiConversation:{userText:{register:r=>rule=r}},connection:{rpc:{call:async(channel,method,payload)=>{calls.push({channel,method,payload});return {ok:true,value:seed[method]?.(payload)??{status:'done',summary:{summary:'fixture'}}};}}},slots:{inject:(_n,f)=>f(),register:(d,c)=>{if(d.name==='conversation.chat.user.before'){outside=c;definition=d;}if(d.key==='codex-image')inside=c;return ()=>{};}}};plugin.apply(ctx);
 return {calls,state,effects,get rule(){return rule;},get outside(){return outside;},get select(){return definition.select;},renderInside(node){index=0;effects.length=0;return inside({node});},renderOutside(source){index=0;effects.length=0;const entry=outside({matched:definition.select({kind:'user',source})});return entry.type(entry.props);},async effect(i){await effects[i]?.f();await new Promise(r=>setImmediate(r));},expand(){state[2]=true;},selectImage(i){state[3]=i;},state};
}
function walk(n,filter,out=[]){if(Array.isArray(n)){for(const x of n)walk(x,filter,out);}else if(n&&typeof n==='object'){if(filter(n))out.push(n);walk(n.children,filter,out);}return out;}
const id='a'.repeat(64),id2='b'.repeat(64);
const source={kind:'user',requestId:'unchanged',codexEyesHands:{version:1,images:[{id,status:'done'},{id:id2,status:'done'}]}};
test('native source seat owns one outside-bubble group and hides new inline metadata',()=>{
 const h=harness();assert.equal(h.select({kind:'steering',source}),null);assert.equal(h.select({kind:'user',source:{kind:'user'}}),null);
 const tree=h.renderOutside(source);assert.equal(tree.type,'section');assert.equal(walk(tree,x=>x.type==='button').length,1);assert.ok(JSON.stringify(tree).includes('图片已读取 · 2/2'));
 assert.equal(h.renderInside({data:{items:[{id,initial:{presentation:'outside',status:'done'}},{id:id2,initial:{presentation:'outside',status:'done'}}]}}),null);
 assert.equal(source.requestId,'unchanged');
});
test('one disclosure exposes readable OCR and uncertainty, technical JSON remains a closed optional section',async()=>{
 const full={overview:'记忆系统设置页面',text:[{text:'保存在本机'},{text:'云同步关闭'}],uncertainties:['小字看不清'],source:{path:'PRIVATE_PATH'},elements:[{label:'TECH_ELEMENT'}]};
 const h=harness({'codex-eyes-hands/image/details':()=>full});h.renderOutside(source);assert.equal(h.calls.length,0);
 h.expand();h.renderOutside(source);await h.effect(1);const tree=h.renderOutside(source),text=JSON.stringify(tree);
 assert.ok(text.includes('画面概述'));assert.ok(text.includes('识别文字'));assert.ok(text.includes('看不清的地方'));assert.ok(text.includes('保存在本机'));assert.ok(text.includes('云同步关闭'));
 const technical=walk(tree,x=>x.type==='details');assert.equal(technical.length,1);assert.ok(!technical[0].props?.open);
 const visibleText=n=>Array.isArray(n)?n.map(visibleText).join(''):typeof n==='string'?n:n&&typeof n==='object'?(n.type==='details'&&!n.props?.open?visibleText(n.children[0]):visibleText(n.children)):'';assert.ok(!visibleText(tree).includes('TECH_ELEMENT'));assert.ok(!visibleText(tree).includes('PRIVATE_PATH'));
 assert.deepEqual(h.calls.map(x=>x.method),['codex-eyes-hands/image/details']);
 h.selectImage(1);h.renderOutside(source);await h.effect(1);assert.equal(h.calls[1].payload.id,id2);
});
test('failure is visible; retry invokes only the selected failed image',async()=>{
 const s={...source,codexEyesHands:{version:1,images:[{id,status:'done'},{id:id2,status:'failed'}]}};
 const h=harness({'codex-eyes-hands/image/retry':()=>({status:'done',summary:{summary:'recovered'}}),'codex-eyes-hands/image/details':()=>({overview:'已恢复',text:[],uncertainties:[]})});
 assert.ok(JSON.stringify(h.renderOutside(s)).includes('第2张读取失败'));h.expand();h.selectImage(1);const tree=h.renderOutside(s);
 const retry=walk(tree,x=>x.type==='button'&&x.children.includes('仅重试此图片'))[0];assert.ok(retry);await retry.props.onClick();
 assert.equal(h.calls[0].method,'codex-eyes-hands/image/retry');assert.equal(h.calls[0].payload.id,id2);assert.ok(!h.calls.some(x=>x.payload.id===id));
 assert.ok(JSON.stringify(h.renderOutside(s)).includes('图片已读取 · 2/2'));
});

test('image-only new messages mark an otherwise empty bubble for CSS hiding without hiding actual user prose',()=>{
 const h=harness();const item={id,initial:{presentation:'outside',status:'done'}};
 const hidden=h.renderInside({data:{items:[item],onlyMetadata:true}});assert.equal(hidden.type,'span');assert.equal(hidden.props.hidden,true);assert.ok('data-ceh-empty-image-text' in hidden.props);
 assert.equal(h.renderInside({data:{items:[item],onlyMetadata:false}}),null);
});
