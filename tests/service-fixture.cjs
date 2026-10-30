const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createStore}=require('../server/store.cjs');
const {createGateway}=require('../server/index.cjs');
const P=require('../shared/service-protocol.cjs');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwS8AAAAASUVORK5CYII=';
function payload(id='request-1',count=1){return{request:{version:1,id,title:'테스트 강의',slides:Array.from({length:count},(_,i)=>({id:`slide-${i+1}`,number:i+1,start:i*10,title:`슬라이드 ${i+1}`,fingerprint:'fixture-image',existingNotes:''}))},images:Array.from({length:count},(_,i)=>({slideId:`slide-${i+1}`,dataUrl:PNG}))};}
function reply(request,{supplement=false}={}){return JSON.stringify({version:1,requestId:request.id,notes:request.slides.map(s=>({slideId:s.id,title:'자동 학습 노트',markdown:'## 핵심 개념\n\n원본 슬라이드와 교수님 설명을 함께 정리한 테스트 노트입니다.'})),supplements:supplement?[{afterSlideId:request.slides[0].id,title:'개념 보충',markdown:'## 배경 보충\n\n1. 핵심 개념을 확인합니다.\n2. 예시와 연결합니다.'}]:[]});}
async function harness(options={}){
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'studio-gateway-')),filename=path.join(temp,'data','studio.sqlite');let clock=Date.UTC(2026,9,30,3);
 const config={key:'fixture-not-an-api-credential',model:'fixture-vision',enabled:true,globalDaily:100,globalMonthly:1000,maxConcurrent:4,filename,timeZone:'Asia/Seoul',...options.config};
 const calls=[],store=createStore(filename,{clock:()=>clock,timeZone:config.timeZone});
 const gateway=createGateway({config,store,generate:async input=>{calls.push(input);if(options.generate)return options.generate(input);return{text:reply(input.request,options),usage:{input_tokens:12,output_tokens:8}};}});
 await new Promise(resolve=>gateway.server.listen(0,'127.0.0.1',resolve));const endpoint=`http://127.0.0.1:${gateway.server.address().port}`;
 const user=store.invite({name:'시험 사용자',daily:options.daily||20,monthly:options.monthly||200}),code=P.encodeInvite(endpoint,user.token);
 const call=(route,body,token=user.token,signal)=>fetch(endpoint+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...body?{'Content-Type':'application/json'}:{}},body:body?JSON.stringify(body):undefined,signal});
 return{temp,filename,config,store,gateway,calls,user,code,endpoint,call,setTime(value){clock=value;},async close(){await gateway.close();await fs.rm(temp,{recursive:true,force:true});}};
}
module.exports={PNG,payload,reply,harness};
