'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const P=require('../shared/service-protocol.cjs');
function createService({storageDir,safeStorage,fetcher=fetch}){
 const filename=path.join(storageDir,'connection.enc');let credentials=null,loading=null,work=null;
 const protectedStorage=()=>{if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw P.problem('encryption_unavailable');};
 async function load(){if(!loading)loading=(async()=>{try{const bytes=await fs.readFile(filename);protectedStorage();const saved=JSON.parse(safeStorage.decryptString(bytes));credentials=P.decodeInvite(P.encodeInvite(saved.endpoint,saved.token));}catch(error){if(error.code==='encryption_unavailable')throw error;credentials=null;}})();await loading;}
 async function save(value){protectedStorage();await fs.mkdir(storageDir,{recursive:true,mode:0o700});const temp=filename+'.'+crypto.randomUUID();try{await fs.writeFile(temp,safeStorage.encryptString(JSON.stringify(value)),{mode:0o600,flag:'wx'});await fs.rename(temp,filename);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}}
 async function request(target,route,{body,signal}={}){
  try{
   const response=await fetcher(target.endpoint+route,{method:body?'POST':'GET',redirect:'error',headers:{Authorization:'Bearer '+target.token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:signal||AbortSignal.timeout(15000)});
   let length=0;const chunks=[];for await(const chunk of response.body){length+=chunk.length;if(length>1024*1024)throw P.problem('invalid_response');chunks.push(Buffer.from(chunk));}
   let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw P.problem(response.status>=500?'connection_failed':'invalid_response');}
   if(!response.ok)throw P.problem(Object.hasOwn(P.MESSAGES,value.error?.code)?value.error.code:'connection_failed',response.status);
   return value;
  }catch(error){if(Object.hasOwn(P.MESSAGES,error?.code))throw error;throw P.problem(signal?.aborted?'cancelled':'connection_failed');}
 }
 function view(value){if(value?.connected!==true||typeof value.enabled!=='boolean'||typeof value.user?.name!=='string'||value.user.name.length>100||!value.quota||!['dailyRemaining','monthlyRemaining','dailyLimit','monthlyLimit'].every(k=>Number.isInteger(value.quota[k])&&value.quota[k]>=0))throw P.problem('invalid_response');return{connected:true,enabled:value.enabled,user:{name:value.user.name},quota:Object.fromEntries(['dailyRemaining','monthlyRemaining','dailyLimit','monthlyLimit'].map(k=>[k,value.quota[k]])),serviceName:'Slide Studio AI',host:new URL(credentials.endpoint).host};}
 async function session(){await load();if(!credentials)return{connected:false};return view(await request(credentials,'/v1/session'));}
 async function connect(code){if(work)throw P.problem('busy');await load();const next=P.decodeInvite(code),previous=credentials;const value=await request(next,'/v1/session');credentials=next;try{const result=view(value);await save(next);return result;}catch(error){credentials=previous;throw error;}}
 async function disconnect(){cancel();await load();credentials=null;await fs.rm(filename,{force:true});return{connected:false};}
 async function generate(payload){
  await load();if(!credentials)throw P.problem('unauthorized');if(work)throw P.problem('busy');const checked=P.validatePayload(payload),controller=new AbortController();work=controller;
  const timer=setTimeout(()=>controller.abort(),150000);
  try{const result=await request(credentials,'/v1/enrich',{body:checked,signal:controller.signal});return{text:P.validateReply(result.text,checked.request)};}finally{clearTimeout(timer);if(work===controller)work=null;}
 }
 function cancel(){work?.abort();}
 return{session,connect,disconnect,generate,cancel};
}
module.exports={createService};
