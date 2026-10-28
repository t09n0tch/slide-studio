/* Slide Studio's direct OAuth/Responses integration, based on the public SIWC
 * protocol. Tokens are confined to this process and OS-encrypted storage. */
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { identityVerifier } = require('./chatgpt-jwt.cjs');
const A = require('../js/ai.js');
const ISSUER = 'https://auth.openai.com', API = 'https://api.openai.com/v1';
const SHARING = 'chatgpt.tokens.use.direct';
const CODES = {
  subscription_sharing_user_not_eligible: '이 계정에서 앱 사용량 공유를 사용할 수 없습니다. 무료 계정 방식으로 계속할 수 있습니다.',
  subscription_sharing_usage_limit_exceeded: 'ChatGPT 또는 이 앱의 사용량 한도에 도달했습니다. 이미 완료한 노트는 유지됩니다. 사용량 설정을 확인하거나 무료 계정 방식으로 이어가세요.',
  subscription_sharing_usage_unavailable: 'ChatGPT 사용량을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  subscription_sharing_unsupported_capability: '선택한 모델이 이 요청의 이미지 또는 기능을 지원하지 않습니다. 다른 모델을 선택해 주세요.',
  subscription_sharing_route_not_supported: '이 계정에서 현재 앱 연결 방식을 사용할 수 없습니다.',
  invalid_grant: 'ChatGPT 연결이 만료되었습니다. 같은 계정으로 다시 로그인해 주세요.',
  access_denied: 'ChatGPT 연결을 취소했습니다.',
  cancelled: '작업을 취소했습니다. 이미 완료한 노트는 유지됩니다.',
  sign_in_required: 'ChatGPT에 로그인한 뒤 사용량 공유를 허용해 주세요.',
  sharing_not_enabled: '로그인은 되었지만 사용량 공유 권한이 없습니다. 연결을 다시 허용하거나 무료 계정 방식을 사용해 주세요.',
  encryption_unavailable: '이 컴퓨터의 계정 암호화 저장소를 사용할 수 없습니다. 무료 계정 방식을 사용해 주세요.',
  identity_invalid: 'ChatGPT 계정의 서명을 확인하지 못했습니다. 다시 연결해 주세요.',
  network_error: 'ChatGPT 연결에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
  response_incomplete: '답변이 끝까지 완료되지 않아 이 묶음은 반영하지 않았습니다. 다시 시도해 주세요.',
  invalid_response: 'ChatGPT 응답 형식을 확인하지 못했습니다. 이 묶음을 다시 시도해 주세요.',
  connection_busy: '진행 중인 연결이나 보완 작업이 끝난 뒤 다시 시도해 주세요.',
  storage_error: '저장한 ChatGPT 연결을 읽지 못했습니다. 계정 암호화 저장소를 확인해 주세요.',
  model_unavailable: '현재 계정의 모델 목록에서 사용할 모델을 선택해 주세요.'
};
function problem(code, message) { const error = new Error(message || CODES[code] || 'ChatGPT 요청을 완료하지 못했습니다. 다시 연결하거나 무료 계정 방식을 사용해 주세요.'); error.code = code; return error; }
function publicError(error) { return { code: CODES[error?.code] ? error.code : 'request_failed', message: CODES[error?.code] || '요청을 완료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.' }; }
function remoteError(body) { return problem(typeof body?.error === 'string' ? body.error : body?.error?.code || body?.code || 'request_failed'); }
function authEndpoint(value) { const u = new URL(value); if (u.origin !== ISSUER || u.username || u.password || u.hash) throw problem('identity_invalid'); return u.href; }
function equal(a,b) { if(typeof a!=='string'||typeof b!=='string')return false;const first=Buffer.from(a),second=Buffer.from(b);return first.length===second.length&&crypto.timingSafeEqual(first,second); }

async function streamText(response, signal) {
  if (!response.ok) { let body; try { body=await response.json(); } catch (_) {} throw remoteError(body); }
  const type=response.headers.get('content-type')?.split(';')[0];
  if(!response.body || (type && type!=='text/event-stream')) throw problem('invalid_response');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',text='',complete=false;
  try {
    while(!complete){
      signal.throwIfAborted(); const {done,value}=await reader.read();
      if(done)break;buffer=(buffer+decoder.decode(value,{stream:true})).replace(/\r\n/g,'\n');
      if(buffer.length>2*1024*1024)throw problem('invalid_response');
      let end;
      while((end=buffer.indexOf('\n\n'))>=0){
        const event=buffer.slice(0,end);buffer=buffer.slice(end+2);
        const data=event.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
        if(!data||data==='[DONE]')continue;let row;try{row=JSON.parse(data);}catch(_){throw problem('invalid_response');}
        if(row.type==='response.failed'||row.type==='error')throw remoteError(row.response||row);
        if(row.type==='response.incomplete')throw problem('response_incomplete');
        if(row.type==='response.output_text.delta'&&typeof row.delta==='string')text+=row.delta;
        if(text.length>A.MAX_REPLY)throw problem('invalid_response');
        if(row.type==='response.completed'){
          if(row.response?.status && row.response.status!=='completed')throw problem('response_incomplete');
          if(!text)text=(row.response?.output||[]).flatMap(v=>v.content||[]).filter(v=>v.type==='output_text').map(v=>v.text||'').join('');
          complete=true;break;
        }
      }
    }
    signal.throwIfAborted();if(!complete||!text.trim()||text.length>A.MAX_REPLY)throw problem('response_incomplete');return text;
  } finally { await reader.cancel().catch(()=>{}); }
}

