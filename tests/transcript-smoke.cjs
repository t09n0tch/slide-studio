/* Real MP3/OS clipboard + Clova-text round trip. No Clova login/upload or model inference. */
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright');
const {harness}=require('./service-fixture.cjs');
const A=require('../js/ai.js');
const root=path.resolve(__dirname,'..'),packaged=process.argv.includes('--packaged');
const executable=process.platform==='win32'?path.join(root,'dist','win-unpacked','Slide Studio.exe'):path.join(root,'dist',process.arch==='arm64'?'mac-arm64':'mac','Slide Studio.app','Contents','MacOS','Slide Studio');
const script='참석자 1 00:00 First concept: explain the reason, not only the result.  참석자 1 00:02 Second concept: compare the two conditions.  참석자 2 00:04 A question about the final example.';
async function saved(page){await page.waitForFunction(()=>document.getElementById('saveStatus').textContent==='자동 저장됨');return page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('lecture-slide-studio',1);r.onsuccess=()=>resolve(r.result);});try{return await new Promise(resolve=>{const r=db.transaction('workspace').objectStore('workspace').get('latest');r.onsuccess=()=>resolve(r.result);});}finally{db.close();}});}
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'studio-transcript-ui-')),profile=path.join(temp,'profile'),downloads=path.join(temp,'downloads'),gateway=await harness();let application,page;
 const env={...process.env,SLIDE_STUDIO_USER_DATA:profile,SLIDE_STUDIO_DOWNLOADS:downloads};delete env.ELECTRON_RUN_AS_NODE;
 try{
  await fs.mkdir(downloads);await fs.mkdir(path.join(root,'test-results'),{recursive:true});
  application=await electron.launch({...packaged?{executablePath:executable,args:['--disable-gpu']}:{args:[root,'--disable-gpu']},env,cwd:root,timeout:60000});page=await application.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await application.evaluate(({shell})=>{globalThis.openedURLs=[];shell.openExternal=async url=>{globalThis.openedURLs.push(url);};});
  const video=path.join(__dirname,'fixtures/lecture-audio.mp4');await page.locator('#videoFile').setInputFiles(video);await page.locator('#aiTranscriptOpen').click();
  await page.locator('#speechDialog').waitFor({state:'visible'});assert.ok((await page.locator('#speechDialog').evaluate(el=>getComputedStyle(el).width)).endsWith('px'));
  await page.locator('#speechPrepare').click();await page.waitForFunction(()=>document.getElementById('speechDialog').open&&!document.getElementById('speechPrepare').disabled&&document.querySelectorAll('.speech-file').length===1,{}, {timeout:60000});
  const audioFolder=path.join(profile,'audio-temporary'),mp3s=(await fs.readdir(audioFolder)).filter(n=>n.endsWith('.mp3'));assert.equal(mp3s.length,1);assert.equal((await fs.readdir(downloads)).length,0);
  assert.ok((await page.locator('#speechHint').innerText()).includes('복사했습니다'));
  await page.screenshot({path:path.join(root,'test-results','clova-mp3-ready.png')});
  // Verify that paste exposes an actual file, not the file's path as text.
  await page.evaluate(()=>{const probe=document.createElement('textarea');probe.id='speechClipboardProbe';document.getElementById('speechDialog').append(probe);document.addEventListener('paste',event=>{event.preventDefault();window.pastedAudio=[...event.clipboardData.files].map(file=>({name:file.name,type:file.type,size:file.size}));},{once:true});probe.focus();});
  await page.keyboard.press('ControlOrMeta+v');await page.waitForFunction(()=>Array.isArray(window.pastedAudio));const pasted=await page.evaluate(()=>window.pastedAudio);assert.equal(pasted.length,1);assert.ok(pasted[0].name.endsWith('.mp3'));assert.ok(pasted[0].size>10000);await page.locator('#speechClipboardProbe').evaluate(el=>el.remove());
  await page.locator('#speechOpenClova').click();assert.deepEqual(await application.evaluate(()=>globalThis.openedURLs),['https://clovanote.naver.com/']);
  await application.evaluate(({clipboard},text)=>clipboard.writeText(text),script);await page.locator('#speechPaste').click();await page.waitForFunction(()=>document.getElementById('speechSummary').textContent.includes('3개 음성 문단'));
  assert.equal((await fs.readdir(audioFolder)).filter(n=>n.endsWith('.mp3')).length,0);assert.equal((await fs.readdir(downloads)).length,0);assert.equal((await saved(page)).transcript.cues.length,3);
  await page.screenshot({path:path.join(root,'test-results','clova-transcript-import.png')});
  await page.locator('#speechClose').click();await page.locator('#aiDialog').waitFor({state:'visible'});
  // Even an import made before first extraction must survive app reload.
  await page.reload();await page.waitForFunction(()=>!!window.StudioTranscriptUI);await page.locator('#videoFile').setInputFiles(video);await page.locator('#aiSkip').click();
  await page.waitForFunction(()=>document.querySelectorAll('.slide-item').length===3&&!document.getElementById('extract').disabled,{}, {timeout:60000});
  await page.locator('#markdownMode').click();await page.locator('#markdownSource').fill('# 직접 쓴 노트\n\n이 내용은 유지합니다.');
  await page.locator('#assistantOpen').click();await page.locator('#aiInvite').fill(gateway.code);await page.locator('#aiConnect').click();await page.waitForFunction(()=>document.getElementById('aiAccountStatus').textContent.includes('AI 연결됨'));await page.locator('#aiStart').click();
  await page.waitForFunction(()=>!document.getElementById('progressDialog').open&&document.getElementById('aiBatchSummary').textContent.includes('3장 보완 완료'));
  assert.equal(gateway.calls.length,1);const prompt=A.prompt(gateway.calls[0].request);assert.ok(prompt.includes('lecturerTranscript')&&prompt.includes('First concept')&&prompt.includes('videoIntervals'));assert.ok(!prompt.includes('교수님의 음성은 제공되지 않았으므로'));
  const completed=await saved(page);assert.ok(completed.slides[0].notes.includes('직접 쓴 노트')&&completed.slides[0].notes.includes('자동 학습 노트'));assert.ok(completed.slides[0].ai.speechFingerprint);
  await page.locator('#undo').click();const beforeEdit=await saved(page);assert.ok(!beforeEdit.slides[0].notes.includes('자동 학습 노트'));
  await page.locator('#transcriptOpen').click();await application.evaluate(({clipboard})=>clipboard.writeText('No timestamps here'));await page.locator('#speechPaste').click();await page.locator('#speechError').waitFor({state:'visible'});assert.deepEqual((await saved(page)).transcript,beforeEdit.transcript);
  const correction=script.replace('First concept','Corrected first concept');await application.evaluate(({clipboard},text)=>clipboard.writeText(text),correction);await page.locator('#speechPaste').click();await page.waitForFunction(()=>document.getElementById('speechError').hidden);assert.ok((await saved(page)).transcript.cues[0].text.includes('Corrected'));
  await page.locator('#speechClose').click();await page.locator('#undo').click();assert.deepEqual((await saved(page)).transcript,beforeEdit.transcript);await page.locator('#redo').click();assert.ok((await saved(page)).transcript.cues[0].text.includes('Corrected'));
  await page.locator('#transcriptOpen').click();await page.locator('#speechClear').click();assert.equal((await saved(page)).transcript,null);await page.locator('#speechClose').click();await page.locator('#undo').click();assert.ok((await saved(page)).transcript.cues[0].text.includes('Corrected'));
  await page.locator('#transcriptOpen').click();await page.locator('#speechPrepare').click();await page.waitForFunction(()=>document.getElementById('speechDialog').open&&!document.getElementById('speechPrepare').disabled&&document.querySelectorAll('.speech-file').length===1);await page.locator('#speechClose').click();await saved(page);
  assert.deepEqual(errors,[]);await application.close();application=null;await assert.rejects(fs.access(audioFolder));
  console.log(`PASS ${packaged?'packaged':'development'} Clova workflow: real timed MP3, native file paste, no Downloads files, trusted browser link, flattened script paste, pre-extraction persistence, aligned shared API payload, preserved manual notes, correction/clear undo-redo, atomic invalid import and app-exit cleanup. No external upload or model usage.`);
 }catch(error){if(page){await page.screenshot({path:path.join(root,'test-results','transcript-failure.png')}).catch(()=>{});console.error(await page.locator('#speechError').innerText().catch(()=>''));}throw error;
 }finally{if(application){await application.evaluate(({app})=>app.exit(0)).catch(()=>{});await application.close().catch(()=>{});}await gateway.close();await fs.rm(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
