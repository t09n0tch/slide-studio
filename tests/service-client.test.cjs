const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const {harness,payload,reply}=require('./service-fixture.cjs');
const {createService}=require('../electron/service.cjs');
const P=require('../shared/service-protocol.cjs');
function storage(){const key=crypto.randomBytes(32);return{isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'keychain',encryptString(text){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(text),cipher.final(),cipher.getAuthTag()]);},decryptString(bytes){const decipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString();}};}
test('portable invite codes accept HTTPS or loopback only and never contain an OpenAI API key',()=>{
 const token=crypto.randomBytes(24).toString('base64url');assert.deepEqual(P.decodeInvite(P.encodeInvite('https://studio.example',token)),{endpoint:'https://studio.example',token});
 for(const address of ['http://studio.example','file:///tmp/a','https://user:password@studio.example','https://studio.example/path','https://studio.example?secret=value'])assert.throws(()=>P.encodeInvite(address,token));
 assert.throws(()=>P.decodeInvite('not-an-invite'));assert.throws(()=>P.decodeInvite('SS1.'+Buffer.from('{}').toString('base64url')));
});
test('native connection is encrypted, survives restart and exposes only a safe session view',async()=>{
 const h=await harness(),safeStorage=storage(),storageDir=path.join(h.temp,'client');try{
  const client=createService({storageDir,safeStorage});assert.equal((await client.session()).connected,false);const session=await client.connect(h.code);assert.equal(session.user.name,'시험 사용자');assert.ok(!JSON.stringify(session).includes(h.user.token));
  assert.ok(!(await fs.readFile(path.join(storageDir,'connection.enc'))).includes(Buffer.from(h.user.token)));
  const restarted=createService({storageDir,safeStorage});assert.equal((await restarted.session()).connected,true);assert.equal((await restarted.generate(payload())).text,reply(payload().request));await restarted.disconnect();assert.equal((await restarted.session()).connected,false);
 }finally{await h.close();}
});
test('cancelling transport preserves the original request ID and reuses the completed server result',async()=>{
 let finish,started;const began=new Promise(resolve=>started=resolve),hold=new Promise(resolve=>finish=resolve);
 const h=await harness({generate:async input=>{started();await hold;return{text:reply(input.request)};}}),client=createService({storageDir:path.join(h.temp,'client'),safeStorage:storage()});try{
  await client.connect(h.code);const result=client.generate(payload());await began;client.cancel();await assert.rejects(result,{code:'cancelled'});finish();
  assert.equal((await client.generate(payload())).text,reply(payload().request));assert.equal(h.calls.length,1);assert.equal((await client.session()).quota.dailyRemaining,19);
 }finally{finish();await h.close();}
});
test('a lost proxy response remains retryable and does not cause duplicate model inference',async()=>{
 const h=await harness();let drop=true;const client=createService({storageDir:path.join(h.temp,'client'),safeStorage:storage(),fetcher:async(url,options)=>{const response=await fetch(url,options);if(String(url).endsWith('/v1/enrich')&&drop){drop=false;await response.arrayBuffer();return new Response('Gateway temporarily unavailable',{status:502});}return response;}});
 try{await client.connect(h.code);await assert.rejects(client.generate(payload()),{code:'connection_failed'});assert.equal((await client.generate(payload())).text,reply(payload().request));assert.equal(h.calls.length,1);}finally{await h.close();}
});