function createChatGPT({ storageDir, safeStorage, openBrowser, fetcher=globalThis.fetch, verifierFactory=identityVerifier }) {
  const filename=path.join(storageDir,'chatgpt.enc');
  let state=null,metadata=null,verify=null,login=null,work=null,catalog=null;
  let queue=Promise.resolve();
  const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
  function encryption(){if(!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.()==='basic_text')throw problem('encryption_unavailable');}
  async function load(){
    if(state)return state;encryption();
    try{const data=JSON.parse(safeStorage.decryptString(await fs.readFile(filename)));if(data.version!==1||typeof data.hostId!=='string'||!Array.isArray(data.profiles))throw new Error();state=data;}
    catch(error){if(error.code!=='ENOENT')throw problem('storage_error');state={version:1,hostId:'urn:uuid:'+crypto.randomUUID(),active:null,profiles:[]};}
    return state;
  }
  async function save(){
    encryption();await fs.mkdir(storageDir,{recursive:true,mode:0o700});
    const temp=filename+'.'+crypto.randomUUID()+'.tmp';
    try{await fs.writeFile(temp,safeStorage.encryptString(JSON.stringify(state)),{mode:0o600,flag:'wx'});await fs.rename(temp,filename);}
    finally{await fs.rm(temp,{force:true}).catch(()=>{});}
  }
  function active(){return state?.profiles.find(p=>p.id===state.active);}
  function safeProfile(p){return {id:p.id,label:p.label+(p.identity?.email?' · '+p.identity.email:''),status:p.tokens?'connected':'disconnected',sharing:!!p.tokens&&p.scopes?.includes(SHARING),...(p.identity?{identity:p.identity}:{})};}
  async function session(){await load();const p=active();return {status:p?.tokens?'connected':'disconnected',sharing:!!p?.tokens&&p.scopes?.includes(SHARING),profileId:p?.id,identity:p?.identity,profiles:state.profiles.map(safeProfile)};}
  async function json(url,options={}){
    let response;try{response=await fetcher(url,{...options,redirect:'error',signal:options.signal||AbortSignal.timeout(30000)});}catch(error){if(options.signal?.aborted)throw problem('cancelled');throw problem('network_error');}
    let body;try{const raw=await response.text();if(raw.length>1024*1024)throw new Error();body=JSON.parse(raw);}catch(_){throw problem('invalid_response');}
    if(!response.ok)throw remoteError(body);return body;
  }
  async function discovery(signal){
    if(metadata)return metadata;
    const data=await json(ISSUER+'/.well-known/openid-configuration',{signal});
    if(data.issuer!==ISSUER)throw problem('identity_invalid');
    const checked={};for(const key of ['authorization_endpoint','token_endpoint','jwks_uri','revocation_endpoint'])checked[key]=authEndpoint(data[key]);
    metadata=checked;verify=verifierFactory(checked.jwks_uri,fetcher);return metadata;
  }
  function tokens(data,oldScopes){
    if(typeof data.access_token!=='string'||!data.access_token||typeof data.refresh_token!=='string'||!data.refresh_token||typeof data.id_token!=='string'||!data.id_token||!/^Bearer$/i.test(data.token_type)||!Number.isFinite(data.expires_in)||data.expires_in<=0||data.expires_in>86400)throw problem('identity_invalid');
    const scopes=typeof data.scope==='string'?data.scope.split(/\s+/).filter(Boolean):oldScopes||[];
    return {access:data.access_token,refresh:data.refresh_token,idToken:data.id_token,expires:Date.now()+data.expires_in*1000,earliest:data.earliest_refresh_at,scopes};
  }
  async function checkedIdentity(token,clientId,checks){try{return await verify(token,clientId,checks);}catch(_){throw problem('identity_invalid');}}
  async function tokenForRequest(signal){
    return serial(async()=>{
      await load();await discovery(signal);const p=active();if(!p?.tokens&&!p?.pending)throw problem('sign_in_required');
      if(p.pending){const checked=await checkedIdentity(p.pending.tokens.idToken,p.clientId,{subject:p.subject,receivedAt:p.pending.receivedAt});p.tokens=p.pending.tokens;p.scopes=p.tokens.scopes;p.identity=checked.identity;delete p.pending;await save();}
      if(!p.scopes?.includes(SHARING))throw problem('sharing_not_enabled');
      if(p.tokens.expires<=Date.now()+60000){
        const earliest=typeof p.tokens.earliest==='number'?p.tokens.earliest*1000:Date.parse(p.tokens.earliest||'');
        if(Number.isFinite(earliest)&&earliest>Date.now()) {if(p.tokens.expires<=Date.now())throw problem('sign_in_required');}
        else {
          let data;try{data=await json(metadata.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:p.clientId,refresh_token:p.tokens.refresh,resource:API}),signal:AbortSignal.timeout(60000)});}
          catch(error){if(error.code==='invalid_grant'){delete p.tokens;delete p.pending;await save();}throw error;}
          const fresh=tokens(data,p.scopes);p.pending={tokens:fresh,receivedAt:Date.now()};await save();
          const checked=await checkedIdentity(fresh.idToken,p.clientId,{subject:p.subject,receivedAt:p.pending.receivedAt});
          p.tokens=fresh;p.scopes=fresh.scopes;p.identity=checked.identity;delete p.pending;await save();
        }
      }
      signal?.throwIfAborted();if(!p.scopes?.includes(SHARING))throw problem('sharing_not_enabled');return {access:p.tokens.access,profileId:p.id};
    });
  }
  async function signIn({profileId,newProfile=false}={}){
    if(login||work)throw problem('connection_busy');const control=new AbortController();login=control;
    const signal=AbortSignal.any([control.signal,AbortSignal.timeout(8*60000)]);let server;
    try{
      await load();await discovery(signal);signal.throwIfAborted();
      const selected=!newProfile?(state.profiles.find(p=>p.id===(profileId||state.active))):null;
      if(profileId&&!selected)throw problem('sign_in_required');
      const p=selected||{id:crypto.randomUUID(),label:`계정 ${state.profiles.length+1}`,scopes:[]};
      // Persist the installation ID before opening the browser.
      await save();
      const nonce=crypto.randomBytes(32).toString('base64url'),stateValue=crypto.randomBytes(32).toString('base64url'),pkce=crypto.randomBytes(48).toString('base64url');
      let callbackResolve,callbackReject;
      const callback=new Promise((resolve,reject)=>{callbackResolve=resolve;callbackReject=reject;});callback.catch(()=>{});
      server=http.createServer((req,res)=>{
        const address=server.address(),base=`http://127.0.0.1:${address.port}`;let url;
        try{url=new URL(req.url,base);}catch(_){res.writeHead(400).end();return;}
        const finish=(status,text)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'"});res.end(text);};
        if(req.method!=='GET'||req.headers.host!==`127.0.0.1:${address.port}`||url.pathname!=='/auth/callback'){finish(404,'Not found');return;}
        if(!equal(url.searchParams.get('state'),stateValue)){finish(400,'Invalid state');return;}
        const error=url.searchParams.get('error');if(error){finish(400,'연결이 취소되었습니다. Slide Studio로 돌아가 주세요.');callbackReject(problem('access_denied'));return;}
        const code=url.searchParams.get('code'),clientId=url.searchParams.get('client_id')||p.clientId;
        if(!code||code.length>10000||!clientId||clientId==='dynamic_agent_client'||!/^[\w.-]{1,200}$/.test(clientId)||(p.clientId&&p.clientId!==clientId)){finish(400,'Invalid callback');return;}
        finish(200,'연결 정보를 확인하고 있습니다. Slide Studio로 돌아가 주세요.');callbackResolve({code,clientId});
      });
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
      const redirect=`http://127.0.0.1:${server.address().port}/auth/callback`;
      const onAbort=()=>callbackReject(problem('cancelled'));signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();
      const url=new URL(metadata.authorization_endpoint);
      const params={client_id:p.clientId||'dynamic_agent_client',ext_agent_host_id:state.hostId,response_type:'code',redirect_uri:redirect,scope:'openid profile email offline_access resource.invoke '+SHARING,resource:API,state:stateValue,nonce,code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(pkce).digest('base64url')};
      if(!p.clientId)params.agent_name_hint='Slide Studio';
      else if(p.tokens?.idToken)params.id_token_hint=p.tokens.idToken;
      for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
      signal.throwIfAborted();await openBrowser(url.href);
      const received=await callback;signal.removeEventListener('abort',onAbort);server.close();
      // A code can expire; keep its issued registration so a reconnect reuses it.
      p.clientId=received.clientId;if(!selected)state.profiles.push(p);await save();
      const data=await json(metadata.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:p.clientId,code:received.code,code_verifier:pkce,redirect_uri:redirect,resource:API}),signal});
      const fresh=tokens(data),identity=await checkedIdentity(fresh.idToken,p.clientId,{nonce,subject:p.subject});
      p.tokens=fresh;p.scopes=fresh.scopes;p.subject=identity.subject;p.identity=identity.identity;delete p.pending;state.active=p.id;catalog=null;await save();return session();
    }catch(error){if(signal.aborted)throw problem('cancelled');throw error;}
    finally{server?.close();if(login===control)login=null;}
  }
  async function models(){
    if(login)throw problem('connection_busy');const token=await tokenForRequest(AbortSignal.timeout(60000));
    const data=await json(API+'/models',{headers:{Authorization:'Bearer '+token.access}});
    if(!Array.isArray(data.models))throw problem('invalid_response');
    const entries=data.models.filter(m=>m.visibility==='list'&&typeof m.slug==='string'&&m.slug.length<200&&typeof m.display_name==='string').map(m=>({slug:m.slug,displayName:m.display_name.slice(0,200)}));
    catalog={profileId:token.profileId,models:entries};return entries;
  }
  async function generate(payload){
    if(login||work)throw problem('connection_busy');const control=new AbortController();work=control;
    const signal=AbortSignal.any([control.signal,AbortSignal.timeout(5*60000)]);
    try{
      if(payload?.consented!==true||typeof payload.model!=='string'||!payload.request||!Array.isArray(payload.request.slides)||!payload.request.slides.length||payload.request.slides.length>4||!Array.isArray(payload.images)||payload.images.length!==payload.request.slides.length)throw problem('invalid_response');
      const {request,images,model}=payload;
      if(typeof request.id!=='string'||request.id.length>100||typeof request.title!=='string'||request.title.length>200)throw problem('invalid_response');
      const ids=new Set();
      for(const ref of request.slides){if(!ref||typeof ref.id!=='string'||ref.id.length>100||typeof ref.title!=='string'||ref.title.length>200||!Number.isInteger(ref.number)||ids.has(ref.id)||(ref.existingNotes!==undefined&&(typeof ref.existingNotes!=='string'||ref.existingNotes.length>3000)))throw problem('invalid_response');ids.add(ref.id);}
      for(let i=0;i<images.length;i++){if(images[i]?.slideId!==request.slides[i].id||typeof images[i].dataUrl!=='string'||images[i].dataUrl.length>5*1024*1024||!/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(images[i].dataUrl))throw problem('invalid_response');}
      const token=await tokenForRequest(signal);
      if(catalog?.profileId!==token.profileId)await models();
      if(!catalog.models.some(m=>m.slug===model))throw problem('model_unavailable');
      const content=[{type:'input_text',text:A.prompt(request)}];
      images.forEach((image,i)=>{content.push({type:'input_text',text:`슬라이드 ${request.slides[i].number} · slideId ${image.slideId}`},{type:'input_image',image_url:image.dataUrl,detail:'high'});});
      let response;try{response=await fetcher(API+'/responses',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token.access,'Content-Type':'application/json'},body:JSON.stringify({model,store:false,stream:true,input:[{role:'user',content}]}),signal});}
      catch(_){if(signal.aborted)throw problem('cancelled');throw problem('network_error');}
      return {text:await streamText(response,signal)};
    }catch(error){if(signal.aborted)throw problem(control.signal.aborted?'cancelled':'response_incomplete');throw error;}
    finally{if(work===control)work=null;}
  }
  async function selectProfile(id){if(login||work)throw problem('connection_busy');await load();if(!state.profiles.some(p=>p.id===id))throw problem('sign_in_required');state.active=id;catalog=null;await save();return session();}
  async function disconnect(){
    if(login||work)throw problem('connection_busy');await load();const p=active();let warning=false;
    const refresh=p?.pending?.tokens?.refresh||p?.tokens?.refresh;
    if(refresh){try{await discovery();const r=await fetcher(metadata.revocation_endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:refresh,token_type_hint:'refresh_token',client_id:p.clientId}),signal:AbortSignal.timeout(15000)});warning=!r.ok;await r.body?.cancel();}catch(_){warning=true;}}
    if(p){delete p.tokens;delete p.pending;p.scopes=[];}catalog=null;await save();return {...await session(),warning:warning?'이 컴퓨터의 연결은 해제했습니다. 원격 해제는 ChatGPT 설정에서 확인해 주세요.':null};
  }
  return {session,signIn,models,generate,selectProfile,disconnect,cancel(){work?.abort();login?.abort();}};
}
module.exports={createChatGPT,publicError,problem,streamText,authEndpoint,equal};
