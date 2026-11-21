import path from 'node:path';
import os from 'node:os';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection';
import { ImageMessages, parseLegacyImage } from './image-messages.mjs';

export function installImageExperience(ctx, vision, config) {
 const directory=path.join(config.visionDataDir || path.join(process.env.DSH_HOME || path.join(os.homedir(),'.dsh'),'cache/codex-eyes-hands'),'messages');
 const service=new ImageMessages({directory,attachments:()=>ctx.get('attachments'),vision:(args,exec)=>vision.tool(args,exec),thumbnail:data=>vision.thumbnail(data)});
 const lifetime=new AbortController();
 ctx.effect?.(()=>()=>lifetime.abort(new Error('Plugin unloaded')));
 ctx.inject(['attachments','llm'], c=>{
  if(!c.attachments||!c.llm||!c.on)return;
  c.on('agent/pre-step',async(payload,next)=>{
   const decision=await next();if(decision.kind!=='enter'||config.autoVisionEnabled===false)return decision;
   const hasImages=decision.messages.some(m=>m.source?.kind==='user'&&!m.content?.some(b=>b.type==='text'&&b.text.startsWith('[codex-image] '))&&m.content?.some(b=>b.type==='image'||b.type==='text'&&parseLegacyImage(b.text)));
   if(!hasImages)return decision;
   const selection=payload.modelSelection;const model=selection?await c.llm.resolveModelInfo(selection.provider,selection.model):{};
   const legacy=decision.messages.some(m=>m.source?.kind==='user'&&m.content?.some(b=>b.type==='text'&&parseLegacyImage(b.text)));
   const nativeVision=model.inputModalities===undefined?!legacy:model.inputModalities.includes('image');
   const signal=AbortSignal.any([payload.signal,lifetime.signal]);
   return {...decision,messages:await service.process({...payload,messages:decision.messages,signal},nativeVision)};
  });
 });
 ctx.inject(['connection'], c=>{
  if(!c.connection)return;
  c.effect(()=>{
   const cleanup=[];
   for(const action of ['status','details','legacy','retry'])cleanup.push(c.connection.fetch.register({
    path:'/api/codex-eyes-hands/image/'+action,methods:['POST'],requestBody:'buffered',
    async fetch(request){
     if(c.connection.browserPeer?.principal?.kind!=='owner')return new Response('forbidden',{status:403});
     if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return new Response('expected JSON',{status:415});
     let body;try{body=await request.json();}catch{return new Response('invalid JSON',{status:400});}
     const parsed=clientRequestSchema.safeParse(body);
     if(!parsed.success||parsed.data.method!=='codex-eyes-hands/image/'+action)return new Response('invalid envelope',{status:400});
     let result;try{
      const args=parsed.data.payload??{};const signal=AbortSignal.any([request.signal,lifetime.signal]);signal.throwIfAborted();
      let value;
      if(action==='legacy')value=await service.legacyView(args.text,signal);
      else if(action==='status')value=service.view(args.id);
      else if(action==='details')value=service.details(args.id).full??{error:service.details(args.id).error};
      else {const r=service.details(args.id);const agent=c.get('agents')?.get(r.sessionId);if(!agent)throw Error('请先打开原会话，再重试识图');value=await service.retry(args.id,agent,signal);}
      result={ok:true,value};
     }catch(e){result={ok:false,error:{code:'image/error',message:String(e.message).slice(0,220),details:{}}};}
     return Response.json({type:'server-response',rpcId:parsed.data.rpcId,result});
    }
   }));
   return async()=>{for(const dispose of cleanup)await dispose();};
  });
 });
 ctx.inject(['tools'],c=>{
  if(!c.tools)return;
  c.tools.register(defineTool({
   name:'codex_vision_details',description:'按需读取当前会话已经完成的识图全文；不会重新调用模型。大结果按字符分页。',
   parameters:{id:{type:'string',required:true},offset:{type:'number'},limit:{type:'number'}},
   output:{schema:{type:'string'},render:(_args,v)=>[{type:'text',text:v}]},isConcurrencySafe:()=>true,
   execute:async(args,exec)=>{
    if(!exec.agent)throw Error('需要当前会话');const r=service.details(args.id,String(exec.agent.id));
    const offset=args.offset??0,limit=args.limit??12000;
    if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>24000)throw Error('offset须非负整数，limit须1到24000');
    const text=JSON.stringify(r.full??{status:r.status,error:r.error});
    return JSON.stringify({id:r.id,status:r.status,totalCharacters:text.length,offset,text:text.slice(offset,offset+limit),nextOffset:offset+limit<text.length?offset+limit:null});
   }
  }));
 });
 return service;
}
