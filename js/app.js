(function(){
 'use strict';
 const C=window.StudioCore,E=window.StudioExport,N=window.StudioNotes,D=C.DETECTION_DEFAULTS,$=id=>document.getElementById(id);
 let slides=[],selectedId=null,title='새 강의자료',videoInfo=null,crop=null,videoUrl=null,busy=false,dirty=false;
 let history=[],future=[],pendingHistory=null,saveTimer=null,toastTimer=null,controller=null,dragId=null,editRevision=0,recoverable=null;
 let notesEditor=null,editorSlideId=null,rawMode=false,progressValue=0,progressStarted=0,progressTimer=null;
 let assistant=null,speechUI=null,transcript=null,originalFile=null;
 let dragSlot=null,dragY=null,dragScrollTimer=null,selectionSeek=null,lastVideoSelection=null,cropGesture=null,previewRevision=0,previewTimer=null;
 let cropTargets=[],cropGuides=[];
 const thumbnailCache=new Map(),thumbnailTimers=new Map();
 const video=$('video'),analysisCanvas=document.createElement('canvas'),frameCanvas=document.createElement('canvas');
 analysisCanvas.width=96;analysisCanvas.height=72;
 const analysisContext=analysisCanvas.getContext('2d',{willReadFrequently:true}),frameContext=frameCanvas.getContext('2d');
 let analysisStages=[],analysisCropKey='';
 const selected=()=>slides.find(s=>s.id===selectedId)||null;
 const snapshot=()=>({...C.workspaceState(slides,title,videoInfo,crop),assistant:assistant?.snapshot(),transcript});
 function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?8000:4500);}
 function fail(err){console.error(err);toast(err.message||String(err),true);status(err.message||String(err));}
 function status(message){$('status').textContent=message;}
 function yieldToBrowser(){
  // Continue in a task, independently of whether this tab is being painted.
  if(typeof globalThis.scheduler?.yield==='function')return globalThis.scheduler.yield();
  return new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);});
 }
 function showWorkspace(){$('welcome').hidden=true;$('workspace').hidden=false;document.body.classList.remove('welcome-screen');}
 function showWelcome(){$('workspace').hidden=true;$('welcome').hidden=false;document.body.classList.add('welcome-screen');}
 function historyState(){return {slides:slides.map(s=>({...s,segments:s.segments.map(v=>({...v})),ai:s.ai?{...s.ai}:null})),selectedId,title,videoInfo:videoInfo?{...videoInfo}:null,crop:crop?{...crop}:null,assistant:structuredClone(assistant?.snapshot()),transcript:structuredClone(transcript)};}
 function remember(action,restoreAssistant=false){pendingHistory={before:historyState(),after:null,action,restoreAssistant};history.push(pendingHistory);if(history.length>50)history.shift();future=[];}
 function touch({historyRestore=false}={}){
  if(pendingHistory){pendingHistory.after=historyState();pendingHistory=null;}
  if(!historyRestore&&future.length){future=[];updateButtons();}
  dirty=true;editRevision++;$('saveStatus').textContent='저장 중';clearTimeout(saveTimer);saveTimer=setTimeout(autoSave,700);
 }
 function travelHistory(redo=false){
  if(busy)return;const stack=redo?future:history,opposite=redo?history:future,entry=stack.pop();if(!entry?.after)return;
  const current=historyState(),from=redo?entry.before:entry.after,to=redo?entry.after:entry.before;
  slides=C.restoreSlideHistory(slides,from.slides,to.slides);selectedId=slides.some(s=>s.id===to.selectedId)?to.selectedId:slides[0]?.id||null;
  if(from.title!==to.title)title=to.title;
  if(JSON.stringify(from.videoInfo)!==JSON.stringify(to.videoInfo))videoInfo=to.videoInfo?{...to.videoInfo}:null;
  if(JSON.stringify(from.crop)!==JSON.stringify(to.crop))crop=to.crop?{...to.crop}:null;
  if(JSON.stringify(from.transcript)!==JSON.stringify(to.transcript))transcript=structuredClone(to.transcript);
  assistant?.restore(entry.restoreAssistant?to.assistant:assistant.snapshot());
  const restored=historyState();opposite.push({...entry,before:redo?current:restored,after:redo?restored:current});
  touch({historyRestore:true});render();toast(`${entry.action} ${redo?'다시 실행':'실행 취소'}`);
 }
 function element(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
 function render(){
  const listScroll=$('slideList').scrollTop;
  $('lectureTitle').value=title;
  $('slideCount').textContent=`${slides.filter(s=>s.included).length} / ${slides.length}`;
  $('slideList').replaceChildren();
  slides.forEach((s,i)=>{
   const row=element('div','slide-item'+(s.id===selectedId?' active':'')+(!s.included?' excluded':''));row.dataset.id=s.id;row.draggable=true;row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label',`${i+1} ${s.title||C.KINDS[s.kind]}`);row.setAttribute('aria-pressed',String(s.id===selectedId));
   const check=element('input');check.type='checkbox';check.checked=s.included;check.setAttribute('aria-label',`${i+1}페이지 내보내기에 포함`);
   check.addEventListener('click',e=>e.stopPropagation());check.addEventListener('change',()=>{remember('내보내기 포함 변경');s.included=check.checked;touch();render();});
   const item=element('div');
   const image=element('img','thumbnail'+(s.image?'':' supplement-thumbnail'));image.src=s.image||'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"%3E%3Crect width="1920" height="1080" fill="%23f7fafa"/%3E%3C/svg%3E';image.alt=`${i+1}페이지 ${s.image?'원본':'보충 설명'} 미리보기`;image.loading='lazy';image.draggable=false;item.append(image);
   item.append(element('div','item-title',s.title||`${C.KINDS[s.kind]} ${i+1}`));
   const start=C.slideStart(s),meta=element('div','item-meta');meta.append(element('span','',`${String(i+1).padStart(2,'0')} · ${C.KINDS[s.kind]}`),element('span','',start===null?'직접 작성':C.timestamp(start)));item.append(meta);row.append(check,item);
   if(!s.included&&s.autoExcludedReason)item.append(element('p','auto-excluded',s.autoExcludedReason));
   if(s.ai)item.append(element('span','ai-progress-badge','학습 보완'));
   row.addEventListener('click',()=>choose(s.id));row.addEventListener('keydown',e=>{if(e.target===row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();choose(s.id);}});
   row.addEventListener('dragstart',e=>{if(busy){e.preventDefault();return;}dragId=s.id;row.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',s.id);startDragScroll();});
   row.addEventListener('dragend',clearDrag);
   $('slideList').append(row);
   if(!s.image)refreshThumbnail(s,i+1);
  });
  if(!slides.length){const empty=element('div','empty-library');empty.append(element('strong','','슬라이드를 자동으로 찾습니다'),element('p','','추출이 끝나면 여기에 목록이 채워집니다. 취소했다면 위의 자동 추출로 다시 시작할 수 있습니다.'));$('slideList').append(empty);}
  const indicator=element('div','drop-indicator');indicator.id='dropIndicator';indicator.hidden=true;indicator.setAttribute('aria-hidden','true');$('slideList').append(indicator);$('slideList').scrollTop=listScroll;
  renderEditor();updateButtons();syncSelectedVideo();
 }
 function refreshThumbnail(slide,number=slides.indexOf(slide)+1){
  const image=$('slideList').querySelector(`[data-id="${CSS.escape(slide.id)}"] .supplement-thumbnail`);if(!image)return;
  const key=JSON.stringify([slide.notes,slide.notesFormat,slide.notesFontSize,slide.title,slide.kind,number]);if(image.dataset.renderKey===key)return;image.dataset.renderKey=key;image.dataset.renderStatus='loading';
  let pending=thumbnailCache.get(key);if(!pending){pending=E.thumbnail({...slide},number);thumbnailCache.set(key,pending);if(thumbnailCache.size>80)thumbnailCache.delete(thumbnailCache.keys().next().value);}
  pending.then(src=>{if(image.isConnected&&image.dataset.renderKey===key){image.src=src;image.dataset.renderStatus='ready';}}).catch(err=>{thumbnailCache.delete(key);if(image.isConnected&&image.dataset.renderKey===key){image.dataset.renderStatus='error';image.alt='미리보기를 만들지 못했습니다. 선택하면 내용을 확인할 수 있습니다.';}console.error(err);});
 }
 function scheduleThumbnail(slide){
  if(slide.image)return;clearTimeout(thumbnailTimers.get(slide.id));thumbnailTimers.set(slide.id,setTimeout(()=>{thumbnailTimers.delete(slide.id);const current=slides.find(s=>s.id===slide.id);if(current)refreshThumbnail(current);},180));
 }
 function choose(id){
  if(busy||!slides.some(s=>s.id===id))return;const list=$('slideList'),scroll=list.scrollTop;selectedId=id;
  for(const row of list.querySelectorAll('.slide-item')){row.classList.toggle('active',row.dataset.id===id);row.setAttribute('aria-pressed',String(row.dataset.id===id));}
  renderEditor();updateButtons();list.scrollTop=scroll;syncSelectedVideo(true);
 }
 function clearDrag(){dragId=null;dragSlot=null;dragY=null;clearInterval(dragScrollTimer);dragScrollTimer=null;$('dropIndicator').hidden=true;for(const row of $('slideList').querySelectorAll('.dragging'))row.classList.remove('dragging');$('dragStatus').textContent='';}
 function showDrop(y){
  const list=$('slideList'),rows=Array.from(list.querySelectorAll('.slide-item')),rects=rows.map(row=>row.getBoundingClientRect()),from=slides.findIndex(s=>s.id===dragId);
  const slot=C.insertionIndex(rects,y),to=slot-(slot>from?1:0);dragY=y;
  if(from<0||to===from){dragSlot=null;$('dropIndicator').hidden=true;return false;}
  dragSlot=slot;const boundary=slot===0?rects[0].top-4:slot===rows.length?rects.at(-1).bottom+4:(rects[slot-1].bottom+rects[slot].top)/2;
  $('dropIndicator').style.top=`${boundary-list.getBoundingClientRect().top+list.scrollTop-2}px`;$('dropIndicator').hidden=false;$('dragStatus').textContent=`${to+1}번째 위치에 놓기`;return true;
 }
 function startDragScroll(){clearInterval(dragScrollTimer);dragScrollTimer=setInterval(()=>{if(dragY===null||!dragId)return;const list=$('slideList'),rect=list.getBoundingClientRect(),edge=36;let delta=0;if(dragY<rect.top+edge)delta=-Math.ceil((rect.top+edge-dragY)/4);else if(dragY>rect.bottom-edge)delta=Math.ceil((dragY-(rect.bottom-edge))/4);if(delta){list.scrollTop+=delta;showDrop(dragY);}},30);}
 $('slideList').addEventListener('dragover',e=>{if(!dragId||busy)return;e.preventDefault();e.dataTransfer.dropEffect=showDrop(e.clientY)?'move':'none';});
 $('slideList').addEventListener('dragleave',e=>{const rect=$('slideList').getBoundingClientRect();if(e.clientX<rect.left||e.clientX>=rect.right||e.clientY<rect.top||e.clientY>=rect.bottom){dragY=null;dragSlot=null;$('dropIndicator').hidden=true;}});
 $('slideList').addEventListener('drop',e=>{if(!dragId||busy)return;e.preventDefault();showDrop(e.clientY);const from=slides.findIndex(s=>s.id===dragId),slot=dragSlot;if(from<0||slot===null){clearDrag();return;}const to=slot-(slot>from?1:0);clearDrag();remember('페이지 순서 변경');const moved=slides.splice(from,1)[0];slides.splice(to,0,moved);selectedId=moved.id;touch();render();});
 function syncSelectedVideo(force=false){
  if(busy||!videoUrl)return;const s=selected(),start=s?C.slideStart(s):null,key=s?`${s.id}:${start}`:null;if(!force&&key===lastVideoSelection)return;lastVideoSelection=key;selectionSeek?.abort();selectionSeek=null;
  if(start===null)return;selectionSeek=new AbortController();const signal=selectionSeek.signal;seek(start,signal).catch(err=>{if(err.name!=='AbortError')fail(err);});
 }
 function syncToolbar(editor=notesEditor){
  if(!editor)return;
  let value='paragraph';for(const level of [1,2,3])if(editor.isActive('heading',{level}))value=String(level);$('noteFormat').value=value;
  for(const button of $('noteToolbar').querySelectorAll('[data-command]')){
   const command=button.dataset.command,active=editor.isActive(command);button.classList.toggle('active',active);if(button.hasAttribute('aria-pressed'))button.setAttribute('aria-pressed',String(active));
   button.disabled=rawMode||(command==='undo'&&!editor.can().undo())||(command==='redo'&&!editor.can().redo());
  }
  $('noteFormat').disabled=rawMode;
 }
 function syncNoteSelection(){
  if(!notesEditor)return;
  const selection=window.getSelection(),dom=notesEditor.view.dom;
  if(!selection?.anchorNode||!selection.focusNode||!dom.contains(selection.anchorNode)||!dom.contains(selection.focusNode))return;
  const anchor=notesEditor.view.posAtDOM(selection.anchorNode,selection.anchorOffset),head=notesEditor.view.posAtDOM(selection.focusNode,selection.focusOffset);
  notesEditor.commands.setTextSelection({from:Math.min(anchor,head),to:Math.max(anchor,head)});
 }
 function noteChanged(markdown,doc){
  const s=selected();if(!s||s.id!==editorSlideId)return;
  s.notes=markdown;s.notesFormat='markdown';s.title=C.noteTitle(doc)||(s.kind==='supplement'?'보충 설명':`슬라이드 ${slides.indexOf(s)+1}`);
  if(!rawMode)$('markdownSource').value=markdown;
  const row=$('slideList').querySelector('.active .item-title');if(row)row.textContent=s.title;
  touch();renderPreview();syncToolbar();
 }
 function renderEditor(){
  const s=selected(),i=slides.indexOf(s);$('notePanel').hidden=!s;$('noSelection').hidden=!!s;$('noteOptions').hidden=!s;
  $('pagePosition').textContent=s?`${i+1} / ${slides.length} 페이지`:'슬라이드를 준비하고 있습니다';$('pageKind').textContent=s?C.KINDS[s.kind]:'';
  if(!s){notesEditor?.destroy();notesEditor=null;editorSlideId=null;renderPreview();return;}
  if(s.notesFormat!=='markdown'){s.notes=N.legacyMarkdown(s);s.notesFormat='markdown';}
  if(editorSlideId!==s.id){notesEditor?.destroy();editorSlideId=s.id;notesEditor=N.create({element:$('noteEditor'),markdown:s.notes,onChange:noteChanged,onSelection:syncToolbar});}
  else if(!rawMode&&notesEditor.getMarkdown()!==s.notes)notesEditor.commands.setContent(N.parse(s.notes),{emitUpdate:false});
  if(!rawMode||document.activeElement!==$('markdownSource'))$('markdownSource').value=s.notes;
  $('kind').value=s.kind;$('speakerNotes').value=s.speakerNotes;
  $('showNotes').checked=!s.image||s.showNotes!==false;
  $('autoNoteFont').checked=s.notesFontSize==null;
  if(document.activeElement!==$('noteFontSize'))$('noteFontSize').value=s.notesFontSize??(s.image?22.5:31.5);
  $('notesVisibilityHelp').textContent=!s.image?'보충 설명 페이지는 노트가 본문이므로 항상 전체 화면에 표시됩니다.':s.showNotes===false?'원본을 크게 표시하고 하단에 시작 시각·페이지 번호를 남깁니다. 작성한 노트는 보관됩니다.':'끄면 우측 노트 칸이 사라지고 원본 화면이 커집니다. 시작 시각·페이지 번호는 유지됩니다.';
  $('noteEditor').hidden=rawMode;$('markdownSource').hidden=!rawMode;
  $('richMode').classList.toggle('active',!rawMode);$('richMode').setAttribute('aria-pressed',String(!rawMode));$('markdownMode').classList.toggle('active',rawMode);$('markdownMode').setAttribute('aria-pressed',String(rawMode));
  syncToolbar();renderPreview();
 }
 function renderPreview(){
  const revision=++previewRevision;clearTimeout(previewTimer);
  const s=selected(),i=slides.indexOf(s),isSupplement=s&&s.kind==='supplement'&&!s.image,sourceOnly=!!s?.image&&s.showNotes===false;
  if(s&&!s.image)scheduleThumbnail(s);
  $('slidePreview').classList.toggle('supplement',!!isSupplement);
  $('slidePreview').classList.toggle('source-only',sourceOnly);
  $('previewImage').style.display=s&&s.image?'block':'none';$('previewEmpty').style.display=s&&s.image?'none':'block';
  if(s&&s.image)$('previewImage').src=s.image;else $('previewImage').removeAttribute('src');
  $('previewLabel').textContent=s?(s.kind==='question'?'직접 풀기':s.kind==='solution'?'풀이와 해설':s.kind==='supplement'?'보충 설명':s.ai?'학습 보완 노트':'강의 노트'):'강의 노트';
  // Only schema-generated HTML is rendered; raw Markdown HTML is escaped.
  $('previewBody').classList.remove('planned');$('previewBody').innerHTML=s?N.html(s.notes):'';
  for(const input of $('previewBody').querySelectorAll('input')){input.disabled=true;input.checked=input.closest('li')?.dataset.checked==='true';}
  for(const link of $('previewBody').querySelectorAll('a')){link.target='_blank';link.rel='noopener noreferrer';}
  const start=s?C.slideStart(s):null;for(const id of ['previewTime','sourceTime']){$(id).textContent=s?(start===null?'보충 설명':C.timestamp(start)):'';$(id).disabled=!videoUrl||start===null;}$('sourceFooter').hidden=!sourceOnly;
  for(const id of ['previewPage','sourcePage'])$(id).textContent=s?String(i+1).padStart(2,'0'):'';
  $('previewCaption').textContent=sourceOnly?'원본 화면과 시작 시각·페이지 번호를 내보냅니다. 노트는 숨긴 상태로 보관됩니다.':s&&s.notes.length>(s.image?210:500)?'긴 노트는 내보낼 때 다음 페이지로 이어집니다.':'서식과 노트가 PPTX·PDF에 함께 반영됩니다.';
  if(s)previewTimer=setTimeout(async()=>{try{
   const plan=await E.previewPlan({...s});if(revision!==previewRevision)return;
   if(document.activeElement!==$('noteFontSize'))$('noteFontSize').value=plan.fontSize;
   $('noteFontHint').textContent=`${s.notesFontSize==null?'자동 맞춤':'수동'} ${plan.fontSize}pt · ${plan.total===1?'전체 노트를 한 페이지에 표시합니다.':`${plan.total}페이지로 이어서 내보냅니다.`}`;
   $('noteFontSize').title=$('noteFontHint').textContent;paintPreviewNotes(plan,s);$('slidePreview').dataset.noteFont=plan.fontSize;$('slidePreview').dataset.notePages=plan.total;
   if(!sourceOnly)$('previewCaption').textContent=plan.total===1?'노트 전체와 글자 크기가 미리보기·PPTX·PDF에 함께 반영됩니다.':`${plan.fontSize}pt · 노트 ${plan.total}페이지 분량입니다. 첫 페이지를 미리 봅니다.`;
  }catch(err){if(revision===previewRevision){$('noteFontHint').textContent=err.message;$('noteFontSize').title=err.message;$('previewCaption').textContent=err.message;}}},60);
 }
 function paintPreviewNotes(plan,s){
  const body=$('previewBody'),offset=s.image?1440:0;body.classList.add('planned');body.replaceChildren();
  for(const item of plan.chunks[0]){
   const line=element('div',item.type==='text'?'preview-line':'preview-decoration');line.style.left=`${(item.x-offset)/19.2}cqw`;line.style.top=`${item.y/19.2}cqw`;
   if(item.type==='text'){
    line.style.fontSize=`${item.size/19.2}cqw`;line.style.width=`${item.width/19.2+.1}cqw`;
    for(const run of item.runs){const span=element(run.href?'a':'span','',run.text);if(run.bold)span.style.fontWeight='700';if(run.italic)span.style.fontStyle='italic';if(run.strike)span.style.textDecoration='line-through';if(run.code)span.style.background='#EEF3EA';if(run.href){span.href=run.href;span.target='_blank';span.rel='noopener noreferrer';}line.append(span);}
   }else{
    line.style.width=`${(item.width||0)/19.2}cqw`;line.style.height=`${(item.height||0)/19.2}cqw`;
    if(item.type==='background')line.style.background='#'+item.color;else if(item.type==='rule')line.style.borderTop=`1px solid #${item.color}`;else line.style.borderLeft=`2px solid #${item.color}`;
   }
   body.append(line);
  }
 }
 function setNoteFont(value){const s=selected();if(!s||busy)return;if(value!==null&&(!Number.isFinite(value)||value<8||value>36)){toast('글자 크기는 8~36pt로 정해 주세요.',true);renderEditor();return;}if(s.notesFontSize===value)return;remember('노트 글자 크기 변경');s.notesFontSize=value;touch();renderEditor();updateButtons();}
 function updateButtons(){
  const s=selected(),v=!!videoUrl,available=slides.some(s=>s.included);
  $('exportPptx').disabled=!available||busy;$('exportPdf').disabled=!available||busy;
  $('assistantOpen').disabled=!slides.some(s=>s.included&&s.image)||busy;
  $('transcriptOpen').disabled=!originalFile||busy;
  $('extract').disabled=!v||busy;$('extractSettings').disabled=!v||busy;$('extract').textContent=slides.length?'슬라이드 다시 추출':'자동 추출';$('cropButton').disabled=!v||busy;$('captureNew').disabled=!v||busy;$('replaceFrame').disabled=!v||!s||s.kind==='supplement'||busy;
  $('newLecture').disabled=busy;$('addSupplement').disabled=busy;$('duplicateSlide').disabled=!s||busy;$('moveUp').disabled=!s||slides.indexOf(s)===0||busy;$('moveDown').disabled=!s||slides.indexOf(s)===slides.length-1||busy;$('deleteSlide').disabled=!s||busy;$('undo').disabled=!history.length||busy;$('redo').disabled=!future.length||busy;$('showNotes').disabled=!s?.image||busy;
  $('undo').title=history.length?`${history.at(-1).action} 실행 취소 · ⌘/Ctrl+Z`:'페이지 작업 실행 취소 · ⌘/Ctrl+Z';$('redo').title=future.length?`${future.at(-1).action} 다시 실행 · ⌘/Ctrl+Shift+Z`:'페이지 작업 다시 실행 · ⌘/Ctrl+Shift+Z';
  $('historyHint').textContent=history.length?`되돌릴 작업: ${history.at(-1).action}`:'삭제·복사·순서 변경을 되돌릴 수 있습니다.';
  for(const id of ['autoNoteFont','noteFontSize','noteFontSmaller','noteFontLarger','toggleNoteOptions'])$(id).disabled=!s||busy;
  $('cropDescription').textContent=crop?`선택 영역 ${crop.width} × ${crop.height} · 시작 (${crop.x}, ${crop.y})`:'슬라이드 영역을 준비하고 있습니다.';
 }
 async function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open('lecture-slide-studio',1);r.onupgradeneeded=()=>r.result.createObjectStore('workspace');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
 async function dbOperation(mode,callback){
  const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('workspace',mode),store=tx.objectStore('workspace');let result;const request=callback(store);if(request)request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('자동 저장을 완료하지 못했습니다.'));});}finally{db.close();}
 }
 async function autoSave(){
  const revision=editRevision;
  try{await dbOperation('readwrite',store=>store.put(snapshot(),'latest'));if(revision===editRevision){dirty=false;$('saveStatus').textContent='자동 저장됨';}return true;}
  catch(err){$('saveStatus').textContent='자동 저장 실패';status('브라우저에 노트를 저장하지 못했습니다. 완성본을 PPTX 또는 PDF로 내보내 주세요.');return false;}
 }
 async function recovery(){
  try{
   const raw=await dbOperation('readonly',s=>s.get('latest'));if(!raw?.slides?.length&&!raw?.transcript)return;
   const data=C.validateWorkspace(raw);for(const s of data.slides){s.notes=N.legacyMarkdown(s);s.notesFormat='markdown';}
   data.assistant=raw.assistant;try{data.transcript=window.StudioTranscript.restore(raw.transcript,data.video?.duration);}catch(_){data.transcript=null;}recoverable=data;
  }catch(err){/* Browser storage can be unavailable in private/file contexts. */}
 }
 async function loadVideo(file){
  if(!file||busy)return;
  selectionSeek?.abort();selectionSeek=null;lastVideoSelection=null;
  const next=URL.createObjectURL(file),old=videoUrl;busy=true;showWorkspace();render();progress('강의 영상을 준비하고 있습니다','선택한 영상을 편집 화면에 연결합니다.',null,false);
  try{
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(new Error('영상을 읽는 시간이 오래 걸립니다. MP4(H.264) 파일인지 확인해 주세요.'));},20000);
    const cleanup=()=>{clearTimeout(timer);video.removeEventListener('loadeddata',ok);video.removeEventListener('error',bad);};
    const ok=()=>{cleanup();resolve();},bad=()=>{cleanup();reject(new Error('브라우저가 이 영상 형식을 재생하지 못합니다. MP4(H.264) 또는 WebM을 사용해 주세요.'));};
    video.addEventListener('loadeddata',ok);video.addEventListener('error',bad);video.src=next;video.load();
   });
   if(!Number.isFinite(video.duration)||video.duration<=0)throw new Error('유한한 길이의 영상 파일이 필요합니다.');
   await recoveryReady;
   const restored=recoverable?.video?.name===file.name&&recoverable.video.size===file.size&&Math.abs(recoverable.video.duration-video.duration)<1;
   if(restored){slides=recoverable.slides;title=recoverable.title;crop=recoverable.crop;transcript=recoverable.transcript;selectedId=slides[0]?.id||null;history=[];future=[];pendingHistory=null;assistant?.restore(recoverable.assistant);recoverable=null;}
   videoUrl=next;originalFile=file;if(old)URL.revokeObjectURL(old);videoInfo={name:file.name,size:file.size,duration:video.duration,width:video.videoWidth,height:video.videoHeight};
   if(!crop)crop={x:0,y:0,width:video.videoWidth,height:video.videoHeight};
   if(!slides.length)title=file.name.replace(/\.[^.]+$/,'');
   video.style.display='block';$('videoPlaceholder').hidden=true;$('videoControls').hidden=false;$('toggleVideo').textContent='접기';
   busy=false;$('progressDialog').close();render();touch();
   if(!slides.length){status('영상이 편집 화면에 연결되었습니다. 강의자료 보완 방식을 선택해 주세요.');const workflow=await assistant.chooseWorkflow();const complete=await extract({automatic:true});if(complete)await assistant.afterExtraction(workflow);}
   else status('선택한 영상과 자동 저장한 노트를 연결했습니다. 시작 시각을 누르면 해당 장면으로 이동합니다.');
  }catch(err){URL.revokeObjectURL(next);if(old){video.src=old;video.load();}else{video.removeAttribute('src');showWelcome();}busy=false;$('progressDialog').close();updateButtons();fail(err);}
 }
 function updateProgressEta(){
  if(!$('progressDialog').open)return;
  const eta=$('progressEta');eta.hidden=!$('progressBar').hasAttribute('value');if(eta.hidden)return;
  if(progressValue>=1){eta.textContent='0초 남음';clearInterval(progressTimer);progressTimer=null;return;}
  const elapsed=(performance.now()-progressStarted)/1000;
  if(elapsed<2||progressValue<=0){eta.textContent='남은 시간 계산 중';return;}
  let seconds=Math.max(1,Math.ceil(elapsed*(1-progressValue)/progressValue));
  if(seconds>=60)seconds=Math.ceil(seconds/5)*5;
  const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60,parts=[];
  if(hours)parts.push(`${hours}시간`);if(minutes)parts.push(`${minutes}분`);if(rest||!parts.length)parts.push(`${rest}초`);
  eta.textContent=`약 ${parts.join(' ')} 남음`;
 }
 function progress(title,detail,value=0,cancel=true){
  if(!$('progressDialog').open){clearInterval(progressTimer);progressValue=0;progressStarted=performance.now();$('progressDialog').showModal();progressTimer=setInterval(updateProgressEta,1000);}
  $('progressTitle').textContent=title;$('progressDetail').textContent=detail;$('cancelWork').hidden=!cancel;
  if(value===null){$('progressBar').removeAttribute('value');$('progressPercent').textContent='준비 중';updateProgressEta();return;}
  progressValue=Math.max(progressValue,Math.min(1,Math.max(0,value)));const percent=Math.floor(progressValue*100);
  $('progressBar').value=progressValue*100;const label=`${percent}%`;if($('progressPercent').textContent!==label)$('progressPercent').textContent=label;updateProgressEta();
 }
 function seek(time,signal){
  if(signal?.aborted)return Promise.reject(new DOMException('취소했습니다.','AbortError'));
  if(!videoUrl)return Promise.reject(new Error('원본 영상을 먼저 열어 주세요.'));
  const target=Math.min(Math.max(0,time),Math.max(0,video.duration-0.05));video.pause();
  if(!video.seeking&&Math.abs(video.currentTime-target)<0.005&&video.readyState>=2)return Promise.resolve();
  return new Promise((resolve,reject)=>{
   const cleanup=()=>{clearTimeout(timer);video.removeEventListener('seeked',ok);video.removeEventListener('error',bad);signal?.removeEventListener('abort',abort);};
   // seeked + HAVE_CURRENT_DATA makes the decoded frame available to canvas.
   // Waiting for a repaint here would suspend extraction in background tabs.
   const ok=()=>{cleanup();if(video.readyState<2){reject(new Error('이 시각의 화면을 읽지 못했습니다.'));return;}resolve();};
   const bad=()=>{cleanup();reject(new Error('영상 화면을 읽지 못했습니다.'));};const abort=()=>{cleanup();reject(new DOMException('취소했습니다.','AbortError'));};
   const timer=setTimeout(()=>{cleanup();reject(new Error('화면 이동에 실패했습니다. 다른 시각으로 이동하거나 영상을 다시 열어 주세요.'));},15000);
   video.addEventListener('seeked',ok,{once:true});video.addEventListener('error',bad,{once:true});signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted){abort();return;}video.currentTime=target;
  });
 }
 function capture(area=crop){
  if(!videoUrl||video.readyState<2)throw new Error('현재 영상 화면을 읽을 수 없습니다.');
  const box=C.cropBounds(area,video.videoWidth,video.videoHeight);frameCanvas.width=box.width;frameCanvas.height=box.height;
  frameContext.drawImage(video,box.x,box.y,box.width,box.height,0,0,box.width,box.height);
  return {image:frameCanvas.toDataURL('image/png'),width:box.width,height:box.height,time:video.currentTime};
 }
 function analyze(){
  const key=`${crop.x},${crop.y},${crop.width},${crop.height}`;
  if(analysisCropKey!==key){
   analysisCropKey=key;analysisStages=[];
   for(let width=crop.width,height=crop.height;;width=Math.max(96,Math.floor(width/2)),height=Math.max(72,Math.floor(height/2))){
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;analysisStages.push({canvas,context:canvas.getContext('2d')});
    if(width<=192&&height<=144)break;
   }
  }
  // Video downscaling can alias fine strokes in one large step. Halve the
  // native crop repeatedly so thin text and handwriting contribute steadily.
  for(let i=0;i<analysisStages.length;i++){
   const {canvas,context}=analysisStages[i];
   if(i===0)context.drawImage(video,crop.x,crop.y,crop.width,crop.height,0,0,canvas.width,canvas.height);
   else context.drawImage(analysisStages[i-1].canvas,0,0,canvas.width,canvas.height);
  }
  analysisContext.drawImage(analysisStages.at(-1).canvas,0,0,96,72);
  return C.descriptor(analysisContext.getImageData(0,0,96,72).data);
 }
 function cropValues(){return {x:Number($('cropX').value),y:Number($('cropY').value),width:Number($('cropW').value),height:Number($('cropH').value)};}
 function setCropValues(v){$('cropX').value=v.x;$('cropY').value=v.y;$('cropW').value=v.width;$('cropH').value=v.height;drawCrop();}
 function drawCrop(){
  const c=$('cropPreview'),ctx=c.getContext('2d');c.width=Math.min(1280,video.videoWidth);c.height=Math.round(c.width*video.videoHeight/video.videoWidth);ctx.drawImage(video,0,0,c.width,c.height);
  let v;try{v=C.cropBounds(cropValues(),video.videoWidth,video.videoHeight);}catch(_){$('cropSize').textContent='영역은 영상 안에서 가로·세로 8픽셀 이상으로 정해 주세요.';return;}
  const scale=c.width/video.videoWidth,displayScale=c.width/(c.getBoundingClientRect().width||c.width);
  ctx.fillStyle='rgba(0,0,0,.42)';ctx.beginPath();ctx.rect(0,0,c.width,c.height);ctx.rect(v.x*scale,v.y*scale,v.width*scale,v.height*scale);ctx.fill('evenodd');
  ctx.strokeStyle='#fff';ctx.lineWidth=5*displayScale;ctx.strokeRect(v.x*scale,v.y*scale,v.width*scale,v.height*scale);
  ctx.strokeStyle='#ff3038';ctx.lineWidth=3*displayScale;ctx.strokeRect(v.x*scale,v.y*scale,v.width*scale,v.height*scale);
  for(const p of cropHandles(v)){const size=8*displayScale;ctx.fillStyle='#ff3038';ctx.fillRect(p.x*scale-size/2,p.y*scale-size/2,size,size);ctx.strokeStyle='#fff';ctx.lineWidth=displayScale;ctx.strokeRect(p.x*scale-size/2,p.y*scale-size/2,size,size);}
  ctx.strokeStyle='#31d9ff';ctx.lineWidth=2*displayScale;ctx.setLineDash([6*displayScale,4*displayScale]);
  for(const guide of cropGuides){ctx.beginPath();if(guide.axis==='x'){ctx.moveTo(guide.value*scale,0);ctx.lineTo(guide.value*scale,c.height);}else{ctx.moveTo(0,guide.value*scale);ctx.lineTo(c.width,guide.value*scale);}ctx.stroke();}ctx.setLineDash([]);
  $('cropSnapStatus').classList.toggle('snapped',cropGuides.length>0);$('cropSnapStatus').textContent=cropGuides.length?`${[...new Set(cropGuides.map(g=>g.label))].join(' · ')}에 맞춤`:'Alt/Option을 누르면 잠시 해제';
  c.dataset.snapAxes=cropGuides.map(g=>g.axis).join(',');
  $('cropSize').textContent=`선택한 영역 ${v.width} × ${v.height} · 빨간 테두리 안쪽을 저장합니다.`;
 }
 function cropHandles(v){const x=v.x,y=v.y,r=x+v.width,b=y+v.height,mx=(x+r)/2,my=(y+b)/2;return[{handle:'nw',x,y},{handle:'n',x:mx,y},{handle:'ne',x:r,y},{handle:'e',x:r,y:my},{handle:'se',x:r,y:b},{handle:'s',x:mx,y:b},{handle:'sw',x,y:b},{handle:'w',x,y:my}];}
 function cropPoint(e){const r=$('cropPreview').getBoundingClientRect();return{x:Math.max(0,Math.min(video.videoWidth,(e.clientX-r.left)/r.width*video.videoWidth)),y:Math.max(0,Math.min(video.videoHeight,(e.clientY-r.top)/r.height*video.videoHeight))};}
 function cropHit(point,v){
  const rect=$('cropPreview').getBoundingClientRect(),tx=11*video.videoWidth/rect.width,ty=11*video.videoHeight/rect.height;
  const nearest=cropHandles(v).find(p=>Math.abs(point.x-p.x)<=tx&&Math.abs(point.y-p.y)<=ty);if(nearest)return{mode:'resize',handle:nearest.handle};
  if(point.x>=v.x&&point.x<=v.x+v.width&&Math.abs(point.y-v.y)<=ty)return{mode:'resize',handle:'n'};
  if(point.x>=v.x&&point.x<=v.x+v.width&&Math.abs(point.y-v.y-v.height)<=ty)return{mode:'resize',handle:'s'};
  if(point.y>=v.y&&point.y<=v.y+v.height&&Math.abs(point.x-v.x)<=tx)return{mode:'resize',handle:'w'};
  if(point.y>=v.y&&point.y<=v.y+v.height&&Math.abs(point.x-v.x-v.width)<=tx)return{mode:'resize',handle:'e'};
  return{mode:point.x>v.x&&point.x<v.x+v.width&&point.y>v.y&&point.y<v.y+v.height?'move':'create',handle:''};
 }
 function cropCursor(hit){return hit.mode==='move'?'move':hit.mode==='create'?'crosshair':['nw','se'].includes(hit.handle)?'nwse-resize':['ne','sw'].includes(hit.handle)?'nesw-resize':['n','s'].includes(hit.handle)?'ns-resize':'ew-resize';}
 async function openCrop(){
  if(!videoUrl||busy)return;
  try{video.pause();selectionSeek?.abort();selectionSeek=null;if(video.seeking)await seek(video.currentTime);if(busy)return;cropGesture=null;cropGuides=[];
  const sampler=marginSampler(Math.min(1920,video.videoWidth)),content=marginCrop([sampler.read()],sampler);
  cropTargets=[{axis:'x',value:0,label:'영상 가장자리'},{axis:'x',value:video.videoWidth,label:'영상 가장자리'},{axis:'y',value:0,label:'영상 가장자리'},{axis:'y',value:video.videoHeight,label:'영상 가장자리'}];
  for(const [axis,value,limit]of [['x',content.x,video.videoWidth],['x',content.x+content.width,video.videoWidth],['y',content.y,video.videoHeight],['y',content.y+content.height,video.videoHeight]])if(value>0&&value<limit)cropTargets.push({axis,value,label:'검은 여백 경계'});
  const count=slides.filter(s=>s.image).length;$('applyCropAll').disabled=count===0;$('applyCropAll').checked=count>0;$('applyCropAllLabel').textContent=count?`기존 슬라이드 ${count}장 전체에도 적용`:'기존 슬라이드 전체에도 적용';updateCropApply();
  if(!$('cropDialog').open)$('cropDialog').showModal();setCropValues(crop);
  }catch(err){fail(err);}
 }
 function updateCropApply(){
  const count=slides.filter(s=>s.image).length,all=$('applyCropAll').checked&&count>0,hasSource=!!selected()?.image;
  $('applyCrop').disabled=!all&&count>0&&!hasSource;$('applyCrop').textContent=all?`${count}장에 영역 적용`:hasSource?'현재 슬라이드에 적용':'영역 저장';
  $('cropApplyHelp').textContent=all?'각 화면을 캡처했던 시각에서 다시 저장합니다. 노트·시작 시각·순서를 유지하며, 한 번에 실행 취소할 수 있습니다.':hasSource?'현재 선택한 슬라이드의 화면을 새 영역으로 다시 저장합니다. 다른 슬라이드는 유지하며, 실행 취소할 수 있습니다.':count?'선택한 보충 설명에는 원본 화면이 없습니다. 원본 슬라이드를 선택하거나 전체 적용을 켜 주세요.':'새로 추가하거나 추출할 화면의 영역을 저장합니다.';
 }
 $('cropPreview').addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();let initial;try{initial=C.cropBounds(cropValues(),video.videoWidth,video.videoHeight);}catch(_){return;}cropGuides=[];const start=cropPoint(e);cropGesture={...cropHit(start,initial),initial,start,pointerId:e.pointerId};$('cropPreview').setPointerCapture(e.pointerId);});
 $('cropPreview').addEventListener('pointermove',e=>{
  const point=cropPoint(e);
  if(cropGesture&&e.pointerId===cropGesture.pointerId){e.preventDefault();const g=cropGesture;if(g.mode==='create'&&Math.abs(point.x-g.start.x)+Math.abs(point.y-g.start.y)<8)return;let next=C.dragCrop(g.initial,g.mode,g.handle,g.start,point,video.videoWidth,video.videoHeight);cropGuides=[];
   if($('cropSnap').checked&&!e.altKey){const r=$('cropPreview').getBoundingClientRect(),snapped=C.snapCrop(next,g.mode,g.handle,g.start,point,cropTargets,video.videoWidth,video.videoHeight,{x:8*video.videoWidth/r.width,y:8*video.videoHeight/r.height});next=snapped.crop;cropGuides=snapped.guides;}setCropValues(next);}
  else{try{$('cropPreview').style.cursor=cropCursor(cropHit(point,cropValues()));}catch(_){}}
 });
 function finishCropGesture(e,cancel=false){if(!cropGesture||e.pointerId!==cropGesture.pointerId)return;const initial=cropGesture.initial;cropGesture=null;if($('cropPreview').hasPointerCapture(e.pointerId))$('cropPreview').releasePointerCapture(e.pointerId);if(cancel)setCropValues(initial);else drawCrop();}
 $('cropPreview').addEventListener('pointerup',e=>finishCropGesture(e));$('cropPreview').addEventListener('pointercancel',e=>finishCropGesture(e,true));$('cropDialog').addEventListener('close',()=>{cropGesture=null;});
 function marginSampler(width=320){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.max(8,Math.round(width*video.videoHeight/video.videoWidth));
  const context=canvas.getContext('2d',{willReadFrequently:true});
  return{width:canvas.width,height:canvas.height,read(){context.drawImage(video,0,0,canvas.width,canvas.height);return context.getImageData(0,0,canvas.width,canvas.height).data;}};
 }
 function marginCrop(frames,sampler){
  const box=C.detectBlackMargins(frames,sampler.width,sampler.height),x=Math.round(box.x/sampler.width*video.videoWidth),y=Math.round(box.y/sampler.height*video.videoHeight);
  return C.cropBounds({x,y,width:Math.round((box.x+box.width)/sampler.width*video.videoWidth)-x,height:Math.round((box.y+box.height)/sampler.height*video.videoHeight)-y},video.videoWidth,video.videoHeight);
 }
 function autoCrop(){const sampler=marginSampler();setCropValues(marginCrop([sampler.read()],sampler));}
 async function applyCrop(){
  if(busy)return;
  let next;try{next=C.cropBounds(cropValues(),video.videoWidth,video.videoHeight);}catch(err){fail(err);return;}
  const all=$('applyCropAll').checked,pages=all?slides.filter(s=>s.image):selected()?.image?[selected()]:[];
  if(!pages.length){if(slides.some(s=>s.image)){toast('영역을 적용할 원본 슬라이드를 선택해 주세요.',true);return;}remember('영상 영역 변경');crop=next;touch();updateButtons();$('cropDialog').close();toast('슬라이드 영역을 저장했습니다.');return;}
  if(pages.some(s=>!Number.isFinite(s.time))){fail(new Error('캡처 시각이 없는 화면이 있어 영역을 적용할 수 없습니다. 원본 화면을 다시 지정해 주세요.'));return;}
  selectionSeek?.abort();selectionSeek=null;busy=true;updateButtons();controller=new AbortController();const signal=controller.signal,priorTime=video.currentTime,replacements=new Map(),cache=new Map();let complete=false;
  const progressTitle=all?'슬라이드 영역을 일괄 적용하고 있습니다':'현재 슬라이드 영역을 적용하고 있습니다';
  $('cropDialog').close();progress(progressTitle,`${pages.length}장의 원본 화면을 다시 읽습니다.`,0);
  try{
   for(const [i,s]of pages.entries()){
    signal.throwIfAborted();let frame=cache.get(s.time);
    if(!frame){await seek(s.time,signal);signal.throwIfAborted();frame=capture(next);cache.set(s.time,frame);}
    replacements.set(s.id,{image:frame.image,width:frame.width,height:frame.height});
    progress(progressTitle,`${i+1} / ${pages.length}장 · ${C.timestamp(s.time)} 화면`,(i+1)/pages.length*.97);await yieldToBrowser();
   }
   signal.throwIfAborted();remember(all?'모든 슬라이드 영역 변경':'선택한 슬라이드 영역 변경',true);crop=next;
   for(const s of slides)if(replacements.has(s.id))Object.assign(s,replacements.get(s.id));
   // Requests bind to image fingerprints. Never apply an old AI reply to a new crop.
   assistant?.restore(assistant.snapshot());touch();complete=true;render();progress('영역 적용 완료',`${pages.length}장의 화면을 새 영역으로 저장했습니다.`,1,false);toast(`${pages.length}장에 새 영역을 적용했습니다. 실행 취소로 되돌릴 수 있습니다.`);
  }catch(err){if(err.name==='AbortError')toast('영역 적용을 취소했습니다. 기존 화면과 설정을 유지합니다.');else fail(err);}
  finally{controller=null;try{await seek(complete?(C.slideStart(selected())??priorTime):priorTime);}catch(_){}busy=false;$('progressDialog').close();updateButtons();lastVideoSelection=null;if(complete)syncSelectedVideo();}
 }
 async function detectCrop(signal){
  const sampler=marginSampler(),frames=[];
  for(const fraction of [.02,.2,.5,.8,.98]){
   await seek(video.duration*fraction,signal);frames.push(sampler.read());
   progress('슬라이드 영역을 찾고 있습니다',`검은 여백 확인 · ${frames.length} / 5개 지점`,frames.length/5*.05);
  }
  return marginCrop(frames,sampler);
 }
 async function refineSlideStart(candidate,interval,scanStart,threshold,signal){
  const first=candidate.segments[0];if(first.start<=scanStart+.01)return scanStart;
  let high=Math.min(first.start,video.duration-.08),low=Math.max(scanStart,high-interval);
  await seek(high,signal);const signature=analyze().pixels;
  await seek(low,signal);if(C.difference(signature,analyze().pixels)<=threshold)return low;
  while(high-low>D.refineResolution){const middle=(low+high)/2;await seek(middle,signal);if(C.difference(signature,analyze().pixels)<=threshold)high=middle;else low=middle;}
  return high;
 }
 async function finalFrame(candidate,threshold,signal,refine){
  if(!refine){await seek(candidate.chosenTime,signal);return capture();}
  // Use the interval containing the chosen representative, including revisits.
  const segment=candidate.segments.find(s=>s.start<=candidate.chosenTime&&s.end>=candidate.chosenTime);
  let low=candidate.chosenTime,high=Math.min(segment?.end??low,video.duration)-.08;
  if(high<=low){await seek(low,signal);return capture();}
  await seek(high,signal);
  if(C.difference(candidate.signature,analyze().pixels)<=threshold)return capture();
  // Narrow only the bracket between the last known page and its next page.
  // Keep a small margin before a transition to avoid a partially faded frame.
  while(high-low>D.refineResolution){
   const middle=(low+high)/2;await seek(middle,signal);
   if(C.difference(candidate.signature,analyze().pixels)<=threshold)low=middle;else high=middle;
  }
  await seek(Math.max(candidate.chosenTime,low-D.transitionGuard),signal);return capture();
 }
 async function initialExerciseFrame(candidate,finalSignature,signal){
  if(C.layoutStats(finalSignature).panelFraction<D.exercisePanelFraction)return null;
  const first=candidate.segments[0],lastTime=Math.min(first.end-.7,candidate.chosenTime-.7);
  for(let step=0;step<3;step++){
   const time=first.start+D.exerciseSettle+step;if(time>lastTime)break;
   await seek(time,signal);const initial=analyze();
   if(C.layoutStats(initial.pixels).panelFraction<D.exercisePanelFraction||C.difference(initial.pixels,finalSignature)<D.exerciseMinChange)continue;
   await seek(time+.5,signal);const next=analyze();
   if(C.difference(initial.pixels,next.pixels)>D.exerciseStableDifference)continue;
   await seek(time,signal);return capture();
  }
  return null;
 }
 async function extract(options={}){
  if(busy||!videoUrl)return;
  const automatic=options.automatic===true;
  const start=automatic?0:C.parseTime($('rangeStart').value),end=automatic||$('rangeEnd').value===$('rangeEnd').dataset.videoEnd?video.duration:C.parseTime($('rangeEnd').value),interval=automatic?D.interval:Number($('sampleInterval').value);
  const threshold=automatic?D.threshold:(C.DETECTION_PRESETS[$('sensitivity').value]||C.DETECTION_PRESETS.balanced).threshold,merge=automatic||$('mergeRepeated').checked,refine=automatic||$('refineFrames').checked,splitExercises=automatic||$('splitExercises').checked,excludeEnding=automatic||$('excludeEnding').checked;
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>video.duration+0.1||end<=start){toast('영상 안의 올바른 시작·끝 시각을 입력해 주세요.',true);return;}
  if((end-start)/interval>20000){toast('구간을 나누거나 확인 간격을 늘려 주세요.',true);return;}
  C.cropBounds(crop,video.videoWidth,video.videoHeight);
  if($('extractDialog').open)$('extractDialog').close();selectionSeek?.abort();selectionSeek=null;busy=true;updateButtons();controller=new AbortController();const signal=controller.signal,priorTime=video.currentTime,priorCrop={...crop};let complete=false;
  try{
   if(automatic){progress('슬라이드 영역을 찾고 있습니다','영상의 여러 지점에서 검은 여백을 확인합니다.');crop=await detectCrop(signal);}
   const detector=new C.SceneDetector(threshold,D.confirmations);
   progress('슬라이드 전환을 찾고 있습니다','영상을 확인하는 중입니다.',.05);
   const stop=Math.max(start,Math.min(video.duration-0.08,end-0.08));
   const times=[];for(let t=start;t<stop;t+=interval)times.push(t);times.push(stop);
   for(let i=0;i<times.length;i++){
    if(signal.aborted)throw new DOMException('취소했습니다.','AbortError');await seek(times[i],signal);detector.push(times[i],analyze());
    if(i%5===0)progress('슬라이드 전환을 찾고 있습니다',`${C.timestamp(times[i])} / ${C.timestamp(end)} · ${i+1}/${times.length} 화면`,.05+(i+1)/times.length*.65);
   }
   let candidates=detector.finish(end);
   if(merge)candidates=C.groupSegments(candidates,D.mergeTolerance);
   else candidates=candidates.map(s=>({...s,segments:[{start:s.start,end:s.end}]}));
   if(candidates.length>300)throw new Error('후보가 300장을 넘었습니다. 화면 나누기를 “큰 전환만 나누기”로 바꾸거나 구간을 나누어 추출해 주세요.');
   let result=[];
   for(let i=0;i<candidates.length;i++){
    if(signal.aborted)throw new DOMException('취소했습니다.','AbortError');const candidate=candidates[i];
    progress('전환 직전의 필기 화면을 저장하고 있습니다',`${i+1} / ${candidates.length}장`,.70+.28*i/candidates.length);
    const startTime=await refineSlideStart(candidate,interval,start,threshold,signal);
    const frame=await finalFrame(candidate,threshold,signal,refine),finalSignature=analyze().pixels;
    const s={...C.blankSlide(),...frame,startTime,title:`슬라이드 ${slides.length+i+1}`,segments:candidate.segments};
    if(excludeEnding&&C.isSparseEnding({...candidate,signature:finalSignature},video.duration)){
     s.included=false;s.autoExcludedReason='자동 제외 · 마지막의 짧고 내용이 적은 화면';
    }
    const initial=splitExercises&&s.included?await initialExerciseFrame(candidate,finalSignature,signal):null;
    if(initial){const pair=C.splitExerciseFrames(s,initial.image,initial.time,initial.width,initial.height);pair.question.title=`문제 · ${s.title}`;pair.solution.title=`풀이 · ${s.title}`;result.push(pair.question,pair.solution);}
    else result.push(s);
   }
   progress('슬라이드 순서와 시작 시각을 검증하고 있습니다',`${result.length}장 · 첫 등장 순서와 캡처 구간 확인`,.985);await yieldToBrowser();signal.throwIfAborted();
   const verified=C.verifyExtraction(result,video.duration,interval);result=verified.slides;
   const detectedCrop=crop;crop=priorCrop;remember('슬라이드 추출');crop=detectedCrop;slides.push(...result);selectedId=result[0]?.id||selectedId;complete=true;touch();render();
   $('videoControls').hidden=false;$('toggleVideo').textContent='접기';
   progress('슬라이드 준비 완료','노트 편집과 영상 재생을 시작할 수 있습니다.',1,false);await yieldToBrowser();
   const included=result.filter(s=>s.included).length,excluded=result.length-included,pairs=result.filter(s=>s.kind==='question'&&s.pairId).length;
   status(`${included}개 슬라이드를 영상 순서로 검증했습니다.${verified.reordered||verified.corrected?' 순서·시작 시각을 보정했습니다.':''}${pairs?` 문제·풀이 ${pairs}쌍.`:''}${excluded?` 종료 후보 ${excluded}개는 체크를 해제해 보관했습니다.`:''} 왼쪽에서 선택해 노트를 작성하세요.`);toast(`${included}개 슬라이드 자동 구성 · 순서 검증 완료${excluded?` · ${excluded}개 자동 제외`:''}`);
  }catch(err){if(err.name==='AbortError'){toast('추출을 취소했습니다. 기존 작업은 유지됩니다.');status('추출을 취소했습니다.');}else fail(err);}
  finally{if(!complete){crop=priorCrop;touch();}controller=null;try{await seek(complete?(C.slideStart(selected())??priorTime):priorTime);}catch(_){}busy=false;$('progressDialog').close();updateButtons();if(complete){lastVideoSelection=null;syncSelectedVideo();}}
  return complete;
 }
 async function captureNew(replace=false){
  try{const frame=capture();remember(replace?'원본 화면 교체':'현재 화면 추가');if(replace)Object.assign(selected(),frame);else{const s={...C.blankSlide(),...frame,startTime:frame.time,title:`슬라이드 ${slides.length+1}`,segments:[{start:frame.time,end:frame.time}]};const index=selected()?slides.indexOf(selected())+1:slides.length;slides.splice(index,0,s);selectedId=s.id;}touch();render();toast(replace?'선택한 페이지의 화면을 교체했습니다.':'현재 화면을 추가했습니다.');}catch(err){fail(err);}
 }
 function move(delta){const i=slides.indexOf(selected());if(i<0||i+delta<0||i+delta>=slides.length||busy)return;remember('페이지 순서 변경');slides.splice(i+delta,0,slides.splice(i,1)[0]);touch();render();}
 function duplicate(){const s=selected();if(!s||busy)return;if(slides.length>=1000){toast('페이지는 최대 1,000장까지 보관할 수 있습니다.',true);return;}remember('페이지 복사');const copy=C.duplicateSlide(s);slides.splice(slides.indexOf(s)+1,0,copy);selectedId=copy.id;touch();render();toast('바로 다음에 페이지를 복사했습니다.');}
 async function exportFile(type){
  if(busy)return;busy=true;updateButtons();progress(`${type.toUpperCase()}를 만들고 있습니다`,'노트의 서식과 이미지를 배치합니다.',null,false);
  await yieldToBrowser();
  try{const result=type==='pdf'?await E.toPdf(snapshot()):await E.toPptx(snapshot());E.download(result.blob,`${E.basename(title)}.${type}`);progress('내보내기 완료',`${result.count}페이지를 저장했습니다.`,1,false);await yieldToBrowser();status(`${result.count}페이지 ${type.toUpperCase()}를 내보냈습니다. 브라우저 다운로드 위치를 확인해 주세요.`);toast(`${type.toUpperCase()} ${result.count}페이지를 저장했습니다.`);}catch(err){fail(err);}finally{busy=false;$('progressDialog').close();updateButtons();}
 }
 async function newLecture(){
  if(slides.length&&!confirm('새 강의를 시작하면 현재 노트가 초기화됩니다. 완성본이 필요하면 PPTX·PDF로 내보내 주세요. 새 강의를 시작할까요?'))return;
  clearTimeout(saveTimer);selectionSeek?.abort();selectionSeek=null;lastVideoSelection=null;notesEditor?.destroy();notesEditor=null;editorSlideId=null;rawMode=false;if(videoUrl)URL.revokeObjectURL(videoUrl);videoUrl=null;videoInfo=null;crop=null;slides=[];selectedId=null;history=[];future=[];pendingHistory=null;dirty=false;title='새 강의자료';recoverable=null;
  transcript=null;originalFile=null;speechUI?.reset();video.removeAttribute('src');video.load();video.style.display='none';$('videoPlaceholder').hidden=false;assistant?.reset();render();showWelcome();
  try{await dbOperation('readwrite',s=>s.delete('latest'));}catch(_){}status('첫 화면에서 강의 영상을 선택해 주세요.');
 }
 function setMode(raw){
  const s=selected();if(!s)return;
  if(!raw&&rawMode){notesEditor.commands.setContent(N.parse(s.notes),{emitUpdate:false});s.notes=notesEditor.getMarkdown();s.title=C.noteTitle(notesEditor.getJSON())||s.title;touch();}
  rawMode=raw;renderEditor();if(raw)$('markdownSource').focus();else notesEditor.view.focus();
 }
 $('welcomeOpen').addEventListener('click',()=>$('videoFile').click());
 $('videoFile').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';await loadVideo(file);});
 const dropZone=$('welcomeOpen');
 dropZone.addEventListener('dragover',e=>{e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='copy';dropZone.classList.add('drag-over');});
 dropZone.addEventListener('dragleave',e=>{if(!dropZone.contains(e.relatedTarget))dropZone.classList.remove('drag-over');});
 dropZone.addEventListener('drop',e=>{e.preventDefault();dropZone.classList.remove('drag-over');const file=e.dataTransfer?.files?.[0];if(file)loadVideo(file);});
 $('welcome').addEventListener('dragover',e=>e.preventDefault());$('welcome').addEventListener('drop',e=>e.preventDefault());
 $('newLecture').addEventListener('click',newLecture);$('exportPptx').addEventListener('click',()=>exportFile('pptx'));$('exportPdf').addEventListener('click',()=>exportFile('pdf'));
 $('lectureTitle').addEventListener('input',e=>{title=e.target.value||'강의자료';touch();});
 $('richMode').addEventListener('click',()=>setMode(false));$('markdownMode').addEventListener('click',()=>setMode(true));
 $('markdownSource').addEventListener('input',e=>{if(!selected())return;const markdown=e.target.value;noteChanged(markdown,N.parse(markdown));});
 for(const button of $('noteToolbar').querySelectorAll('[data-command]')){
  button.addEventListener('mousedown',e=>{syncNoteSelection();e.preventDefault();});
  button.addEventListener('click',()=>{if(!notesEditor||rawMode)return;const name=button.dataset.command,chain=notesEditor.chain().focus();if(name==='horizontalRule')chain.setHorizontalRule().run();else if(name==='undo'||name==='redo')chain[name]().run();else chain['toggle'+name[0].toUpperCase()+name.slice(1)]().run();syncToolbar();});
 }
 $('noteFormat').addEventListener('pointerdown',syncNoteSelection);
 $('noteFormat').addEventListener('change',e=>{if(!notesEditor)return;const value=e.target.value;syncNoteSelection();const chain=notesEditor.chain().focus();if(value==='paragraph')chain.setParagraph().run();else chain.setHeading({level:Number(value)}).run();syncToolbar();});
 $('speakerNotes').addEventListener('input',e=>{const s=selected();if(s){s.speakerNotes=e.target.value;touch();}});
 $('kind').addEventListener('change',e=>{const s=selected();if(!s)return;remember('페이지 종류 변경');s.kind=e.target.value;touch();render();});
 $('showNotes').addEventListener('change',e=>{const s=selected();if(!s?.image||busy)return;remember('강의노트 표시 변경');s.showNotes=e.target.checked;touch();render();});
 $('autoNoteFont').addEventListener('change',e=>setNoteFont(e.target.checked?null:Number($('noteFontSize').value)));
 $('noteFontSize').addEventListener('change',e=>setNoteFont(e.target.valueAsNumber));
 $('noteFontSmaller').addEventListener('click',()=>setNoteFont(Math.max(8,Number($('noteFontSize').value)-1)));$('noteFontLarger').addEventListener('click',()=>setNoteFont(Math.min(36,Number($('noteFontSize').value)+1)));
 $('addSupplement').addEventListener('click',()=>{remember('보충 설명 추가');const s={...C.blankSlide('supplement'),title:'보충 설명'};let index=selected()?slides.indexOf(selected())+1:slides.length;if(selected()?.kind==='question'&&slides[index]?.pairId===selected().pairId)index++;slides.splice(index,0,s);selectedId=s.id;touch();render();if(rawMode)$('markdownSource').focus();else notesEditor.view.focus();});
 $('duplicateSlide').addEventListener('click',duplicate);
 $('moveUp').addEventListener('click',()=>move(-1));$('moveDown').addEventListener('click',()=>move(1));
 $('deleteSlide').addEventListener('click',()=>{const index=slides.indexOf(selected());if(index<0||busy)return;remember('페이지 삭제');slides.splice(index,1);selectedId=slides[Math.min(index,slides.length-1)]?.id||null;touch();render();});
 $('undo').addEventListener('click',()=>travelHistory());$('redo').addEventListener('click',()=>travelHistory(true));
 document.addEventListener('keydown',e=>{
  if(e.defaultPrevented||busy||$('workspace').hidden||document.querySelector('dialog[open]')||!(e.metaKey||e.ctrlKey)||e.altKey)return;
  if(e.target instanceof Element&&e.target.closest('textarea,select,input:not([type="checkbox"]):not([type="radio"]):not([type="button"]),[contenteditable="true"],#noteToolbar'))return;
  const key=e.key.toLowerCase(),redo=(key==='z'&&e.shiftKey)||(key==='y'&&e.ctrlKey&&!e.metaKey);
  if(key!=='z'&&!redo)return;e.preventDefault();travelHistory(redo);
 });
 $('importNotes').addEventListener('click',()=>$('notesFile').click());$('notesFile').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file||!selected())return;const target=selected().id;if(file.size>2*1024*1024){toast('노트 파일은 2MB 이하로 선택해 주세요.',true);return;}const text=await file.text();if(target!==selected()?.id)return;if(text.length>100000){toast('노트는 100,000자 이하로 나누어 주세요.',true);return;}remember('노트 불러오기');const markdown=/\.(md|markdown)$/i.test(file.name)?text:N.plainMarkdown(text);selected().notes=markdown;selected().notesFormat='markdown';selected().title=C.noteTitle(N.parse(markdown))||selected().title;touch();renderEditor();updateButtons();});
 video.addEventListener('timeupdate',()=>{if(document.activeElement!==$('seekInput'))$('seekInput').value=C.timestamp(video.currentTime);});
 const go=async time=>{try{if(!Number.isFinite(time))throw new Error('시각을 01:30 또는 초 단위로 입력해 주세요.');await seek(time);}catch(err){fail(err);}};
 $('seekButton').addEventListener('click',()=>go(C.parseTime($('seekInput').value)));$('seekInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();go(C.parseTime(e.target.value));}});
 $('backSecond').addEventListener('click',()=>go(video.currentTime-1));$('forwardSecond').addEventListener('click',()=>go(video.currentTime+1));
 for(const id of ['previewTime','sourceTime'])$(id).addEventListener('click',async()=>{const start=selected()?C.slideStart(selected()):null;if(start===null)return;$('videoControls').hidden=false;$('toggleVideo').textContent='접기';$('toggleVideo').setAttribute('aria-expanded','true');await go(start);});
 $('captureNew').addEventListener('click',()=>captureNew());$('replaceFrame').addEventListener('click',()=>captureNew(true));
 $('toggleVideo').addEventListener('click',()=>{const el=$('videoControls');el.hidden=!el.hidden;$('toggleVideo').textContent=el.hidden?'펼치기':'접기';$('toggleVideo').setAttribute('aria-expanded',String(!el.hidden));});
 $('toggleNoteOptions').addEventListener('click',()=>{const el=$('noteOptionsControls');el.hidden=!el.hidden;$('toggleNoteOptions').textContent=el.hidden?'펼치기':'접기';$('toggleNoteOptions').setAttribute('aria-expanded',String(!el.hidden));});
 $('cropButton').addEventListener('click',openCrop);$('closeCrop').addEventListener('click',()=>$('cropDialog').close());$('fullCrop').addEventListener('click',()=>{cropGuides=[];setCropValues({x:0,y:0,width:video.videoWidth,height:video.videoHeight});});$('autoCrop').addEventListener('click',()=>{cropGuides=[];autoCrop();});
 for(const id of ['cropX','cropY','cropW','cropH'])$(id).addEventListener('input',()=>{cropGuides=[];drawCrop();});
 $('cropSnap').addEventListener('change',()=>{cropGuides=[];drawCrop();});$('applyCropAll').addEventListener('change',updateCropApply);
 $('applyCrop').addEventListener('click',applyCrop);
 function explainExtraction(){$('sensitivityHelp').textContent=(C.DETECTION_PRESETS[$('sensitivity').value]||C.DETECTION_PRESETS.balanced).description;$('intervalHelp').textContent=`${$('sampleInterval').value}초마다 화면을 확인합니다. 간격이 짧으면 잠깐 나온 화면을 찾는 데 유리하지만 시간이 더 걸립니다.`;}
 function openExtract(){$('rangeStart').value='00:00';$('rangeEnd').value=C.timestamp(video.duration);$('rangeEnd').dataset.videoEnd=$('rangeEnd').value;$('extractNotice').textContent=slides.length?'추출 결과는 기존 페이지 뒤에 추가됩니다. 기존 노트는 유지됩니다.':'자동으로 슬라이드를 구성합니다.';$('startExtract').textContent=slides.length?'추출해서 목록 뒤에 추가':'슬라이드 추출 시작';explainExtraction();$('extractDialog').showModal();}
 $('extract').addEventListener('click',()=>slides.length?openExtract():extract({automatic:true}).catch(fail));$('extractSettings').addEventListener('click',openExtract);
 $('closeExtract').addEventListener('click',()=>$('extractDialog').close());$('startExtract').addEventListener('click',()=>extract().catch(fail));
 $('sensitivity').addEventListener('change',explainExtraction);$('sampleInterval').addEventListener('change',explainExtraction);
 $('cancelWork').addEventListener('click',()=>controller?.abort());$('progressDialog').addEventListener('cancel',e=>{e.preventDefault();controller?.abort();});
 $('progressDialog').addEventListener('close',()=>{if(!$('progressDialog').open){clearInterval(progressTimer);progressTimer=null;}});
 window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
 assistant=window.StudioAssistant.create({
  get:()=>({slides,title,transcript}),changed:touch,persist:autoSave,notify:message=>{status(message);toast(message);},
  openTranscript:()=>speechUI.open(()=>assistant.open()),
  apply:(request,text,mode)=>{const result=window.StudioAI.applyReply(slides,request,text,C.blankSlide,mode,transcript);remember('AI 보완 반영',true);slides=result.slides;touch();render();return result;},
  work:async task=>{
   if(busy)throw new Error('진행 중인 작업이 끝난 뒤 다시 시도해 주세요.');
   busy=true;controller=new AbortController();updateButtons();progress('AI가 강의자료를 보완하고 있습니다','원본 슬라이드와 필기를 읽습니다.',0);
   try{await task({signal:controller.signal,report:progress});}
   finally{await autoSave();controller=null;busy=false;$('progressDialog').close();updateButtons();}
  }
 });
 speechUI=window.StudioTranscriptUI.create({
  get:()=>({slides,title,transcript,video:videoInfo,file:originalFile}),
  apply:next=>{if(busy)throw new Error('현재 작업을 마친 뒤 다시 시도해 주세요.');remember(next?'교수님 음성 기록 연결':'교수님 음성 기록 연결 해제',true);transcript=next;assistant.restore(assistant.snapshot());touch();render();status(next?'음성 기록을 연결했습니다. AI 보완에서 교수님 설명을 함께 정리할 수 있습니다.':'음성 기록 연결을 해제했습니다. 기존 노트는 유지됩니다.');},
  openAI:()=>assistant.open(),
  work:async task=>{
   if(busy)throw new Error('진행 중인 작업이 끝난 뒤 다시 시도해 주세요.');
   busy=true;controller=new AbortController();updateButtons();progress('클로바노트에 보낼 MP3를 준비하고 있습니다','원본 영상의 시간과 무음을 유지해 음성 파일을 만듭니다.',0);
   try{return await task({signal:controller.signal,report:progress});}
   finally{await autoSave();controller=null;busy=false;$('progressDialog').close();updateButtons();}
  }
 });
 $('assistantOpen').addEventListener('click',()=>assistant.open());
 $('transcriptOpen').addEventListener('click',()=>speechUI.open());
 E.loadFonts().catch(err=>status(err.message));
 render();const recoveryReady=recovery();
})();
