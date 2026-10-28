/* Actual renderer/video recapture, crop magnets and compact dock regressions. */
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright');
const root=path.resolve(__dirname,'..'),packaged=process.argv.includes('--packaged');
const executable=process.platform==='win32'?path.join(root,'dist','win-unpacked','Slide Studio.exe'):path.join(root,'dist',process.arch==='arm64'?'mac-arm64':'mac','Slide Studio.app','Contents','MacOS','Slide Studio');
async function saved(page){await page.waitForFunction(()=>document.getElementById('saveStatus').textContent==='자동 저장됨');return page.evaluate(async()=>{
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('lecture-slide-studio',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 try{return await new Promise((resolve,reject)=>{const r=db.transaction('workspace').objectStore('workspace').get('latest');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}
});}
const nonImage=s=>Object.fromEntries(Object.entries(s).filter(([key])=>!['image','width','height'].includes(key)));
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'studio-regions-')),env={...process.env,SLIDE_STUDIO_USER_DATA:path.join(temp,'profile'),SLIDE_STUDIO_DOWNLOADS:path.join(temp,'downloads')};delete env.ELECTRON_RUN_AS_NODE;
 let app,page;try{
  await fs.mkdir(env.SLIDE_STUDIO_DOWNLOADS);await fs.mkdir(path.join(root,'test-results'),{recursive:true});
  app=await electron.launch({...packaged?{executablePath:executable,args:['--disable-gpu']}:{args:[root,'--disable-gpu']},env,cwd:root,timeout:60000});page=await app.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('#videoFile').setInputFiles(path.join(__dirname,'fixtures','letterbox.mp4'));await page.locator('#aiSkip').click();
  await page.waitForFunction(()=>!document.getElementById('progressDialog').open&&document.querySelectorAll('.slide-item').length===3);
  await page.locator('#markdownMode').click();await page.locator('#markdownSource').fill('## 보관할 노트\n\n영역을 바꿔도 이 내용과 캡처 시각을 유지합니다.');await page.locator('#showNotes').uncheck();
  assert.equal(await page.locator('#sourceTime').innerText(),'00:00');assert.equal(await page.locator('#sourcePage').innerText(),'01');assert.equal(await page.locator('#sourceFooter').isVisible(),true);assert.equal(await page.locator('#previewNotes').isVisible(),false);
  const geometry=await page.evaluate(()=>{const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height};};return{dock:rect('.video-panel'),inspector:rect('.inspector'),canvas:rect('.canvas-column'),video:rect('#video'),stage:rect('.video-stage'),add:rect('#captureNew'),crop:rect('#cropButton'),footer:rect('#sourceFooter'),source:rect('#previewSource'),page:rect('#slidePreview')};});
  assert.ok(geometry.dock.x>=geometry.inspector.x);assert.ok(Math.abs(geometry.dock.bottom-geometry.inspector.bottom)<2);assert.ok(geometry.dock.w<410);assert.ok(Math.abs(geometry.video.w/geometry.video.h-16/9)<.01);assert.ok(Math.abs(geometry.stage.h-geometry.video.h)<1);assert.ok(Math.abs(geometry.add.y-geometry.crop.y)<1);assert.ok(geometry.source.bottom<=geometry.footer.y+1);assert.ok(geometry.footer.bottom<geometry.page.bottom);
  const dockY=geometry.dock.y;await page.locator('.inspector-body').evaluate(el=>el.scrollTop=el.scrollHeight);assert.equal((await page.locator('.video-panel').boundingBox()).y,dockY);await page.locator('.inspector-body').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:path.join(root,'test-results','compact-video-footer.png')});
  console.log('PASS: notes-hidden footer, unobscured image, compact bottom-right video, independent note scrolling, capture/crop buttons share a row.');

  // Keep duplicate/excluded pages and a text supplement in the same bulk action.
  await page.locator('#duplicateSlide').click();await page.locator('.slide-item.active input').uncheck();await page.locator('#addSupplement').click();
  await page.locator('#markdownSource').fill('보충 설명은 이미지 없이 유지합니다.');
  let before=await saved(page);const open=async()=>{await page.locator('#cropButton').click();await page.locator('#cropDialog').waitFor({state:'visible'});};
  const draft=async box=>{await page.locator('.crop-advanced').evaluate(el=>el.open=true);for(const [id,value]of Object.entries({cropX:box.x,cropY:box.y,cropW:box.width,cropH:box.height}))await page.locator('#'+id).fill(String(value));};
  const apply=async()=>{await page.locator('#applyCrop').click();await page.locator('#progressDialog').waitFor({state:'hidden'});return saved(page);};
  await open();assert.equal(await page.locator('#applyCropAll').isChecked(),true);assert.match(await page.locator('#applyCropAllLabel').innerText(),/4장/);
  await draft({x:170,y:40,width:600,height:430});let after=await apply();
  assert.deepEqual(after.slides.map(nonImage),before.slides.map(nonImage));assert.deepEqual(after.slides.map(s=>s.id),before.slides.map(s=>s.id));
  assert.ok(after.slides.filter(s=>s.image).every(s=>s.width===600&&s.height===430));assert.deepEqual(after.slides.find(s=>!s.image),before.slides.find(s=>!s.image));
  assert.ok(after.slides.filter(s=>s.image).every(s=>s.image!==before.slides.find(b=>b.id===s.id).image));
  await page.locator('#undo').click();assert.deepEqual((await saved(page)).slides,before.slides);await page.locator('#redo').click();assert.deepEqual((await saved(page)).slides,after.slides);
  await open();await page.locator('#fullCrop').click();const expanded=await apply();assert.ok(expanded.slides.filter(s=>s.image).every(s=>s.width===960&&s.height===540),'Expanding must reread the video rather than enlarge an old cropped bitmap.');
  await page.locator('#undo').click();assert.deepEqual((await saved(page)).slides,after.slides);
  console.log('PASS: bulk recapture includes duplicates and excluded screens, preserves notes/times/order/supplements, one-step undo/redo, expands from original video.');

  before=await saved(page);await open();await draft({x:140,y:20,width:680,height:500});
  await page.evaluate(()=>{const detail=document.getElementById('progressDetail');const observer=new MutationObserver(()=>{if(/^1 \/ 4장/.test(detail.textContent)){document.getElementById('cancelWork').click();observer.disconnect();}});observer.observe(detail,{childList:true});});
  const canceled=await apply();assert.deepEqual(canceled.slides,before.slides);assert.deepEqual(canceled.crop,before.crop);
  await open();await draft({x:140,y:20,width:680,height:500});
  await page.evaluate(()=>{window.originalToDataURL=HTMLCanvasElement.prototype.toDataURL;let frames=0;HTMLCanvasElement.prototype.toDataURL=function(...args){if(++frames===2)throw new Error('Synthetic recapture failure');return window.originalToDataURL.apply(this,args);};});
  const failed=await apply();await page.evaluate(()=>HTMLCanvasElement.prototype.toDataURL=window.originalToDataURL);assert.deepEqual(failed.slides,before.slides);assert.deepEqual(failed.crop,before.crop);
  // A text supplement cannot be cropped; disabling "all" must explain this.
  await open();await page.locator('#applyCropAll').uncheck();assert.equal(await page.locator('#applyCrop').isDisabled(),true);await page.locator('#closeCrop').click();
  const chosen=before.slides.find(s=>s.image).id;await page.locator(`.slide-item[data-id="${chosen}"]`).click();
  await open();await draft({x:140,y:20,width:680,height:500});await page.locator('#applyCropAll').uncheck();assert.equal(await page.locator('#applyCrop').innerText(),'현재 슬라이드에 적용');await page.screenshot({path:path.join(root,'test-results','crop-current-slide.png')});const onlyCurrent=await apply();
  assert.deepEqual(onlyCurrent.slides.map(nonImage),before.slides.map(nonImage));assert.deepEqual(onlyCurrent.slides.filter(s=>s.id!==chosen),before.slides.filter(s=>s.id!==chosen));const changed=onlyCurrent.slides.find(s=>s.id===chosen);assert.equal(changed.width,680);assert.equal(changed.height,500);assert.notEqual(changed.image,before.slides.find(s=>s.id===chosen).image);
  await page.locator('#undo').click();assert.deepEqual((await saved(page)).slides,before.slides);assert.deepEqual((await saved(page)).crop,before.crop);await page.locator('#redo').click();assert.deepEqual((await saved(page)).slides,onlyCurrent.slides);await page.locator('#undo').click();
  console.log('PASS: cancellation and decode failure are atomic; unchecked all applies only to the selected original, preserves other pages, supports undo/redo and rejects image-free supplements.');


  await open();await page.locator('#fullCrop').click();const canvas=await page.locator('#cropPreview').boundingBox();
  const drag=async(from,to)=>{await page.mouse.move(canvas.x+canvas.width*from.x,canvas.y+canvas.height*from.y);await page.mouse.down();await page.mouse.move(canvas.x+canvas.width*to.x,canvas.y+canvas.height*to.y,{steps:12});await page.mouse.up();};
  // Fixture content starts exactly at x=120, with 120px black margins.
  await drag({x:.002,y:.5},{x:126/960,y:.5});assert.equal(await page.locator('#cropX').inputValue(),'120');assert.match(await page.locator('#cropSnapStatus').innerText(),/검은 여백 경계에 맞춤/);assert.equal(await page.locator('#cropPreview').getAttribute('data-snap-axes'),'x');
  await page.screenshot({path:path.join(root,'test-results','crop-snap.png')});
  await page.locator('#fullCrop').click();await page.keyboard.down('Alt');await drag({x:.002,y:.5},{x:126/960,y:.5});await page.keyboard.up('Alt');assert.ok(Math.abs(Number(await page.locator('#cropX').inputValue())-126)<=2);assert.equal(await page.locator('#cropPreview').getAttribute('data-snap-axes'),'');
  await page.locator('#fullCrop').click();await page.locator('#cropSnap').uncheck();await drag({x:.002,y:.5},{x:126/960,y:.5});assert.ok(Math.abs(Number(await page.locator('#cropX').inputValue())-126)<=2);
  await page.locator('#closeCrop').click();assert.deepEqual((await saved(page)).crop,before.crop);assert.deepEqual(errors,[]);
  await page.reload();await page.locator('#videoFile').setInputFiles(path.join(__dirname,'fixtures','letterbox.mp4'));await page.waitForFunction(()=>!document.getElementById('progressDialog').open&&document.querySelectorAll('.slide-item').length===5);assert.deepEqual((await saved(page)).slides,before.slides);
  console.log(`PASS: real pointer snapping, blue guide/status, Alt bypass, checkbox bypass and restart recovery (${packaged?'packaged':'development'}).`);
 }catch(err){if(page){await page.screenshot({path:path.join(root,'test-results','regions-failure.png')}).catch(()=>{});console.error(await page.locator('#toast').innerText().catch(()=>''));}throw err;}
 finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}await fs.rm(temp,{recursive:true,force:true});}
})().catch(err=>{console.error(err);process.exitCode=1;});
