const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createChatGPT,streamText,equal,authEndpoint,publicError}=require('../electron/chatgpt.cjs');
const {identityVerifier}=require('../electron/chatgpt-jwt.cjs');
function stream(events,chunkSize=11){const bytes=new TextEncoder().encode(events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join(''));let index=0;return new Response(new ReadableStream({pull(c){if(index===bytes.length){c.close();return;}c.enqueue(bytes.slice(index,index+=Math.min(chunkSize,bytes.length-index)));}}),{headers:{'content-type':'text/event-stream'}});}
test('Responses requires completed inference, decodes arbitrary UTF-8/SSE chunk boundaries, rejects late usage failures',async()=>{
 assert.equal(await streamText(stream([{type:'response.output_text.delta',delta:'강의 설명'},{type:'response.completed',response:{status:'completed'}}],1),new AbortController().signal),'강의 설명');
 await assert.rejects(streamText(stream([{type:'response.output_text.delta',delta:'partial'},{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}]),new AbortController().signal),e=>e.code==='subscription_sharing_usage_limit_exceeded');
 await assert.rejects(streamText(stream([{type:'response.output_text.delta',delta:'partial'}]),new AbortController().signal),e=>e.code==='response_incomplete');
});
test('state comparison handles hostile Unicode, discovery forbids off-origin credential destinations, errors redact secrets',()=>{
 assert.equal(equal('x','가'),false);assert.equal(equal('same','same'),true);assert.throws(()=>authEndpoint('https://evil.example/token'));assert.throws(()=>authEndpoint('https://auth.openai.com@evil.example/'));
 assert.ok(!JSON.stringify(publicError(new Error('access-secret'))).includes('access-secret'));
});
async function harness(t,{sharing=true,expires=3600,wrongNonce=false,failRefreshVerification=false}={}){
 const {generateKeyPair,SignJWT,exportJWK}=await import('jose');const pair=await generateKeyPair('RS256'),jwk=await exportJWK(pair.publicKey);jwk.kid='fixture';
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'studio-auth-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
 const key=crypto.randomBytes(32),calls=[],authorizations=[];let nonce='',clientId='oaiapp_fixture',refreshes=0,verificationFailed=false;
 const safeStorage={isEncryptionAvailable:()=>true,encryptString(text){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),body]);},decryptString(bytes){const c=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));c.setAuthTag(bytes.subarray(12,28));return Buffer.concat([c.update(bytes.subarray(28)),c.final()]).toString();}};
 const token=async(refresh=false)=>({access_token:'access-secret-'+refreshes,refresh_token:'refresh-secret-'+refreshes,token_type:'Bearer',expires_in:refresh?3600:expires,scope:'openid profile email offline_access resource.invoke'+(sharing?' chatgpt.tokens.use.direct':''),id_token:await new SignJWT({email:'fixture@example.test',...(refresh?{}:{nonce:wrongNonce?'wrong':nonce})}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setSubject('user-fixture').setIssuer('https://auth.openai.com').setAudience(clientId).setIssuedAt().setExpirationTime('1h').sign(pair.privateKey)});
 const fetcher=async(url,options={})=>{const value=String(url);calls.push({url:value,options});
  if(value.endsWith('openid-configuration'))return Response.json({issuer:'https://auth.openai.com',authorization_endpoint:'https://auth.openai.com/api/accounts/authorize',token_endpoint:'https://auth.openai.com/api/accounts/oauth/token',jwks_uri:'https://auth.openai.com/jwks',revocation_endpoint:'https://auth.openai.com/revoke'});
  if(value.endsWith('/jwks'))return Response.json({keys:[jwk]});
  if(value.endsWith('/oauth/token')){const form=options.body;assert.equal(form.get('resource'),'https://api.openai.com/v1');const refresh=form.get('grant_type')==='refresh_token';if(refresh)refreshes++;return Response.json(await token(refresh));}
  if(value.endsWith('/models'))return Response.json({models:[{slug:'test-vision',display_name:'Test Vision',visibility:'list'},{slug:'hidden',display_name:'Hidden',visibility:'hidden'}]});
  if(value.endsWith('/responses'))return stream([{type:'response.output_text.delta',delta:'completed text'},{type:'response.completed',response:{status:'completed'}}]);
  if(value.endsWith('/revoke'))return new Response(null,{status:200});throw new Error('Unexpected destination');
 };
 const client=createChatGPT({storageDir:temp,safeStorage,fetcher,verifierFactory:(url,fetch)=>{const verify=identityVerifier(url,fetch);return async(...args)=>{if(failRefreshVerification&&refreshes&&!verificationFailed){verificationFailed=true;throw new Error('temporary JWKS outage');}return verify(...args);};},openBrowser:async url=>{
  const u=new URL(url);authorizations.push(u);nonce=u.searchParams.get('nonce');clientId=u.searchParams.get('client_id')==='dynamic_agent_client'?'oaiapp_fixture':u.searchParams.get('client_id');
  assert.equal(u.searchParams.get('agent_name_hint'),authorizations.length===1?'Slide Studio':null);assert.ok(u.searchParams.get('ext_agent_host_id').startsWith('urn:uuid:'));
  const callback=new URL(u.searchParams.get('redirect_uri'));callback.searchParams.set('state','가'.repeat(u.searchParams.get('state').length));assert.equal((await fetch(callback)).status,400);
  callback.searchParams.set('state',u.searchParams.get('state'));callback.searchParams.set('code','synthetic-code');callback.searchParams.set('client_id',clientId);assert.equal((await fetch(callback)).status,200);
 }});
 return {client,calls,temp,safeStorage,authorizations,refreshCount:()=>refreshes};
}
test('actual loopback OAuth validates signed identity and nonce, encrypts at rest, redacts renderer session, reuses registration',async t=>{
 const h=await harness(t),session=await h.client.signIn();assert.equal(session.sharing,true);assert.equal(session.identity.email,'fixture@example.test');assert.ok(!JSON.stringify(session).includes('secret'));
 const bytes=await fs.readFile(path.join(h.temp,'chatgpt.enc'));assert.ok(!bytes.toString().includes('access-secret'));assert.ok(!bytes.toString().includes('refresh-secret'));
 const models=await h.client.models();assert.deepEqual(models,[{slug:'test-vision',displayName:'Test Vision'}]);
 await h.client.signIn();assert.equal(h.authorizations[1].searchParams.get('client_id'),'oaiapp_fixture');assert.equal(h.authorizations[1].searchParams.get('ext_agent_host_id'),h.authorizations[0].searchParams.get('ext_agent_host_id'));
 await h.client.disconnect();assert.equal((await h.client.session()).sharing,false);assert.ok(h.calls.some(c=>c.url.endsWith('/revoke')));
});
test('wrong signed nonce never enables inference, and identity-only login cannot call models',async t=>{
 const bad=await harness(t,{wrongNonce:true});await assert.rejects(bad.client.signIn(),e=>e.code==='identity_invalid');assert.equal((await bad.client.session()).sharing,false);
 const noShare=await harness(t,{sharing:false});assert.equal((await noShare.client.signIn()).sharing,false);await assert.rejects(noShare.client.models(),e=>e.code==='sharing_not_enabled');
});
test('concurrent requests rotate once and encrypted pending refresh recovers without reusing consumed refresh token',async t=>{
 const h=await harness(t,{expires:1,failRefreshVerification:true});await h.client.signIn();await assert.rejects(h.client.models(),e=>e.code==='identity_invalid');assert.equal(h.refreshCount(),1);
 await Promise.all([h.client.models(),h.client.models()]);assert.equal(h.refreshCount(),1);
 const saved=JSON.parse(h.safeStorage.decryptString(await fs.readFile(path.join(h.temp,'chatgpt.enc'))));assert.equal(saved.profiles[0].pending,undefined);assert.equal(saved.profiles[0].tokens.refresh,'refresh-secret-1');
});
test('image inference uses only the public Responses route, selected catalog model, explicit consent, and no unsupported fields',async t=>{
 const h=await harness(t);await h.client.signIn();await h.client.models();
 const request={version:1,id:'request-1',title:'강의',slides:[{id:'slide-1',number:1,start:0,title:'제목',fingerprint:'x'}]},images=[{slideId:'slide-1',dataUrl:'data:image/png;base64,AA=='}];
 await assert.rejects(h.client.generate({request,images,model:'test-vision'}));await assert.rejects(h.client.generate({request,images,model:'hidden',consented:true}),e=>e.code==='model_unavailable');
 assert.equal((await h.client.generate({request,images,model:'test-vision',consented:true})).text,'completed text');
 const call=h.calls.find(c=>c.url.endsWith('/responses')),body=JSON.parse(call.options.body);assert.equal(call.url,'https://api.openai.com/v1/responses');assert.equal(call.options.redirect,'error');assert.equal(body.store,false);assert.equal(body.stream,true);assert.equal(body.input[0].content.at(-1).type,'input_image');assert.deepEqual(Object.keys(body).sort(),['input','model','store','stream']);
 const withSpeech=structuredClone(request);withSpeech.slides[0].speech={source:'clovanote',fingerprint:'speech-fixture',intervals:[{start:0,end:35}],cues:[{start:0,end:35,speaker:'참석자 1',text:'A reason spoken by the lecturer.'}]};
 await h.client.generate({request:withSpeech,images,model:'test-vision',consented:true});
 const speechBody=JSON.parse(h.calls.filter(c=>c.url.endsWith('/responses')).at(-1).options.body);assert.ok(JSON.stringify(speechBody).includes('A reason spoken by the lecturer.'));assert.ok(JSON.stringify(speechBody).includes('lecturerTranscript'));
 const sent=h.calls.filter(c=>c.url.endsWith('/responses')).length;withSpeech.slides[0].speech.cues[0].start=-1;await assert.rejects(h.client.generate({request:withSpeech,images,model:'test-vision',consented:true}),e=>e.code==='invalid_response');assert.equal(h.calls.filter(c=>c.url.endsWith('/responses')).length,sent);
});
