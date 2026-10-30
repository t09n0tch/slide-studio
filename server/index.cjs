'use strict';
const http=require('node:http'),path=require('node:path');
const A=require('../js/ai.js');
const P=require('../shared/service-protocol.cjs');
const {createStore}=require('./store.cjs');
function configuration(env=process.env){
 const integer=(name,fallback,max)=>{const value=Number(env[name]??fallback);if(!Number.isInteger(value)||value<0||value>max)throw Error(`Invalid ${name}`);return value;};
 const key=(env.OPENAI_API_KEY||'').trim(),model=(env.OPENAI_MODEL||'').trim(),globalDaily=integer('STUDIO_DAILY_PAGES',0,1000000),globalMonthly=integer('STUDIO_MONTHLY_PAGES',0,10000000),effort=env.OPENAI_REASONING_EFFORT||'';
 if(effort&&!['low','medium','high','xhigh','max'].includes(effort))throw Error('Invalid OPENAI_REASONING_EFFORT');
 return{key,model,globalDaily,globalMonthly,effort,maxOutput:integer('OPENAI_MAX_OUTPUT_TOKENS',12000,32000)||12000,enabled:!!key&&!!model&&globalDaily>0&&globalMonthly>0,maxConcurrent:integer('STUDIO_CONCURRENT',2,20)||1,filename:env.STUDIO_DATABASE||path.join(__dirname,'data','studio.sqlite'),timeZone:env.STUDIO_TIME_ZONE||'Asia/Seoul'};
}
async function openAI(config,payload,{fetcher=fetch}={}){
 const response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${config.key}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(120000),body:JSON.stringify({model:config.model,store:false,max_output_tokens:config.maxOutput||12000,...(config.effort?{reasoning:{effort:config.effort}}:{}),text:{format:{type:'json_schema',name:'slide_studio_notes',strict:true,schema:P.replySchema(payload.request)}},input:[{role:'user',content:[{type:'input_text',text:A.prompt(payload.request)},...payload.images.flatMap((image,index)=>[{type:'input_text',text:`슬라이드 ${payload.request.slides[index].number} · slideId: ${image.slideId}`},{type:'input_image',image_url:image.dataUrl}])]}]})});
 if(!response.ok)throw P.problem(response.status===429?'service_limit':'upstream_failed',response.status===429?429:502);
 const value=await response.json();if(value.status!=='completed')throw P.problem('upstream_failed',502);
 const text=(value.output||[]).flatMap(item=>item.type==='message'?item.content||[]:[]).filter(item=>item.type==='output_text').map(item=>item.text).join('');
 return{text:P.validateReply(text,payload.request),usage:value.usage||{}};
}
function createGateway({config=configuration(),store=createStore(config.filename,{timeZone:config.timeZone}),generate=payload=>openAI(config,payload)}={}){
 const pending=new Map();let active=0,reading=0,pruneTimer;
 const send=(res,status,value)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.url==='/health'&&req.method==='GET'){send(res,200,{ok:true,configured:config.enabled,version:1});return;}
   const user=store.authenticate(req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'');
   if(req.url==='/v1/session'&&req.method==='GET'){send(res,200,store.session(user,config));return;}
   if(req.url!=='/v1/enrich'||req.method!=='POST'){send(res,404,{error:{code:'not_found',message:'Not found'}});return;}
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')||Number(req.headers['content-length']||0)>P.MAX_BODY)throw P.problem('invalid_request',413);
   if(reading>=8)throw P.problem('busy',429);reading++;
   let body;try{const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>P.MAX_BODY)throw P.problem('invalid_request',413);chunks.push(chunk);}try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw P.problem('invalid_request');}}finally{reading--;}
   const payload=P.validatePayload(body),digest=P.hash(JSON.stringify(payload)),id=payload.request.id,key=`${user.id}:${id}`,old=store.existing(user,id,digest);
   if(old){
    if(old.state==='completed'){if(!old.response)throw P.problem('expired_result',409);send(res,200,{text:old.response,cached:true});return;}
    if(old.state==='failed')throw P.problem(old.error||'uncertain',409);
    if(pending.has(key)){send(res,200,await pending.get(key));return;}
    throw P.problem('uncertain',409);
   }
   if(active>=config.maxConcurrent||[...pending.keys()].some(value=>value.startsWith(`${user.id}:`)))throw P.problem('busy',429);
   store.reserve(user,id,digest,payload.request.slides.length,config);active++;
   const task=Promise.resolve().then(async()=>{try{const result=await generate(payload),text=P.validateReply(result.text,payload.request);store.complete(user,id,text,result.usage);return{text,cached:false};}catch(error){const safe=P.publicError(error),code=safe.code==='connection_failed'?'upstream_failed':safe.code;store.fail(user,id,code);throw P.problem(code,error.status||502);}finally{active--;pending.delete(key);}});pending.set(key,task);
   send(res,200,await task);
  }catch(error){send(res,error.status||500,{error:P.publicError(error)});}finally{if(!req.complete)req.resume();}
 });
 server.headersTimeout=10000;server.requestTimeout=30000;
 server.once('listening',()=>{store.recover();store.prune();pruneTimer=setInterval(()=>store.prune(),60000);pruneTimer.unref();});
 return{server,store,async close(){clearInterval(pruneTimer);await new Promise(resolve=>server.close(resolve));await Promise.allSettled([...pending.values()]);store.close();}};
}
if(require.main===module){
 const config=configuration(),gateway=createGateway({config}),host=process.env.STUDIO_HOST||'127.0.0.1',port=Number(process.env.PORT||8787);
 gateway.server.listen(port,host,()=>console.log(`Slide Studio AI listening on ${host}:${port}; inference ${config.enabled?'enabled':'not configured'}.`));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>gateway.close().then(()=>process.exit(0)));
}
module.exports={configuration,openAI,createGateway};
