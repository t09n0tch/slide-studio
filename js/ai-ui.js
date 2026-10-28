(function(root){
 'use strict';
 const A=root.StudioAI,$=id=>document.getElementById(id),bridge=root.studioDesktop;
 async function native(method,payload){if(!bridge)throw new Error('ChatGPT 로그인은 설치한 Windows·Mac 앱에서 사용할 수 있습니다. 무료 계정 방식은 여기서도 사용할 수 있습니다.');const result=await bridge[method](payload);if(!result.ok){const error=new Error(result.error.message);error.code=result.error.code;throw error;}return result.value;}
 async function copy(text){if(bridge)return native('copyText',text);return navigator.clipboard.writeText(text);}
 async function copyImage(blob){
  if(bridge){const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});return native('copyImage',image);}
  if(!navigator.clipboard?.write||!root.ClipboardItem)throw new Error('이 브라우저에서 이미지 복사를 지원하지 않습니다. 설치 앱을 사용하거나 필요할 때만 파일로 저장해 주세요.');
  return navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
 }
 async function openChatGPT(){if(bridge)return native('openChatGPT');root.open('https://chatgpt.com/','_blank','noopener,noreferrer');}
 async function imageOf(source){const image=new Image();image.src=source;await image.decode();return image;}
 async function resize(source){const image=await imageOf(source),scale=Math.min(1,1536/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.9);}
 async function sheet(request,slides){
  const images=await Promise.all(request.slides.map(ref=>imageOf(slides.find(s=>s.id===ref.id).image)));
  const columns=images.length>2?2:1,rows=Math.ceil(images.length/columns),cellWidth=1280,labelHeight=58,cellHeight=Math.min(2048,Math.round(Math.max(...images.map(i=>i.height/i.width))*cellWidth)+labelHeight);
  const canvas=document.createElement('canvas');canvas.width=columns*cellWidth;canvas.height=rows*cellHeight;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  images.forEach((image,i)=>{const x=(i%columns)*cellWidth,y=Math.floor(i/columns)*cellHeight,scale=Math.min((cellWidth-16)/image.width,(cellHeight-labelHeight-8)/image.height);ctx.fillStyle='#edf3eb';ctx.fillRect(x,y,cellWidth,labelHeight);ctx.fillStyle='#173a2d';ctx.font='bold 26px sans-serif';ctx.fillText(`슬라이드 ${request.slides[i].number} · ${root.StudioCore.timestamp(request.slides[i].start||0)}`,x+18,y+38);ctx.drawImage(image,x+(cellWidth-image.width*scale)/2,y+labelHeight+(cellHeight-labelHeight-image.height*scale)/2,image.width*scale,image.height*scale);});
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('첨부 이미지를 준비하지 못했습니다.');return blob;
 }
 function create(hooks){
  let mode='none',request=null,choice=null,session=null,models=[],signing=false,working=false,previewUrl=null,previewRequestId=null,preparedBlob=null,preparing=false,applying=false,copying=false,openedChatGPT=false;
  const state=()=>hooks.get(),error=err=>{$('aiError').textContent=err.message||String(err);$('aiError').hidden=false;};
  const clearError=()=>{$('aiError').hidden=true;$('aiError').textContent='';};
  const changed=()=>hooks.changed();
  function counts(){const all=A.sources(state().slides),left=A.pending(state().slides);return {all:all.length,left:left.length,done:all.length-left.length};}
  function render(){
    const count=counts(),fresh=!state().slides.length;
    $('aiSkip').textContent=fresh?'보완 없이 슬라이드만 추출':'편집 화면으로 돌아가기';
    $('aiChoices').hidden=mode!=='none';$('aiPaidPanel').hidden=mode!=='paid';$('aiFreePanel').hidden=mode!=='manual';
    $('aiTitle').textContent=mode==='none'?'강의자료를 어떻게 보완할까요?':mode==='paid'?'ChatGPT로 자동 보완':'무료 계정으로 보완';
    $('aiBatchSummary').textContent=fresh?'추출한 슬라이드로 자료를 준비합니다':`보완 ${count.done} / ${count.all}장 완료 · ${count.left}장 남음`;
    $('aiPrepare').textContent=fresh?'추출하고 텍스트 복사':request?'자료 다시 준비':count.left?(count.done?'다음 묶음 준비':'자료 준비 · ChatGPT 열기'):'모든 슬라이드 보완 완료';
    $('aiPrepare').disabled=preparing||copying||(!fresh&&!count.left);
    $('aiPasteApply').disabled=!request||applying||copying;$('aiPrepared').hidden=!request;$('aiBatchSize').disabled=preparing||applying||copying;
    $('aiCopyImage').disabled=!request||preparing||copying||!preparedBlob||previewRequestId!==request.id;$('aiSaveImage').disabled=$('aiCopyImage').disabled;$('aiCopyPrompt').disabled=preparing||copying||!request;
    $('aiPaidStart').textContent=fresh?'추출하고 자동 보완':count.left?`남은 ${count.left}장 자동 보완`:'모든 슬라이드 보완 완료';
    $('aiPaidStart').disabled=working||signing||!session?.sharing||!$('aiModel').value||!$('aiConsent').checked||(!fresh&&!count.left);
    $('aiSignIn').disabled=signing;$('aiCancelLogin').hidden=!signing;$('aiAddAccount').disabled=signing;$('aiAccount').disabled=signing;
    $('aiRefreshModels').disabled=signing||!session?.sharing;
    $('aiAccountControls').hidden=!session?.profiles?.length;
    $('aiAccountStatus').textContent=signing?'브라우저에서 연결을 완료해 주세요':session?.status==='connected'?(session.identity?.email||'ChatGPT 연결됨')+(session.sharing?' · 플랜 사용 중':' · 사용량 공유 꺼짐'):'연결되지 않음';
    $('aiPaidSummary').textContent=count.all?`보완 ${count.done} / ${count.all}장 완료. 기존에 작성한 노트에는 보완 내용을 덧붙입니다.`:'';
    if(request)$('aiPrompt').value=A.prompt(request);
  }
  async function refresh(){
    if(!bridge){render();return;}
    try{
      session=await native('session');$('aiAccount').replaceChildren();
      for(const profile of session.profiles||[]){const option=document.createElement('option');option.value=profile.id;option.textContent=profile.label+(profile.sharing?'':' · 다시 연결');$('aiAccount').append(option);}
      $('aiAccount').value=session.profileId||'';
      const previous=$('aiModel').value;$('aiModel').replaceChildren();models=[];
      if(session.sharing)models=await native('models');
      for(const model of models){const option=document.createElement('option');option.value=model.slug;option.textContent=model.displayName;$('aiModel').append(option);}
      if(!models.length){const option=document.createElement('option');option.value='';option.textContent=session.sharing?'사용 가능한 모델이 없습니다':'로그인 후 사용할 수 있는 모델을 확인합니다';$('aiModel').append(option);}
      else if(models.some(m=>m.slug===previous))$('aiModel').value=previous;
      $('aiModel').disabled=!models.length;
    }catch(err){error(err);}render();
  }
  function close(){if(choice){const resolve=choice;choice=null;resolve(null);}if(signing)native('cancel').catch(()=>{});$('aiDialog').close();}
  function select(value){mode=value;clearError();render();if(value==='paid')refresh();changed();}
  async function connect(newProfile=false){
    clearError();signing=true;render();
    try{session=await native('signIn',{newProfile,profileId:newProfile?undefined:session?.profileId});await refresh();
      if(session.sharing){let seen=false;try{seen=localStorage.getItem('studio-chatgpt-welcome-'+session.profileId)==='1';}catch(_){}$('aiPlanWelcome').hidden=seen;}
      else error(new Error('사용량 공유가 허용되지 않았습니다. 지원되는 Plus·Pro 계정으로 연결하거나 무료 계정 방식으로 계속해 주세요.'));
    }catch(err){error(err);}finally{signing=false;render();}
  }
  function begin(value){
    clearError();if(value==='paid'&&!session?.sharing)return;
    if(choice){const resolve=choice;choice=null;mode=value;changed();$('aiDialog').close();resolve(value);return;}
    if(value==='paid')automatic().catch(error);else prepare().catch(error);
  }
  async function prepare(){
    if(preparing)return;clearError();const current=state();request=A.restoreRequest(request,current.slides)||A.createRequest(current.slides,current.title,$('aiBatchSize').value);preparing=true;changed();render();
    try{
      const blob=previewRequestId===request.id&&preparedBlob?preparedBlob:await sheet(request,current.slides);showPrepared(blob,request);
      try{await copy(A.prompt(request));copiedHint('text');}
      catch(err){$('aiPrepareHint').textContent='자료는 준비되었습니다. ‘텍스트 복사’를 눌러 ChatGPT에 먼저 붙여넣은 뒤 ‘이미지 복사’로 이미지를 추가하세요.';error(err);return;}
      if(!openedChatGPT){try{await openChatGPT();openedChatGPT=true;}catch(err){error(err);}}
    }finally{preparing=false;render();}
  }
  function showPrepared(blob,pending){if(previewUrl)URL.revokeObjectURL(previewUrl);preparedBlob=blob;previewUrl=URL.createObjectURL(blob);previewRequestId=pending.id;$('aiSheetPreview').src=previewUrl;$('aiPreparedName').textContent=`${pending.slides.length}장 묶음 · 메모리에서 준비했습니다. 다운로드 폴더에 파일을 만들지 않습니다.`;}
  function copiedHint(type){
    $('aiPrepareHint').textContent=type==='image'?'이미지를 복사했습니다. ChatGPT의 텍스트를 붙여넣은 같은 메시지에 ⌘/Ctrl+V로 추가한 뒤 전송하세요.':'텍스트를 복사했습니다. ChatGPT에 먼저 ⌘/Ctrl+V로 붙여넣으세요. 그다음 앱의 ‘이미지 복사’를 눌러 같은 메시지에 이미지를 추가한 뒤 전송하세요.';
    $('aiPreparedName').textContent=type==='image'?'이미지 복사 완료 · ChatGPT의 같은 메시지에 붙여넣으세요.':'텍스트 복사 완료 · ChatGPT에 먼저 붙여넣으세요.';clearError();
  }
  async function apply(){
    clearError();if(!request||applying)return;applying=true;render();const currentRequest=request;
    try{
      let text=$('aiReply').value;
      if(!text.trim())text=bridge?await native('readText'):await navigator.clipboard.readText();
      if(currentRequest!==request)throw new Error('묶음이 변경되었습니다. 현재 묶음의 답변을 다시 붙여넣어 주세요.');
      const result=hooks.apply(currentRequest,text,'manual');request=null;$('aiReply').value='';changed();render();
      const count=counts();$('aiFreeSummary').textContent=`노트 ${result.notes}장 · 보완 슬라이드 ${result.supplements}장을 반영했습니다. ${count.left?`남은 ${count.left}장은 ‘다음 묶음 준비’로 이어가세요.`:'모든 슬라이드를 보완했습니다. 편집 화면에서 확인하고 내보내세요.'}`;
    }catch(err){error(err);}finally{applying=false;render();}
  }
  async function automatic(){
    clearError();if(!session?.sharing||!$('aiModel').value||!$('aiConsent').checked){error(new Error('계정과 모델을 선택하고 슬라이드 전송에 동의해 주세요.'));return;}
    $('aiDialog').close();working=true;
    try{
      const total=A.pending(state().slides).length;
      await hooks.work(async({signal,report})=>{
        const cancel=()=>native('cancel').catch(()=>{});signal.addEventListener('abort',cancel,{once:true});let done=0;
        try{
          while(A.pending(state().slides).length){
            signal.throwIfAborted();const current=state(),batch=A.createRequest(current.slides,current.title,4);
            report('ChatGPT가 강의자료를 보완하고 있습니다',`${done} / ${total}장 완료 · 현재 ${batch.slides.map(s=>s.number).join(', ')}번 슬라이드`,done/total);
            const images=[];for(const ref of batch.slides){signal.throwIfAborted();images.push({slideId:ref.id,dataUrl:await resize(current.slides.find(s=>s.id===ref.id).image)});}
            signal.throwIfAborted();const response=await native('generate',{request:batch,images,model:$('aiModel').value,consented:true});
            signal.throwIfAborted();hooks.apply(batch,response.text,'paid');done+=batch.slides.length;
            report('ChatGPT가 강의자료를 보완하고 있습니다',`${done} / ${total}장 완료`,done/total);
          }
        }finally{signal.removeEventListener('abort',cancel);}
      });
      request=null;changed();hooks.notify('우측 노트와 보완 슬라이드를 모두 준비했습니다.');
    }catch(err){if(!$('aiDialog').open)$('aiDialog').showModal();error(err);}
    finally{working=false;render();}
  }
  $('aiChoosePaid').addEventListener('click',()=>select('paid'));$('aiChooseFree').addEventListener('click',()=>select('manual'));
  $('aiSwitchFree').addEventListener('click',()=>select('manual'));$('aiSwitchPaid').addEventListener('click',()=>select('paid'));
  $('aiClose').addEventListener('click',close);$('aiSkip').addEventListener('click',close);$('aiDialog').addEventListener('cancel',event=>{event.preventDefault();close();});
  $('aiSignIn').addEventListener('click',()=>connect());$('aiAddAccount').addEventListener('click',()=>connect(true));$('aiCancelLogin').addEventListener('click',()=>native('cancel').catch(error));
  $('aiAccount').addEventListener('change',async()=>{try{await native('selectProfile',$('aiAccount').value);await refresh();}catch(err){error(err);}});
  $('aiDisconnect').addEventListener('click',async()=>{try{const next=await native('disconnect');await refresh();if(next.warning)error(new Error(next.warning));}catch(err){error(err);}});
  $('aiRefreshModels').addEventListener('click',refresh);$('aiConsent').addEventListener('change',render);$('aiModel').addEventListener('change',render);
  $('aiAcknowledge').addEventListener('click',()=>{$('aiPlanWelcome').hidden=true;try{localStorage.setItem('studio-chatgpt-welcome-'+session.profileId,'1');}catch(_){}});
  $('aiUsage').addEventListener('click',()=>native('openUsage').catch(error));$('aiPaidStart').addEventListener('click',()=>begin('paid'));
  $('aiPrepare').addEventListener('click',()=>begin('manual'));$('aiPasteApply').addEventListener('click',apply);
  $('aiBatchSize').addEventListener('change',()=>{request=null;$('aiReply').value='';changed();clearError();render();$('aiFreeSummary').textContent='묶음 크기를 바꿨습니다. 자료를 다시 준비해 ChatGPT에 보내세요. 완료한 노트는 유지됩니다.';});
  $('aiCopyPrompt').addEventListener('click',async()=>{if(!request||preparing||copying)return;copying=true;render();try{await copy(A.prompt(request));copiedHint('text');}catch(_){error(new Error('요청문 직접 복사를 펼쳐 복사해 주세요.'));}finally{copying=false;render();}});
  $('aiCopyImage').addEventListener('click',async()=>{if(!request||preparing||!preparedBlob||previewRequestId!==request.id||copying)return;copying=true;render();try{await copyImage(preparedBlob);copiedHint('image');}catch(err){error(err);}finally{copying=false;render();}});
  $('aiSaveImage').addEventListener('click',()=>{if(request&&preparedBlob&&previewRequestId===request.id)root.StudioExport.download(preparedBlob,`ChatGPT-슬라이드-${request.slides.map(s=>s.number).join('-')}.png`);});
  $('aiReplyFileButton').addEventListener('click',()=>$('aiReplyFile').click());$('aiReplyFile').addEventListener('change',async event=>{const file=event.target.files[0];event.target.value='';if(!file)return;try{if(file.size>A.MAX_REPLY)throw new Error('현재 묶음의 답변 파일만 선택해 주세요.');$('aiReply').value=await file.text();await apply();}catch(err){error(err);}});
  return {
    open(){clearError();if(mode==='none'&&request)mode='manual';render();$('aiDialog').showModal();if(mode==='paid')refresh();
      if(mode==='manual'&&request&&previewRequestId!==request.id){const pending=request;$('aiSheetPreview').removeAttribute('src');$('aiPreparedName').textContent='이전에 준비한 묶음입니다. 이미 ChatGPT에 보냈다면 답변만 반영하세요.';sheet(pending,state().slides).then(blob=>{if(request!==pending)return;showPrepared(blob,pending);render();}).catch(error);}
    },
    chooseWorkflow(){mode='none';request=null;clearError();render();$('aiDialog').showModal();return new Promise(resolve=>{choice=resolve;});},
    async afterExtraction(value){if(!value)return;mode=value;render();if(value==='paid')await automatic();else{if(!$('aiDialog').open)$('aiDialog').showModal();await prepare().catch(error);}},
    snapshot(){return {mode,request};},
    restore(value){mode=['manual','paid'].includes(value?.mode)?value.mode:'none';request=A.restoreRequest(value?.request,state().slides);render();},
    reset(){mode='none';request=null;openedChatGPT=false;clearError();if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;previewRequestId=null;preparedBlob=null;render();},
    cancel(){return native('cancel').catch(()=>{});}
  };
 }
 root.StudioAssistant={create};
})(window);
