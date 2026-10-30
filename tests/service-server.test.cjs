const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {harness,payload,reply}=require('./service-fixture.cjs');
const P=require('../shared/service-protocol.cjs');
const {openAI,configuration,createGateway}=require('../server/index.cjs');
const {createStore}=require('../server/store.cjs');
test('only valid, unexpired invites authenticate; revocation works; operator credentials never leave the gateway',async()=>{
 const h=await harness();try{
  assert.equal((await h.call('/v1/session',undefined,'not-a-code')).status,401);
  const response=await(await h.call('/v1/session')).json();assert.equal(response.user.name,'시험 사용자');assert.equal(response.quota.dailyRemaining,20);assert.ok(!JSON.stringify(response).includes(h.config.key));assert.ok(!JSON.stringify(response).includes(h.user.token));
  h.store.revoke(h.user.id);assert.equal((await h.call('/v1/enrich',payload())).status,401);assert.equal(h.calls.length,0);
  const another=h.store.invite({name:'만료 확인',days:1});h.setTime(Date.UTC(2026,10,2));assert.equal((await h.call('/v1/session',undefined,another.token)).status,401);
 }finally{await h.close();}
});
test('a repeated or concurrent request calls inference exactly once; changed content cannot reuse its ID',async()=>{
 let finish,started;const began=new Promise(resolve=>started=resolve),hold=new Promise(resolve=>finish=resolve);
 const h=await harness({generate:async input=>{started();await hold;return{text:reply(input.request)};}});try{
  const first=h.call('/v1/enrich',payload());await began;const second=h.call('/v1/enrich',payload());finish();
  const results=await Promise.all([first,second]);assert.ok(results.every(r=>r.status===200));assert.equal(h.calls.length,1);
  const same=await(await h.call('/v1/enrich',payload())).json();assert.equal(same.cached,true);assert.equal((await(await h.call('/v1/session')).json()).quota.dailyRemaining,19);
  const changed=payload();changed.request.title='다른 자료';assert.equal((await h.call('/v1/enrich',changed)).status,409);assert.equal(h.calls.length,1);
 }finally{finish();await h.close();}
});
test('global and individual quotas reserve atomically before inference, including simultaneous users',async()=>{
 let finish,started;const began=new Promise(resolve=>started=resolve),hold=new Promise(resolve=>finish=resolve);
 const h=await harness({daily:1,config:{globalDaily:1},generate:async input=>{started();await hold;return{text:reply(input.request)};}});try{
  const another=h.store.invite({name:'두 번째 사용자'}),first=h.call('/v1/enrich',payload());await began;
  assert.equal((await h.call('/v1/enrich',payload('other-request'),another.token)).status,429);assert.equal(h.calls.length,1);finish();await first;
  assert.equal((await h.call('/v1/enrich',payload('new-request'))).status,429);assert.equal(h.calls.length,1);
 }finally{finish();await h.close();}
});
test('accepted results survive gateway restart without another charge; expired cache does not silently re-run inference',async()=>{
 const h=await harness();let second;try{
  assert.equal((await h.call('/v1/enrich',payload())).status,200);await h.gateway.close();
  const store=createStore(h.filename,{clock:()=>Date.UTC(2026,9,30,3)}),gateway=createGateway({config:h.config,store,generate:()=>{throw Error('Must not infer twice');}});second=gateway;
  await new Promise(resolve=>gateway.server.listen(0,'127.0.0.1',resolve));const address=`http://127.0.0.1:${gateway.server.address().port}`;
  const result=await fetch(address+'/v1/enrich',{method:'POST',headers:{Authorization:'Bearer '+h.user.token,'Content-Type':'application/json'},body:JSON.stringify(payload())});assert.equal(result.status,200);assert.equal((await result.json()).cached,true);
  assert.ok(!(await fs.readFile(h.filename)).includes(Buffer.from(h.user.token)));
 }finally{if(second)await second.close();await fs.rm(h.temp,{recursive:true,force:true});}
 const old=await harness();try{const token=old.store.invite({name:'장기 보관 확인',days:366}).token;await old.call('/v1/enrich',payload(),token);old.setTime(Date.UTC(2026,10,1));assert.equal((await old.call('/v1/enrich',payload(),token)).status,409);old.setTime(Date.UTC(2027,0,30));assert.equal((await old.call('/v1/enrich',payload(),token)).status,409);assert.equal(old.calls.length,1);}finally{await old.close();}
});
test('provider failure and invalid output stay atomic, do not leak secrets, and do not leave an active-user lock',async()=>{
 let fail=true;const h=await harness({generate:input=>{if(fail)throw Error('fixture-not-an-api-credential');return{text:reply(input.request)};}});try{
  const response=await h.call('/v1/enrich',payload());assert.equal(response.status,502);assert.ok(!(await response.text()).includes(h.config.key));assert.equal((await h.call('/v1/enrich',payload())).status,409);assert.equal(h.calls.length,1);
  fail=false;assert.equal((await h.call('/v1/enrich',payload('second'))).status,200);assert.equal(h.calls.length,2);
 }finally{await h.close();}
 const bad=await harness({generate:()=>({text:'{"version":1,"notes":[]}'})});try{assert.equal((await bad.call('/v1/enrich',payload())).status,502);assert.equal((await bad.call('/v1/enrich',payload())).status,409);assert.equal(bad.calls.length,1);}finally{await bad.close();}
});
test('disabled defaults, malformed images and oversized input never reach the provider',async()=>{
 const off=configuration({});assert.equal(off.enabled,false);assert.equal(off.globalDaily,0);
 const h=await harness({config:{enabled:false}});try{assert.equal((await h.call('/v1/enrich',payload())).status,503);assert.equal(h.calls.length,0);}finally{await h.close();}
 const good=await harness();try{const bad=payload();bad.images[0].dataUrl='https://example.invalid/image.png';assert.equal((await good.call('/v1/enrich',bad)).status,400);const large=payload();large.request.slides[0].existingNotes='x'.repeat(3001);assert.equal((await good.call('/v1/enrich',large)).status,400);assert.equal(good.calls.length,0);assert.equal((await good.call('/v1/session')).status,200);}finally{await good.close();}
});
test('Responses adapter sends an operator-selected model, image/text and strict JSON schema without copying credentials into content',async()=>{
 const input=payload(),calls=[];const result=await openAI({key:'fixture-not-an-api-credential',model:'fixture-vision'},input,{fetcher:async(url,options)=>{calls.push({url,options});return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:reply(input.request)}]}],usage:{input_tokens:11,output_tokens:22}});}});
 const body=JSON.parse(calls[0].options.body);assert.equal(calls[0].url,'https://api.openai.com/v1/responses');assert.equal(body.model,'fixture-vision');assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.equal(body.input[0].content.at(-1).type,'input_image');assert.ok(body.input[0].content.at(-2).text.includes('slideId: slide-1'));assert.ok(!calls[0].options.body.includes('fixture-not-an-api-credential'));assert.equal(result.usage.output_tokens,22);
 await assert.rejects(openAI({key:'fixture',model:'fixture'},input,{fetcher:async()=>Response.json({status:'incomplete',output:[]})}),{code:'upstream_failed'});
});
