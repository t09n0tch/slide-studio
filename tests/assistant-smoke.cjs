/* Synthetic UI/IPC integration only. This never signs in to a real account,
 * transmits lecture data, or consumes ChatGPT plan usage. */
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright');
const root=path.resolve(__dirname,'..');
const packaged=process.argv.includes('--packaged');
const executable=process.platform==='win32'?path.join(root,'dist','win-unpacked','Slide Studio.exe'):path.join(root,'dist',process.arch==='arm64'?'mac-arm64':'mac','Slide Studio.app','Contents','MacOS','Slide Studio');
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'studio-assistant-ui-'));let application;const errors=[];
 const env={...process.env,SLIDE_STUDIO_USER_DATA:path.join(temp,'profile'),SLIDE_STUDIO_DOWNLOADS:path.join(temp,'downloads')};delete env.ELECTRON_RUN_AS_NODE;
 try{
  await fs.mkdir(env.SLIDE_STUDIO_DOWNLOADS);
  application=await electron.launch({...packaged?{executablePath:executable,args:['--disable-gpu']}:{args:[root,'--disable-gpu']},env,cwd:root});const page=await application.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
  await page.waitForFunction(()=>!!window.StudioAssistant);
  const productionSession=await page.evaluate(()=>window.studioDesktop.session());assert.equal(productionSession.ok,true);assert.equal(productionSession.value.sharing,false);assert.ok(!JSON.stringify(productionSession).includes('accessToken'));
  assert.equal(await page.evaluate(async()=>{const written=await window.studioDesktop.copyText('Slide Studio clipboard fixture');const read=await window.studioDesktop.readText();return written.ok&&read.ok&&read.value==='Slide Studio clipboard fixture';}),true);
  const attachment=await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=4;canvas.getContext('2d').fillRect(0,0,4,4);return window.studioDesktop.copyImage(canvas.toDataURL('image/png'));});assert.equal(attachment.ok,true);
  const realClipboard=await application.evaluate(async({clipboard})=>({types:(await clipboard.read()).flatMap(item=>item.types),text:await clipboard.readText()}));assert.ok(realClipboard.types.includes('image/png'));assert.equal(realClipboard.text,'');assert.ok(!realClipboard.types.includes('text/plain'));assert.equal(await page.evaluate(()=>typeof window.studioDesktop.copyAttachment),'undefined');
  assert.equal((await page.evaluate(()=>window.studioDesktop.copyImage('https://example.test/picture.png'))).ok,false);
  await application.evaluate(({ipcMain,clipboard,ClipboardItem})=>{
   let connected=false;globalThis.assistantCalls=[];globalThis.generateCount=0;globalThis.failAssistantAt=0;
   const session=()=>({status:connected?'connected':'disconnected',sharing:connected,profileId:connected?'fixture-profile':undefined,identity:connected?{email:'test@example.test'}:undefined,profiles:connected?[{id:'fixture-profile',label:'테스트 계정',sharing:true,status:'connected'}]:[]});
   ipcMain.removeHandler('studio:assistant');ipcMain.handle('studio:assistant',async(_event,method,payload)=>{
    globalThis.assistantCalls.push(method);let value;
    if(method==='session')value=session();
    else if(method==='signIn'){connected=true;value=session();}
    else if(method==='models')value=[{slug:'fixture-vision',displayName:'검증용 모델 · 실제 호출 없음'}];
    else if(method==='copyText')await clipboard.writeText(payload);
    else if(method==='copyImage')await clipboard.write([new ClipboardItem({'image/png':new Blob([Buffer.from(payload.split(',')[1],'base64')],{type:'image/png'})})]);
    else if(method==='readText')value=await clipboard.readText();
    else if(method==='generate'){assertConsent(payload);globalThis.generateCount++;if(globalThis.generateCount===globalThis.failAssistantAt)return{ok:false,error:{code:'subscription_sharing_usage_limit_exceeded',message:'ChatGPT 사용량 한도에 도달했습니다. 완료한 노트는 유지됩니다.'}};value={text:JSON.stringify({version:1,requestId:payload.request.id,notes:payload.request.slides.map(s=>({slideId:s.id,title:'자동 학습 노트',markdown:'## 핵심 개념\n\n자동 보완 흐름을 확인한 설명입니다.'})),supplements:[{afterSlideId:payload.request.slides[0].id,title:'자동 개념 보완',markdown:'## 배경 보충\n\n1. 개념을 확인합니다.\n2. 예시와 연결합니다.'}]})};}
    else if(method==='disconnect'){connected=false;value=session();}
    return {ok:true,value};
   });function assertConsent(payload){if(payload.consented!==true)throw new Error('Consent missing');}
  });
  await page.locator('#videoFile').setInputFiles(path.join(__dirname,'fixtures/slides.mp4'));
  await page.locator('#aiChooseFree').click();await page.locator('#aiPrepare').click();
  await page.waitForFunction(()=>document.querySelectorAll('.slide-item').length===3&&!!document.getElementById('aiSheetPreview').getAttribute('src'));
  await page.waitForFunction(()=>document.getElementById('aiPrepare').disabled===false);
  const template=await page.locator('#aiPrompt').inputValue();const data=JSON.parse(template.slice(template.indexOf('{\n  "version": 1')));
  assert.equal((await fs.readdir(env.SLIDE_STUDIO_DOWNLOADS)).length,0,'Preparation must not create download files.');
  const copied=await application.evaluate(async({clipboard})=>({types:(await clipboard.read()).flatMap(item=>item.types),text:await clipboard.readText()}));
  assert.ok(copied.types.includes('text/plain'));assert.ok(!copied.types.includes('image/png'),'Initial preparation must copy only text.');assert.equal(copied.text,template);
  assert.deepEqual(await page.locator('#aiPrepared > .ai-inline button').allTextContents(),['이미지 복사','텍스트 복사']);
  await page.locator('#aiCopyImage').click();await page.waitForFunction(()=>document.getElementById('aiPreparedName').textContent.startsWith('이미지 복사 완료'));
  const imageOnly=await application.evaluate(async({clipboard})=>{const items=await clipboard.read(),image=await items.find(item=>item.types.includes('image/png')).getType('image/png');return{types:items.flatMap(item=>item.types),signature:[...new Uint8Array(await image.arrayBuffer()).slice(0,8)],text:await clipboard.readText()};});
  assert.ok(imageOnly.types.includes('image/png'));assert.ok(!imageOnly.types.includes('text/plain'));assert.equal(imageOnly.text,'');assert.deepEqual(imageOnly.signature,[137,80,78,71,13,10,26,10]);
  await page.locator('#aiCopyPrompt').click();await page.waitForFunction(()=>document.getElementById('aiPreparedName').textContent.startsWith('텍스트 복사 완료'));
  const textOnly=await application.evaluate(async({clipboard})=>({types:(await clipboard.read()).flatMap(item=>item.types),text:await clipboard.readText()}));assert.equal(textOnly.text,template);assert.ok(!textOnly.types.includes('image/png'),'Text copy must not leave an old image in the clipboard.');
  data.notes.forEach(s=>{s.title='무료 계정 학습 노트';s.markdown='## 핵심 개념\n\n**중요한 설명**을 한 번에 반영했습니다.';});data.supplements[0].title='개념 보완';data.supplements[0].markdown='## 배경 보충\n\n- 첫 번째 개념\n- 두 번째 개념';
  data.notes[0].markdown='## 핵심 개념\n\n'+Array.from({length:10},(_,i)=>`${i+1}. **중요한 설명**을 한 번에 반영했습니다. 기본 원리와 반응 조건을 함께 확인합니다. 기본 원리와 반응 조건을 함께 확인합니다.`).join('\n\n');
  await fs.mkdir(path.join(root,'test-results'),{recursive:true});
  await page.screenshot({path:path.join(root,'test-results','assistant-free.png')});
  await page.locator('#aiSkip').click();await page.waitForFunction(()=>document.getElementById('saveStatus').textContent==='자동 저장됨');
  await page.reload();await page.waitForFunction(()=>!!window.StudioAssistant);await page.locator('#videoFile').setInputFiles(path.join(__dirname,'fixtures/slides.mp4'));
  await page.waitForFunction(()=>document.querySelectorAll('.slide-item').length===3&&!document.getElementById('progressDialog').open);await page.locator('#assistantOpen').click();assert.equal(await page.locator('#aiPasteApply').isEnabled(),true);
  const wrong={...data,requestId:'wrong-lecture'};await application.evaluate(({clipboard},text)=>clipboard.writeText(text),JSON.stringify(wrong));await page.locator('#aiPasteApply').click();await page.locator('#aiError').waitFor({state:'visible'});const wrongMessage=await page.locator('#aiError').innerText();assert.ok(wrongMessage.includes('다른 강의'),wrongMessage);assert.equal(await page.locator('.slide-item').count(),3);
  await application.evaluate(({clipboard},text)=>clipboard.writeText(text),'```json\n'+JSON.stringify(data)+'\n```');
  await page.locator('#aiPasteApply').click();await page.waitForFunction(()=>document.querySelectorAll('.slide-item').length===4);assert.ok((await page.locator('#aiBatchSummary').innerText()).includes('3 / 3'));assert.equal(await page.locator('#aiPasteApply').isDisabled(),true);
  await page.locator('#aiSkip').click();assert.ok((await page.locator('#previewBody').innerText()).includes('중요한 설명'));
  await page.waitForFunction(()=>Number(document.getElementById('slidePreview').dataset.noteFont)<22.5&&Number(document.getElementById('slidePreview').dataset.notePages)===1);assert.equal(await page.locator('#autoNoteFont').isChecked(),true);
  const sourceSelected=await page.locator('.slide-item.active').getAttribute('data-id');
  const supplement=page.locator('.slide-item:has(.supplement-thumbnail)').first();await supplement.click();
  await page.waitForFunction(()=>document.querySelector('.slide-item.active .supplement-thumbnail')?.dataset.renderStatus==='ready');
  const thumbnail=await supplement.locator('.supplement-thumbnail').getAttribute('src');assert.ok(thumbnail.startsWith('data:image/png;base64,'));assert.ok((await page.locator('#previewBody').textContent()).includes('첫 번째 개념'));
  const thumbnailInk=await supplement.locator('.supplement-thumbnail').evaluate(async image=>{await image.decode();const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const p=ctx.getImageData(0,0,c.width,c.height).data;let top=0,body=0,footer=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;if(p[i]<180&&p[i+1]<190){if(y<10)top++;else if(y>250)footer++;else body++;}}return{top,body,footer};});assert.ok(thumbnailInk.top>0&&thumbnailInk.body>50&&thumbnailInk.footer>0,'Thumbnail must draw header, body and page footer.');
  await page.locator('#markdownMode').click();await page.locator('#markdownSource').fill('## 편집한 보충 설명\n\n- 제목 카드 대신 실제 구성입니다.\n- 내용과 줄 배치가 썸네일에도 반영됩니다.');await page.waitForFunction(previous=>{const image=document.querySelector('.slide-item.active .supplement-thumbnail');return image?.dataset.renderStatus==='ready'&&image.src!==previous;},thumbnail);
  await page.screenshot({path:path.join(root,'test-results','supplement-thumbnail.png')});await page.locator(`.slide-item[data-id="${sourceSelected}"]`).click();
  await page.locator('#undo').click();assert.equal(await page.locator('.slide-item').count(),3);
  await page.locator('#assistantOpen').click();assert.equal(await page.locator('#aiPasteApply').isEnabled(),true);await page.locator('#aiPasteApply').click();await page.waitForFunction(()=>document.querySelectorAll('.slide-item').length===4);await page.locator('#aiSkip').click();
  const images=(await fs.readdir(env.SLIDE_STUDIO_DOWNLOADS)).filter(n=>n.endsWith('.png'));assert.equal(images.length,0,'Free workflow left an attachment in Downloads.');
  await page.waitForFunction(()=>document.getElementById('saveStatus').textContent==='자동 저장됨');
  await page.locator('#newLecture').click();await page.locator('#videoFile').setInputFiles(path.join(__dirname,'fixtures/slides.mp4'));
  await page.locator('#aiChoosePaid').click();assert.equal(await page.locator('#aiPaidStart').isDisabled(),true);
  await page.locator('#aiSignIn').click();await page.waitForFunction(()=>document.getElementById('aiModel').value==='fixture-vision');
  await page.locator('#aiAcknowledge').click();await page.locator('#aiConsent').check();
  await page.screenshot({path:path.join(root,'test-results','assistant-paid.png')});
  await page.locator('#aiPaidStart').click();
  await page.waitForFunction(()=>!document.getElementById('progressDialog').open&&document.querySelectorAll('.slide-item').length===4);
  assert.equal(await page.locator('#aiDialog').isVisible(),false);assert.ok((await page.locator('#previewBody').innerText()).includes('자동 보완 흐름'));
  await page.locator('#exportPdf').click();await page.locator('#progressDialog').waitFor({state:'hidden',timeout:120000});
  await page.waitForFunction(()=>document.getElementById('saveStatus').textContent==='자동 저장됨');
  // Restore a larger fixture, then simulate a limit after one completed batch.
  await page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('lecture-slide-studio',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const saved=await new Promise(resolve=>{const r=db.transaction('workspace').objectStore('workspace').get('latest');r.onsuccess=()=>resolve(r.result);});const originals=saved.slides.filter(s=>s.image);saved.slides=Array.from({length:7},(_,i)=>({...originals[i%originals.length],id:crypto.randomUUID(),title:`슬라이드 ${i+1}`,notes:'',ai:null}));saved.assistant={mode:'paid',request:null};await new Promise(resolve=>{const t=db.transaction('workspace','readwrite');t.objectStore('workspace').put(saved,'latest');t.oncomplete=resolve;});db.close();});
  await page.reload();await page.waitForFunction(()=>!!window.StudioAssistant);await page.locator('#videoFile').setInputFiles(path.join(__dirname,'fixtures/slides.mp4'));await page.waitForFunction(()=>document.querySelectorAll('.slide-item').length===7&&!document.getElementById('progressDialog').open);
  await application.evaluate(()=>{globalThis.failAssistantAt=globalThis.generateCount+2;});
  await page.locator('#assistantOpen').click();await page.waitForFunction(()=>document.getElementById('aiModel').value==='fixture-vision');await page.locator('#aiConsent').check();await page.locator('#aiPaidStart').click();
  await page.waitForFunction(()=>document.getElementById('aiDialog').open&&document.getElementById('aiError').textContent.includes('한도'));
  assert.equal(await page.locator('.slide-item').count(),8);assert.ok((await page.locator('#aiPaidSummary').innerText()).includes('4 / 7'));
  await page.locator('#aiSwitchFree').click();await page.locator('#aiPrepare').click();await page.waitForFunction(()=>!document.getElementById('aiPrepare').disabled);
  const remainingPrompt=await page.locator('#aiPrompt').inputValue(),remaining=JSON.parse(remainingPrompt.slice(remainingPrompt.indexOf('{\n  "version": 1')));assert.equal(remaining.notes.length,3);
  remaining.notes.forEach(s=>{s.title='남은 장 학습 노트';s.markdown='무료 방식으로 이어서 완성했습니다.';});remaining.supplements=[];
  await application.evaluate(({clipboard},text)=>clipboard.writeText(text),JSON.stringify(remaining));await page.locator('#aiPasteApply').click();await page.waitForFunction(()=>document.getElementById('aiBatchSummary').textContent.includes('7 / 7'));await page.locator('#aiSkip').click();
  const calls=await application.evaluate(()=>globalThis.assistantCalls);assert.ok(calls.includes('generate'));assert.ok(calls.includes('openChatGPT'));assert.deepEqual(errors,[]);
  await page.waitForFunction(()=>document.getElementById('saveStatus').textContent==='자동 저장됨');
  await application.close();application=null;
  console.log('PASS assistant UI: separate native image/text clipboard, text-only initial preparation, image-only PNG copy, text recopy clearing the image, two copy buttons, invalid image rejection, zero attachment downloads, free preparation/import, automatic note fitting, pending restart recovery, wrong lecture rejection, atomic notes/supplements, undo, paid login/model/consent, extraction-to-generation, limit after a completed batch, free fallback for remaining slides, PDF. Backend responses are synthetic.');
 }finally{if(application){await application.evaluate(({app})=>app.exit(0)).catch(()=>{});await application.close().catch(()=>{});}await fs.rm(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
