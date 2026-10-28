(function(){
 'use strict';
 const C=window.StudioCore,E=window.StudioExport,N=window.StudioNotes,D=C.DETECTION_DEFAULTS,$=id=>document.getElementById(id);
 let slides=[],selectedId=null,title='새 강의자료',videoInfo=null,crop=null,videoUrl=null,busy=false,dirty=false;
 let history=[],saveTimer=null,toastTimer=null,controller=null,dragId=null,editRevision=0,recoverable=null;
 let notesEditor=null,editorSlideId=null,rawMode=false,progressValue=0,progressStarted=0,progressTimer=null;
 const video=$('video'),analysisCanvas=document.createElement('canvas'),frameCanvas=document.createElement('canvas');
 analysisCanvas.width=96;analysisCanvas.height=72;
 const analysisContext=analysisCanvas.getContext('2d',{willReadFrequently:true}),frameContext=frameCanvas.getContext('2d');
 let analysisStages=[],analysisCropKey='';
 const selected=()=>slides.find(s=>s.id===selectedId)||null;
 const snapshot=()=>C.workspaceState(slides,title,videoInfo,crop);
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
 function remember(){history.push({slides:slides.map(s=>({...s,segments:s.segments.map(v=>({...v}))})),selectedId,title,videoInfo:videoInfo?{...videoInfo}:null,crop:crop?{...crop}:null});if(history.length>20)history.shift();$('undo').disabled=false;}
 function touch(){dirty=true;editRevision++;$('saveStatus').textContent='저장 중';clearTimeout(saveTimer);saveTimer=setTimeout(autoSave,700);}
 function element(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
 function render(){
  $('lectureTitle').value=title;
  $('videoMeta').textContent=videoInfo?`${videoInfo.name} · ${C.timecode(videoInfo.duration)} · ${videoInfo.width} × ${videoInfo.height}`:'영상을 준비하고 있습니다';
  $('slideCount').textContent=`${slides.filter(s=>s.included).length} / ${slides.length}`;
  $('slideList').replaceChildren();
  slides.forEach((s,i)=>{
   const row=element('div','slide-item'+(s.id===selectedId?' active':'')+(!s.included?' excluded':''));row.dataset.id=s.id;row.draggable=true;row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label',`${i+1} ${s.title||C.KINDS[s.kind]}`);row.setAttribute('aria-pressed',String(s.id===selectedId));
   const check=element('input');check.type='checkbox';check.checked=s.included;check.setAttribute('aria-label',`${i+1}페이지 내보내기에 포함`);
   check.addEventListener('click',e=>e.stopPropagation());check.addEventListener('change',()=>{remember();s.included=check.checked;touch();render();});
   const item=element('div');
   if(s.image){const image=element('img','thumbnail');image.src=s.image;image.alt=`${i+1}페이지 원본 미리보기`;image.loading='lazy';item.append(image);}else item.append(element('div','thumbnail supplement-thumbnail',s.title||'보충 설명'));
   item.append(element('div','item-title',s.title||`${C.KINDS[s.kind]} ${i+1}`));
   const start=C.slideStart(s),meta=element('div','item-meta');meta.append(element('span','',`${String(i+1).padStart(2,'0')} · ${C.KINDS[s.kind]}`),element('span','',start===null?'직접 작성':C.timecode(start,true)));item.append(meta);row.append(check,item);
   if(!s.included&&s.autoExcludedReason)item.append(element('p','auto-excluded',s.autoExcludedReason));
   row.addEventListener('click',()=>choose(s.id));row.addEventListener('keydown',e=>{if(e.target===row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();choose(s.id);}});
   row.addEventListener('dragstart',e=>{dragId=s.id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',s.id);});
   row.addEventListener('dragover',e=>e.preventDefault());row.addEventListener('drop',e=>{e.preventDefault();if(!dragId||dragId===s.id)return;const from=slides.findIndex(x=>x.id===dragId),to=slides.indexOf(s);if(from<0)return;remember();slides.splice(to,0,slides.splice(from,1)[0]);dragId=null;touch();render();});
   $('slideList').append(row);
  });
  if(!slides.length){const empty=element('div','empty-library');empty.append(element('strong','','슬라이드를 자동으로 찾습니다'),element('p','','추출이 끝나면 여기에 목록이 채워집니다. 취소했다면 위의 자동 추출로 다시 시작할 수 있습니다.'));$('slideList').append(empty);}
  renderEditor();updateButtons();
 }
 function choose(id){selectedId=id;render();}
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
  const s=selected(),i=slides.indexOf(s);$('notePanel').hidden=!s;$('noSelection').hidden=!!s;
  $('pagePosition').textContent=s?`${i+1} / ${slides.length} 페이지`:'슬라이드를 준비하고 있습니다';$('pageKind').textContent=s?C.KINDS[s.kind]:'';
  if(!s){notesEditor?.destroy();notesEditor=null;editorSlideId=null;renderPreview();return;}
  if(s.notesFormat!=='markdown'){s.notes=N.legacyMarkdown(s);s.notesFormat='markdown';}
  if(editorSlideId!==s.id){notesEditor?.destroy();editorSlideId=s.id;notesEditor=N.create({element:$('noteEditor'),markdown:s.notes,onChange:noteChanged,onSelection:syncToolbar});}
  else if(!rawMode&&notesEditor.getMarkdown()!==s.notes)notesEditor.commands.setContent(N.parse(s.notes),{emitUpdate:false});
  if(!rawMode||document.activeElement!==$('markdownSource'))$('markdownSource').value=s.notes;
  $('kind').value=s.kind;$('speakerNotes').value=s.speakerNotes;
  $('noteEditor').hidden=rawMode;$('markdownSource').hidden=!rawMode;
  $('richMode').classList.toggle('active',!rawMode);$('richMode').setAttribute('aria-pressed',String(!rawMode));$('markdownMode').classList.toggle('active',rawMode);$('markdownMode').setAttribute('aria-pressed',String(rawMode));
  syncToolbar();renderPreview();
 }
 function renderPreview(){
  const s=selected(),i=slides.indexOf(s),isSupplement=s&&s.kind==='supplement'&&!s.image;
  $('slidePreview').classList.toggle('supplement',!!isSupplement);
  $('previewImage').style.display=s&&s.image?'block':'none';$('previewEmpty').style.display=s&&s.image?'none':'block';
  if(s&&s.image)$('previewImage').src=s.image;else $('previewImage').removeAttribute('src');
  $('previewLabel').textContent=s?(s.kind==='question'?'직접 풀기':s.kind==='solution'?'풀이와 해설':s.kind==='supplement'?'보충 설명':'강의 노트'):'강의 노트';
  // Only schema-generated HTML is rendered; raw Markdown HTML is escaped.
  $('previewBody').innerHTML=s?N.html(s.notes):'';
  for(const input of $('previewBody').querySelectorAll('input')){input.disabled=true;input.checked=input.closest('li')?.dataset.checked==='true';}
  for(const link of $('previewBody').querySelectorAll('a')){link.target='_blank';link.rel='noopener noreferrer';}
  const start=s?C.slideStart(s):null;$('previewTime').textContent=s?(start===null?'보충 설명':`시작 ${C.timecode(start,true)}`):'';$('previewTime').disabled=!videoUrl||start===null;$('previewPage').textContent=s?String(i+1).padStart(2,'0'):'';
  $('previewCaption').textContent=s&&s.notes.length>(s.image?210:500)?'긴 노트는 내보낼 때 다음 페이지로 이어집니다.':'서식과 노트가 PPTX·PDF에 함께 반영됩니다.';
 }
 function updateButtons(){
  const s=selected(),v=!!videoUrl,available=slides.some(s=>s.included);
  $('exportPptx').disabled=!available||busy;$('exportPdf').disabled=!available||busy;
  $('extract').disabled=!v||busy;$('extractSettings').disabled=!v||busy;$('extract').textContent=slides.length?'슬라이드 다시 추출':'자동 추출';$('cropButton').disabled=!v||busy;$('captureNew').disabled=!v||busy;$('replaceFrame').disabled=!v||!s||s.kind==='supplement'||busy;
  $('newLecture').disabled=busy;$('addSupplement').disabled=busy;$('moveUp').disabled=!s||slides.indexOf(s)===0||busy;$('moveDown').disabled=!s||slides.indexOf(s)===slides.length-1||busy;$('deleteSlide').disabled=!s||busy;$('undo').disabled=!history.length||busy;
  $('cropDescription').textContent=crop?`선택 영역 ${crop.width} × ${crop.height} · 시작 (${crop.x}, ${crop.y})`:'슬라이드 영역을 준비하고 있습니다.';
 }
 async function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open('lecture-slide-studio',1);r.onupgradeneeded=()=>r.result.createObjectStore('workspace');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
 async function dbOperation(mode,callback){
  const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('workspace',mode),store=tx.objectStore('workspace');let result;const request=callback(store);if(request)request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('자동 저장을 완료하지 못했습니다.'));});}finally{db.close();}
 }
 async function autoSave(){
  const revision=editRevision;
  try{await dbOperation('readwrite',store=>store.put(snapshot(),'latest'));if(revision===editRevision){dirty=false;$('saveStatus').textContent='자동 저장됨';}}
  catch(err){$('saveStatus').textContent='자동 저장 실패';status('브라우저에 노트를 저장하지 못했습니다. 완성본을 PPTX 또는 PDF로 내보내 주세요.');}
 }
 async function recovery(){
  try{
   const raw=await dbOperation('readonly',s=>s.get('latest'));if(!raw?.slides?.length)return;
   const data=C.validateWorkspace(raw);for(const s of data.slides){s.notes=N.legacyMarkdown(s);s.notesFormat='markdown';}
   recoverable=data;
  }catch(err){/* Browser storage can be unavailable in private/file contexts. */}
 }
 async function loadVideo(file){
  if(!file||busy)return;
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
   if(restored){slides=recoverable.slides;title=recoverable.title;crop=recoverable.crop;selectedId=slides[0]?.id||null;history=[];recoverable=null;}
   videoUrl=next;if(old)URL.revokeObjectURL(old);videoInfo={name:file.name,size:file.size,duration:video.duration,width:video.videoWidth,height:video.videoHeight};
   if(!crop)crop={x:0,y:0,width:video.videoWidth,height:video.videoHeight};
   if(!slides.length)title=file.name.replace(/\.[^.]+$/,'');
   video.style.display='block';$('videoPlaceholder').hidden=true;$('videoControls').hidden=false;$('toggleVideo').textContent='접기';
   busy=false;$('progressDialog').close();render();touch();
   if(!slides.length){status('영상이 편집 화면에 연결되었습니다. 슬라이드 자동 추출을 시작합니다.');await extract({automatic:true});}
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
  if(Math.abs(video.currentTime-target)<0.005&&video.readyState>=2)return Promise.resolve();
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
 function capture(){
  if(!videoUrl||video.readyState<2)throw new Error('현재 영상 화면을 읽을 수 없습니다.');
  const box=C.cropBounds(crop,video.videoWidth,video.videoHeight);frameCanvas.width=box.width;frameCanvas.height=box.height;
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
  const c=$('cropPreview'),ctx=c.getContext('2d');c.width=640;c.height=Math.round(640*video.videoHeight/video.videoWidth);ctx.drawImage(video,0,0,c.width,c.height);
  const v=cropValues(),scale=c.width/video.videoWidth;
  ctx.fillStyle='rgba(0,0,0,.42)';ctx.beginPath();ctx.rect(0,0,c.width,c.height);ctx.rect(v.x*scale,v.y*scale,v.width*scale,v.height*scale);ctx.fill('evenodd');
  ctx.strokeStyle='#dfeeaf';ctx.lineWidth=2;ctx.strokeRect(v.x*scale,v.y*scale,v.width*scale,v.height*scale);
 }
 function openCrop(){if(!videoUrl)return;video.pause();setCropValues(crop);$('cropDialog').showModal();}
 function marginSampler(){
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=Math.max(8,Math.round(320*video.videoHeight/video.videoWidth));
  const context=canvas.getContext('2d',{willReadFrequently:true});
  return{width:canvas.width,height:canvas.height,read(){context.drawImage(video,0,0,canvas.width,canvas.height);return context.getImageData(0,0,canvas.width,canvas.height).data;}};
 }
 function marginCrop(frames,sampler){
  const box=C.detectBlackMargins(frames,sampler.width,sampler.height),x=Math.round(box.x/sampler.width*video.videoWidth),y=Math.round(box.y/sampler.height*video.videoHeight);
  return C.cropBounds({x,y,width:Math.round((box.x+box.width)/sampler.width*video.videoWidth)-x,height:Math.round((box.y+box.height)/sampler.height*video.videoHeight)-y},video.videoWidth,video.videoHeight);
 }
 function autoCrop(){const sampler=marginSampler();setCropValues(marginCrop([sampler.read()],sampler));}
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
  const start=automatic?0:C.parseTime($('rangeStart').value),end=automatic?video.duration:C.parseTime($('rangeEnd').value),interval=automatic?D.interval:Number($('sampleInterval').value);
  const threshold=automatic ? D.threshold : Number($('sensitivity').value)/1000,merge=automatic||$('mergeRepeated').checked,refine=automatic||$('refineFrames').checked,splitExercises=automatic||$('splitExercises').checked,excludeEnding=automatic||$('excludeEnding').checked;
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>video.duration+0.1||end<=start){toast('영상 안의 올바른 시작·끝 시각을 입력해 주세요.',true);return;}
  if((end-start)/interval>20000){toast('구간을 나누거나 확인 간격을 늘려 주세요.',true);return;}
  C.cropBounds(crop,video.videoWidth,video.videoHeight);
  if($('extractDialog').open)$('extractDialog').close();busy=true;updateButtons();controller=new AbortController();const signal=controller.signal,priorTime=video.currentTime,priorCrop={...crop};let complete=false;
  try{
   if(automatic){progress('슬라이드 영역을 찾고 있습니다','영상의 여러 지점에서 검은 여백을 확인합니다.');crop=await detectCrop(signal);}
   const detector=new C.SceneDetector(threshold,D.confirmations);
   progress('슬라이드 전환을 찾고 있습니다','영상을 확인하는 중입니다.',.05);
   const stop=Math.max(start,Math.min(video.duration-0.08,end-0.08));
   const times=[];for(let t=start;t<stop;t+=interval)times.push(t);times.push(stop);
   for(let i=0;i<times.length;i++){
    if(signal.aborted)throw new DOMException('취소했습니다.','AbortError');await seek(times[i],signal);detector.push(times[i],analyze());
    if(i%5===0)progress('슬라이드 전환을 찾고 있습니다',`${C.timecode(times[i])} / ${C.timecode(end)} · ${i+1}/${times.length} 화면`,.05+(i+1)/times.length*.65);
   }
   let candidates=detector.finish(end);
   if(merge)candidates=C.groupSegments(candidates,D.mergeTolerance);
   else candidates=candidates.map(s=>({...s,segments:[{start:s.start,end:s.end}]}));
   if(candidates.length>300)throw new Error('후보가 300장을 넘었습니다. 감도 값을 높이거나 구간을 나누어 추출해 주세요.');
   const result=[];
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
   const detectedCrop=crop;crop=priorCrop;remember();crop=detectedCrop;slides.push(...result);selectedId=result[0]?.id||selectedId;complete=true;touch();render();
   $('videoControls').hidden=false;$('toggleVideo').textContent='접기';
   progress('슬라이드 준비 완료','노트 편집과 영상 재생을 시작할 수 있습니다.',1,false);await yieldToBrowser();
   const included=result.filter(s=>s.included).length,excluded=result.length-included,pairs=result.filter(s=>s.kind==='question'&&s.pairId).length;
   status(`${included}개 슬라이드를 자동으로 구성했습니다.${pairs?` 문제·풀이 ${pairs}쌍.`:''}${excluded?` 종료 후보 ${excluded}개는 체크를 해제해 보관했습니다.`:''} 왼쪽에서 선택해 노트를 작성하세요.`);toast(`${included}개 슬라이드 자동 구성${excluded?` · ${excluded}개 자동 제외`:''}`);
  }catch(err){if(err.name==='AbortError'){toast('추출을 취소했습니다. 기존 작업은 유지됩니다.');status('추출을 취소했습니다.');}else fail(err);}
  finally{if(!complete){crop=priorCrop;touch();}controller=null;try{await seek(priorTime);}catch(_){}busy=false;$('progressDialog').close();updateButtons();}
 }
 async function captureNew(replace=false){
  try{const frame=capture();remember();if(replace)Object.assign(selected(),frame);else{const s={...C.blankSlide(),...frame,startTime:frame.time,title:`슬라이드 ${slides.length+1}`,segments:[{start:frame.time,end:frame.time}]};const index=selected()?slides.indexOf(selected())+1:slides.length;slides.splice(index,0,s);selectedId=s.id;}touch();render();toast(replace?'선택한 페이지의 화면을 교체했습니다.':'현재 화면을 추가했습니다.');}catch(err){fail(err);}
 }
 function move(delta){const i=slides.indexOf(selected());if(i<0||i+delta<0||i+delta>=slides.length)return;remember();slides.splice(i+delta,0,slides.splice(i,1)[0]);touch();render();}
 async function exportFile(type){
  if(busy)return;busy=true;updateButtons();progress(`${type.toUpperCase()}를 만들고 있습니다`,'노트의 서식과 이미지를 배치합니다.',null,false);
  await yieldToBrowser();
  try{const result=type==='pdf'?await E.toPdf(snapshot()):await E.toPptx(snapshot());E.download(result.blob,`${E.basename(title)}.${type}`);progress('내보내기 완료',`${result.count}페이지를 저장했습니다.`,1,false);await yieldToBrowser();status(`${result.count}페이지 ${type.toUpperCase()}를 내보냈습니다. 브라우저 다운로드 위치를 확인해 주세요.`);toast(`${type.toUpperCase()} ${result.count}페이지를 저장했습니다.`);}catch(err){fail(err);}finally{busy=false;$('progressDialog').close();updateButtons();}
 }
 async function newLecture(){
  if(slides.length&&!confirm('새 강의를 시작하면 현재 노트가 초기화됩니다. 완성본이 필요하면 PPTX·PDF로 내보내 주세요. 새 강의를 시작할까요?'))return;
  clearTimeout(saveTimer);notesEditor?.destroy();notesEditor=null;editorSlideId=null;rawMode=false;if(videoUrl)URL.revokeObjectURL(videoUrl);videoUrl=null;videoInfo=null;crop=null;slides=[];selectedId=null;history=[];dirty=false;title='새 강의자료';recoverable=null;
  video.removeAttribute('src');video.load();video.style.display='none';$('videoPlaceholder').hidden=false;render();showWelcome();
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
 $('kind').addEventListener('change',e=>{const s=selected();if(!s)return;remember();s.kind=e.target.value;touch();render();});
 $('addSupplement').addEventListener('click',()=>{remember();const s={...C.blankSlide('supplement'),title:'보충 설명'};let index=selected()?slides.indexOf(selected())+1:slides.length;if(selected()?.kind==='question'&&slides[index]?.pairId===selected().pairId)index++;slides.splice(index,0,s);selectedId=s.id;touch();render();if(rawMode)$('markdownSource').focus();else notesEditor.view.focus();});
 $('moveUp').addEventListener('click',()=>move(-1));$('moveDown').addEventListener('click',()=>move(1));
 $('deleteSlide').addEventListener('click',()=>{const index=slides.indexOf(selected());if(index<0)return;remember();slides.splice(index,1);selectedId=slides[Math.min(index,slides.length-1)]?.id||null;touch();render();});
 $('undo').addEventListener('click',()=>{const p=history.pop();if(!p)return;slides=p.slides;selectedId=p.selectedId;title=p.title;videoInfo=p.videoInfo;crop=p.crop;touch();render();});
 $('importNotes').addEventListener('click',()=>$('notesFile').click());$('notesFile').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file||!selected())return;const target=selected().id;if(file.size>2*1024*1024){toast('노트 파일은 2MB 이하로 선택해 주세요.',true);return;}const text=await file.text();if(target!==selected()?.id)return;if(text.length>100000){toast('노트는 100,000자 이하로 나누어 주세요.',true);return;}remember();const markdown=/\.(md|markdown)$/i.test(file.name)?text:N.plainMarkdown(text);selected().notes=markdown;selected().notesFormat='markdown';selected().title=C.noteTitle(N.parse(markdown))||selected().title;touch();renderEditor();});
 video.addEventListener('timeupdate',()=>{if(document.activeElement!==$('seekInput'))$('seekInput').value=C.timecode(video.currentTime,true);});
 const go=async time=>{try{if(!Number.isFinite(time))throw new Error('시각을 01:30 또는 초 단위로 입력해 주세요.');await seek(time);}catch(err){fail(err);}};
 $('seekButton').addEventListener('click',()=>go(C.parseTime($('seekInput').value)));$('seekInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();go(C.parseTime(e.target.value));}});
 $('backSecond').addEventListener('click',()=>go(video.currentTime-1));$('forwardSecond').addEventListener('click',()=>go(video.currentTime+1));
 $('previewTime').addEventListener('click',async()=>{const start=selected()?C.slideStart(selected()):null;if(start===null)return;$('videoControls').hidden=false;$('toggleVideo').textContent='접기';await go(start);$('video').scrollIntoView({behavior:'smooth',block:'nearest'});});
 $('captureNew').addEventListener('click',()=>captureNew());$('replaceFrame').addEventListener('click',()=>captureNew(true));
 $('toggleVideo').addEventListener('click',()=>{const el=$('videoControls');el.hidden=!el.hidden;$('toggleVideo').textContent=el.hidden?'펼치기':'접기';});
 $('cropButton').addEventListener('click',openCrop);$('closeCrop').addEventListener('click',()=>$('cropDialog').close());$('fullCrop').addEventListener('click',()=>setCropValues({x:0,y:0,width:video.videoWidth,height:video.videoHeight}));$('autoCrop').addEventListener('click',autoCrop);
 for(const id of ['cropX','cropY','cropW','cropH'])$(id).addEventListener('input',drawCrop);
 $('applyCrop').addEventListener('click',()=>{try{crop=C.cropBounds(cropValues(),video.videoWidth,video.videoHeight);touch();updateButtons();$('cropDialog').close();toast('슬라이드 영역을 적용했습니다.');}catch(err){fail(err);}});
 function openExtract(){$('rangeStart').value='00:00';$('rangeEnd').value=C.timecode(video.duration,true);$('extractNotice').textContent=slides.length?'추출 결과는 기존 페이지 뒤에 추가됩니다. 기존 노트는 유지됩니다.':'자동으로 슬라이드를 구성합니다.';$('extractDialog').showModal();}
 $('extract').addEventListener('click',()=>slides.length?openExtract():extract({automatic:true}).catch(fail));$('extractSettings').addEventListener('click',openExtract);
 $('closeExtract').addEventListener('click',()=>$('extractDialog').close());$('startExtract').addEventListener('click',()=>extract().catch(fail));
 $('sensitivity').addEventListener('input',e=>$('sensitivityText').textContent=Number(e.target.value)<32?'작은 변화도 구분':Number(e.target.value)>48?'큰 전환만 구분':'이 강의에 맞춘 기본값');
 $('cancelWork').addEventListener('click',()=>controller?.abort());$('progressDialog').addEventListener('cancel',e=>{e.preventDefault();controller?.abort();});
 $('progressDialog').addEventListener('close',()=>{if(!$('progressDialog').open){clearInterval(progressTimer);progressTimer=null;}});
 window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
 render();const recoveryReady=recovery();
})();
