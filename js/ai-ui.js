(function(root){
 'use strict';
 const A=root.StudioAI,$=id=>document.getElementById(id),bridge=root.studioDesktop;
 async function native(method,payload){
  if(!bridge)throw new Error('AI 보완은 Windows·Mac 설치 앱에서 사용할 수 있습니다.');
  const result=await bridge[method](payload);if(!result.ok){const error=new Error(result.error.message);error.code=result.error.code;throw error;}return result.value;
 }
 async function resize(source){const image=new Image();image.src=source;await image.decode();const scale=Math.min(1,1536/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.9);}
 function create(hooks){
  let request=null,choice=null,session=null,working=false,connecting=false;
  const state=()=>hooks.get(),changed=()=>hooks.changed();
  const error=err=>{$('aiError').textContent=err.message||String(err);$('aiError').hidden=false;};
  function clearError(){$('aiError').hidden=true;$('aiError').textContent='';}
  function counts(){const current=state(),all=A.sources(current.slides),left=A.pending(current.slides,current.transcript);return{all:all.length,left:left.length,done:all.length-left.length};}
  function render(){
   const current=state(),count=counts(),fresh=!current.slides.length,spoken=current.transcript?.cues?.length||0;
   $('aiBatchSummary').textContent=fresh?'슬라이드를 추출한 뒤 노트와 필요한 보충 설명을 함께 만듭니다.':`${count.all}장 중 ${count.done}장 보완 완료 · ${count.left}장 남음`;
   $('aiAccountStatus').textContent=connecting?'초대 코드를 확인하고 있습니다.':session?.connected?`${session.user.name} · AI 연결됨${session.enabled?'':' · 서비스 준비 중'}`:bridge?'운영자가 전달한 초대 코드로 연결해 주세요.':'AI 보완은 Windows·Mac 설치 앱에서 사용할 수 있습니다.';
   $('aiQuota').textContent=session?.connected?`오늘 ${session.quota.dailyRemaining}장 · 이번 달 ${session.quota.monthlyRemaining}장 이용 가능`:'';
   $('aiStart').textContent=fresh?'추출하고 AI 보완하기':request?'이어서 AI 보완하기':count.left?'AI 보완하기':'모든 슬라이드 보완 완료';
   $('aiStart').disabled=working||connecting||!session?.connected||(!session.enabled&&!request)||(!fresh&&!count.left);
   $('aiConnect').disabled=connecting||working||!bridge;$('aiInvite').disabled=connecting||working||!bridge;$('aiDisconnect').hidden=!session?.connected;$('aiDisconnect').disabled=working||connecting;
   $('aiSkip').textContent=fresh?'보완 없이 슬라이드만 추출':'편집 화면으로 돌아가기';
   $('aiSpeechSummary').textContent=spoken?`교수님 음성 원문 ${spoken}개 문단을 함께 사용합니다.`:'교수님 설명도 넣으려면 클로바노트 원문을 가져오세요.';
   $('aiSourceNotice').textContent=`AI 보완하기를 누르면 선택한 자료(슬라이드 이미지·기존 노트${spoken?'·연결한 음성 원문':''})를 ${session?.host?session.host+' AI 서버와 ':'AI 서버와 '}OpenAI에 보내 보완합니다. 결과는 24시간 동안 이어쓰기에 사용하며, 만료되면 서버에서 정리합니다.`;
  }
  async function refresh(){if(!bridge){render();return;}try{session=await native('serviceSession');if(!session.connected)$('aiConnection').open=true;}catch(err){error(err);}render();}
  function close(){if(choice){const resolve=choice;choice=null;resolve(null);}$('aiDialog').close();}
  async function connect(){if(connecting||working)return;connecting=true;clearError();render();try{session=await native('connectService',$('aiInvite').value.trim());$('aiInvite').value='';$('aiConnection').open=false;}catch(err){error(err);}finally{connecting=false;render();}}
  async function automatic(){
   if(working)return;clearError();working=true;$('aiDialog').close();
   try{
    const total=A.pending(state().slides,state().transcript).length;let done=0;
    await hooks.work(async({signal,report})=>{
     const cancel=()=>native('cancelService').catch(()=>{});signal.addEventListener('abort',cancel,{once:true});
     try{
      while(A.pending(state().slides,state().transcript).length){
       signal.throwIfAborted();const current=state();request=A.restoreRequest(request,current.slides,current.transcript);
       if(!request){const available=Math.min(session?.quota.dailyRemaining||0,session?.quota.monthlyRemaining||0);if(!available){const e=new Error('사용 가능한 슬라이드 수를 모두 사용했습니다. 완료한 노트는 유지됩니다.');e.code='quota_exceeded';throw e;}request=A.createRequest(current.slides,current.title,Math.min(4,available),undefined,current.transcript);changed();}
       if(await hooks.persist()===false)throw new Error('요청을 자동 저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 시도해 주세요.');
       report('AI가 강의자료를 보완하고 있습니다',`${done} / ${total}장 완료 · 현재 ${request.slides.map(s=>s.number).join(', ')}번 슬라이드`,done/total);
       const images=[];for(const ref of request.slides){signal.throwIfAborted();images.push({slideId:ref.id,dataUrl:await resize(current.slides.find(s=>s.id===ref.id).image)});}
       signal.throwIfAborted();const response=await native('generateService',{request,images});signal.throwIfAborted();
       const completed=request;hooks.apply(completed,response.text,'service');done+=completed.slides.length;request=null;changed();if(await hooks.persist()===false)throw new Error('보완한 노트를 자동 저장하지 못했습니다. 현재 노트는 유지됩니다. 저장 공간을 확인해 주세요.');
       session=await native('serviceSession');report('AI가 강의자료를 보완하고 있습니다',`${done} / ${total}장 완료`,done/total);
      }
     }finally{signal.removeEventListener('abort',cancel);}
    });
    hooks.notify('강의노트와 보충 설명을 반영했습니다.');
   }catch(err){if(['uncertain','expired_result','request_changed','upstream_failed','invalid_response','service_limit'].includes(err.code)){request=null;changed();}if(!$('aiDialog').open)$('aiDialog').showModal();error(err);}
   finally{working=false;render();}
  }
  function begin(){if(choice){const resolve=choice;choice=null;$('aiDialog').close();resolve('service');return;}automatic();}
  $('aiStart').addEventListener('click',begin);$('aiConnect').addEventListener('click',connect);$('aiInvite').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();connect();}});
  $('aiDisconnect').addEventListener('click',async()=>{try{session=await native('disconnectService');$('aiConnection').open=true;clearError();render();}catch(err){error(err);}});
  $('aiClose').addEventListener('click',close);$('aiSkip').addEventListener('click',close);$('aiDialog').addEventListener('cancel',event=>{event.preventDefault();close();});
  $('aiTranscriptOpen').addEventListener('click',()=>{$('aiDialog').close();hooks.openTranscript();});
  return{
   open(){clearError();render();if(!$('aiDialog').open)$('aiDialog').showModal();refresh();},
   chooseWorkflow(){clearError();render();$('aiDialog').showModal();refresh();return new Promise(resolve=>{choice=resolve;});},
   async afterExtraction(value){if(value==='service')await automatic();},
   snapshot(){return{version:2,mode:'service',request};},
   restore(value){request=value?.mode==='service'?A.restoreRequest(value.request,state().slides,state().transcript):null;render();},
   reset(){request=null;clearError();render();},
   cancel(){return native('cancelService').catch(()=>{});}
  };
 }
 root.StudioAssistant={create};
})(window);
