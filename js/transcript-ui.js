(function(root){
 'use strict';
 const T=root.StudioTranscript,C=root.StudioCore,$=id=>document.getElementById(id),bridge=root.studioDesktop;
 async function native(method,payload,options){
  if(!bridge)throw new Error('MP3 준비는 Windows·Mac 설치 앱에서 사용할 수 있습니다. 클로바노트 스크립트는 여기서도 가져올 수 있습니다.');
  const result=await bridge[method](payload,options);if(!result.ok)throw new Error(result.error.message);return result.value;
 }
 function create(hooks){
  let files=[],selectedPart='',preparing=false,applying=false,onClose=null;
  const state=()=>hooks.get();
  function error(err){$('speechError').textContent=err.message||String(err);$('speechError').hidden=false;}
  function clearError(){$('speechError').textContent='';$('speechError').hidden=true;}
  function pick(id){selectedPart=id;const part=files.find(f=>f.id===id);$('speechPart').value=id;$('speechOffset').value=C.timestamp(part?.start||0);}
  function render(){
   const current=state(),cues=current.transcript?.cues||[],matched=current.slides.filter(s=>T.forSlide(current.transcript,s).length).length;
   $('speechLecture').textContent=current.title;
   $('speechPrepare').disabled=preparing||!current.file||!bridge;$('speechOpenClova').disabled=preparing||!bridge;
   $('speechPaste').disabled=preparing||applying||!current.video;$('speechFileButton').disabled=$('speechPaste').disabled;
   $('speechClear').disabled=!cues.length||applying;$('speechUseAI').disabled=!cues.length||preparing||applying;
   $('speechSummary').textContent=cues.length?`${cues.length}개 음성 문단 연결됨${current.slides.length?` · 원본 슬라이드 ${matched}장과 시간이 겹칩니다.`:' · 슬라이드를 추출하면 시간에 맞춰 자동 연결합니다.'}`:'스크립트를 가져오면 슬라이드가 나온 시간 구간에 맞춰 연결합니다. 기존 노트는 유지됩니다.';
   $('speechExisting').hidden=!cues.length;$('speechOriginal').textContent=cues.map(c=>`${c.speaker||'화자'} ${C.timestamp(c.start)}\n${c.text}`).join('\n\n');
   $('speechFiles').replaceChildren();$('speechPart').replaceChildren();const whole=document.createElement('option');whole.value='';whole.textContent='전체 원본 영상';$('speechPart').append(whole);
   for(const file of files){
    const option=document.createElement('option');option.value=file.id;option.textContent=`${file.name} · ${C.timestamp(file.start)}부터`;$('speechPart').append(option);
    const row=document.createElement('div');row.className='speech-file';const name=document.createElement('strong');name.textContent=file.name;const detail=document.createElement('span');detail.className='micro';detail.textContent=`${C.timestamp(file.start)}–${C.timestamp(file.end)} · ${(file.bytes/1024/1024).toFixed(1)} MB`;
    const actions=document.createElement('div');actions.className='speech-file-actions';
    const copy=document.createElement('button');copy.textContent='MP3 파일 복사';copy.className='speech-copy';copy.addEventListener('click',async()=>{try{clearError();await native('copyAudio',file.id);pick(file.id);$('speechHint').textContent='MP3 파일을 복사했습니다. 클로바노트에서 파일을 첨부하세요. 아래 ‘끌어서 첨부’도 사용할 수 있습니다.';}catch(err){error(err);}});
    const drag=document.createElement('button');drag.textContent='끌어서 첨부';drag.draggable=true;drag.className='speech-drag';drag.title='이 버튼을 잡고 클로바노트 새 노트의 파일 첨부 영역에 놓으세요.';drag.addEventListener('dragstart',event=>{event.preventDefault();pick(file.id);native('dragAudio',file.id).catch(error);});
    const reveal=document.createElement('button');reveal.textContent='파일 위치';reveal.className='quiet';reveal.addEventListener('click',()=>native('revealAudio',file.id).catch(error));
    actions.append(copy,drag,reveal);row.append(name,detail,actions);$('speechFiles').append(row);
   }
   if(!files.some(f=>f.id===selectedPart))selectedPart='';$('speechPart').value=selectedPart;
   $('speechOffsetRow').hidden=!files.length&&!(Number(current.video?.duration)>10800);
  }
  function close(){if(preparing)return;$('speechDialog').close();const callback=onClose;onClose=null;callback?.();}
  async function prepare(){
   if(preparing)return;clearError();const current=state();if(!current.file)return;
   preparing=true;render();$('speechDialog').close();const jobId=crypto.randomUUID();let unsubscribe;
   try{
    const result=await hooks.work(async({signal,report})=>{
     const cancel=()=>native('cancelAudio').catch(()=>{});signal.addEventListener('abort',cancel,{once:true});
     unsubscribe=bridge.onAudioProgress(progress=>{if(progress.jobId===jobId)report('클로바노트에 보낼 MP3를 준비하고 있습니다',`${C.timestamp(progress.seconds)} / ${C.timestamp(progress.duration)} · 음성 인식은 클로바노트에서 진행합니다.`,Math.min(.99,progress.seconds/progress.duration));});
     try{signal.throwIfAborted();const prepared=await native('prepareAudio',current.file,{duration:current.video.duration,jobId});if(signal.aborted){await native('resetAudio');signal.throwIfAborted();}return prepared;}finally{signal.removeEventListener('abort',cancel);}
    });
    files=result.files;pick(files[0]?.id||'');render();
    if(files[0]){try{await native('copyAudio',files[0].id);$('speechHint').textContent='첫 MP3 파일을 복사했습니다. 클로바노트를 열고 첨부하세요. 파일을 끌어서 첨부할 수도 있습니다.';}catch(err){error(err);}}
   }catch(err){error(err);}finally{unsubscribe?.();preparing=false;render();if(!$('speechDialog').open)$('speechDialog').showModal();}
  }
  async function apply(text){
   if(applying)return;applying=true;clearError();render();
   try{
    if(!text?.trim())text=bridge?await native('readTranscript'):await navigator.clipboard.readText();
    $('speechText').value=text||'';
    const current=state(),part=files.find(f=>f.id===selectedPart),offset=part?part.start:T.seconds($('speechOffset').value.trim()),end=part?Math.min(current.video.duration,part.end):current.video.duration;
    const parsed=T.parse(text,{duration:end,offset});const combined=T.merge(current.transcript,parsed,{start:offset,end});
    const checked=T.restore(combined,current.video.duration);hooks.apply(checked);
    $('speechText').value='';$('speechHint').textContent=`${parsed.cues.length}개 음성 문단을 연결했습니다. 이제 ‘음성 포함해 AI 보완’에서 교수님 설명을 노트로 정리할 수 있습니다.`;
    if(part){try{files=await native('discardAudio',part.id);selectedPart='';$('speechOffset').value='00:00';}catch(_){/* An imported transcript remains valid if temporary cleanup needs retrying. */}}
   }catch(err){error(err);}finally{applying=false;render();}
  }
  $('speechClose').addEventListener('click',close);$('speechDialog').addEventListener('cancel',event=>{event.preventDefault();close();});
  $('speechPrepare').addEventListener('click',prepare);$('speechOpenClova').addEventListener('click',()=>native('openClova').catch(error));
  $('speechPaste').addEventListener('click',()=>apply($('speechManual').open?$('speechText').value:undefined));$('speechFileButton').addEventListener('click',()=>$('speechFile').click());
  $('speechFile').addEventListener('change',async event=>{const file=event.target.files[0];event.target.value='';if(!file)return;try{if(file.size>T.MAX_TEXT*4)throw new Error('스크립트 파일이 너무 큽니다. 현재 강의의 TXT·SRT·VTT 파일을 선택해 주세요.');await apply(await file.text());}catch(err){error(err);}});
  $('speechPart').addEventListener('change',event=>pick(event.target.value));$('speechOffset').addEventListener('input',()=>{selectedPart='';$('speechPart').value='';});
  $('speechClear').addEventListener('click',()=>{hooks.apply(null);clearError();render();$('speechHint').textContent='음성 기록 연결을 해제했습니다. 작성한 노트는 유지되며 실행 취소할 수 있습니다.';});
  $('speechUseAI').addEventListener('click',()=>{$('speechDialog').close();onClose=null;hooks.openAI();});
  return {
   open(callback=null){onClose=callback;clearError();render();$('speechDialog').showModal();},
   reset(){files=[];selectedPart='';onClose=null;$('speechText').value='';$('speechOffset').value='00:00';$('speechHint').textContent='MP3는 앱의 임시 공간에서 준비합니다. 다운로드 폴더에 저장하지 않습니다.';if(bridge)native('resetAudio').catch(()=>{});render();},
   refresh:render
  };
 }
 root.StudioTranscriptUI={create};
})(window);
