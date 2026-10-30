'use strict';
const crypto=require('node:crypto');
const MAX_BODY=16*1024*1024;
const MESSAGES={invalid_invite:'초대 코드를 확인해 주세요.',unauthorized:'초대 코드가 만료되거나 연결이 해제되었습니다. 운영자에게 새 코드를 요청해 주세요.',disabled:'AI 서비스가 아직 준비되지 않았습니다. 운영자에게 문의해 주세요.',service_limit:'AI 서비스의 이용 한도에 도달했습니다. 완료한 노트는 유지됩니다. 운영자에게 문의하거나 잠시 후 다시 시도해 주세요.',quota_exceeded:'사용 가능한 슬라이드 수를 모두 사용했습니다. 운영자에게 문의하거나 다음 이용 기간에 다시 시도해 주세요.',busy:'다른 AI 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.',invalid_request:'보완할 자료를 읽지 못했습니다. 슬라이드와 음성 기록을 확인해 주세요.',request_changed:'이 요청의 자료가 변경되었습니다. AI 보완을 다시 시작해 주세요.',uncertain:'이전 요청의 결과를 확인할 수 없습니다. 다시 시작하면 새 요청으로 처리됩니다.',expired_result:'이전 요청의 보관 기간이 지났습니다. 다시 시작하면 새 요청으로 처리됩니다.',upstream_failed:'AI 응답을 받지 못했습니다. 완료된 노트는 유지됩니다.',invalid_response:'AI 응답 형식을 확인하지 못했습니다. 완료된 노트는 유지됩니다.',cancelled:'AI 보완을 중단했습니다. 진행 중이던 묶음은 같은 요청으로 이어갈 수 있습니다.',connection_failed:'AI 서버에 연결하지 못했습니다. 인터넷 연결과 서비스 상태를 확인해 주세요.',encryption_unavailable:'이 컴퓨터에서 연결 정보를 안전하게 저장할 수 없습니다.'};
function problem(code,status=400){const error=new Error(MESSAGES[code]||MESSAGES.connection_failed);error.code=code;error.status=status;return error;}
function publicError(error){const code=Object.hasOwn(MESSAGES,error?.code)?error.code:'connection_failed';return{code,message:MESSAGES[code]};}
function endpoint(value){
 let url;try{url=new URL(value);}catch{throw problem('invalid_invite');}
 const local=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
 if((url.protocol!=='https:'&&!(url.protocol==='http:'&&local))||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw problem('invalid_invite');
 return url.origin;
}
function encodeInvite(address,token){return 'SS1.'+Buffer.from(JSON.stringify({endpoint:endpoint(address),token})).toString('base64url');}
function decodeInvite(code){
 try{if(typeof code!=='string'||code.length>2500||!/^SS1\.[A-Za-z0-9_-]+$/.test(code.trim()))throw Error();const value=JSON.parse(Buffer.from(code.trim().slice(4),'base64url').toString('utf8'));if(typeof value.token!=='string'||!/^[A-Za-z0-9_-]{32,100}$/.test(value.token))throw Error();return{endpoint:endpoint(value.endpoint),token:value.token};}catch{throw problem('invalid_invite');}
}
function hash(value){return crypto.createHash('sha256').update(value).digest('hex');}
function validatePayload(value){
 const request=value?.request,images=value?.images,id=string=>typeof string==='string'&&/^[A-Za-z0-9-]{1,100}$/.test(string),text=(s,max)=>typeof s==='string'&&s.length<=max;
 if(!request||request.version!==1||!id(request.id)||!text(request.title,200)||!Array.isArray(request.slides)||request.slides.length<1||request.slides.length>4||!Array.isArray(images)||images.length!==request.slides.length)throw problem('invalid_request');
 const ids=new Set();let speechLength=0;
 const slides=request.slides.map((ref,i)=>{
  if(!ref||!id(ref.id)||ids.has(ref.id)||!Number.isInteger(ref.number)||ref.number<1||!text(ref.title,200)||!text(ref.existingNotes||'',3000)||!text(ref.fingerprint,100)||!(ref.start===null||Number.isFinite(ref.start)&&ref.start>=0))throw problem('invalid_request');ids.add(ref.id);
  const out={id:ref.id,number:ref.number,title:ref.title,start:ref.start,existingNotes:ref.existingNotes||'',fingerprint:ref.fingerprint};
  if(ref.speech){const speech=ref.speech;if(speech.source!=='clovanote'||!text(speech.fingerprint,100)||!Array.isArray(speech.cues)||speech.cues.length>10000||!Array.isArray(speech.intervals)||speech.intervals.length>10000)throw problem('invalid_request');
   const span=v=>{if(!v||!Number.isFinite(v.start)||!Number.isFinite(v.end)||v.start<0||v.end<v.start)throw problem('invalid_request');return{start:v.start,end:v.end};};
   out.speech={source:'clovanote',fingerprint:speech.fingerprint,intervals:speech.intervals.map(span),cues:speech.cues.map(c=>{if(!text(c.text,120000)||!text(c.speaker,100))throw problem('invalid_request');speechLength+=c.text.length;return{...span(c),speaker:c.speaker,text:c.text};})};
  }
  const image=images[i];if(image?.slideId!==ref.id||typeof image.dataUrl!=='string'||image.dataUrl.length>4*1024*1024||!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl))throw problem('invalid_request');
  const encoded=image.dataUrl.slice(image.dataUrl.indexOf(',')+1),bytes=Buffer.from(encoded,'base64');if(bytes.toString('base64')!==encoded||bytes.length<4||(image.dataUrl.startsWith('data:image/png;')?!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes[0]!==255||bytes[1]!==216))throw problem('invalid_request');
  return out;
 });
 if(speechLength>120000)throw problem('invalid_request');
 return {request:{version:1,id:request.id,title:request.title,slides},images:images.map(image=>({slideId:image.slideId,dataUrl:image.dataUrl}))};
}
function replySchema(request){
 const ids=request.slides.map(s=>s.id),content={title:{type:'string'},markdown:{type:'string'}};
 return{type:'object',additionalProperties:false,required:['version','requestId','notes','supplements'],properties:{version:{type:'integer',enum:[1]},requestId:{type:'string',enum:[request.id]},notes:{type:'array',items:{type:'object',additionalProperties:false,required:['slideId','title','markdown'],properties:{slideId:{type:'string',enum:ids},...content}}},supplements:{type:'array',items:{type:'object',additionalProperties:false,required:['afterSlideId','title','markdown'],properties:{afterSlideId:{type:'string',enum:ids},...content}}}}};
}
function validateReply(text,request){
 let value;try{if(typeof text!=='string'||text.length>600000)throw Error();value=JSON.parse(text);}catch{throw problem('invalid_response',502);}
 const ids=new Set(request.slides.map(s=>s.id)),seen=new Set(),valid=row=>row&&typeof row.title==='string'&&row.title.trim()&&row.title.length<=150&&typeof row.markdown==='string'&&row.markdown.trim()&&row.markdown.length<=16000;
 if(value?.version!==1||value.requestId!==request.id||!Array.isArray(value.notes)||value.notes.length!==ids.size||!Array.isArray(value.supplements)||value.supplements.length>2)throw problem('invalid_response',502);
 for(const row of value.notes){if(!valid(row)||!ids.has(row.slideId)||seen.has(row.slideId))throw problem('invalid_response',502);seen.add(row.slideId);}
 if(value.supplements.some(row=>!valid(row)||!ids.has(row.afterSlideId)))throw problem('invalid_response',502);
 return JSON.stringify(value);
}
module.exports={MAX_BODY,MESSAGES,problem,publicError,endpoint,encodeInvite,decodeInvite,hash,validatePayload,replySchema,validateReply};
