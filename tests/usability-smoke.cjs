/* Grouped interaction checks in the actual app, with synthetic lecture content. */
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),vm=require('node:vm');
const {_electron:electron}=require('playwright');
const JSZip=require('../vendor/jszip.min.js'),PDFLib=require('../vendor/pdf-lib.min.js');
const root=path.resolve(__dirname,'..'),packaged=process.argv.includes('--packaged');
const executable=process.platform==='win32'?path.join(root,'dist','win-unpacked','Slide Studio.exe'):path.join(root,'dist',process.arch==='arm64'?'mac-arm64':'mac','Slide Studio.app','Contents','MacOS','Slide Studio');
async function saved(page){await page.waitForFunction(()=>document.getElementById('saveStatus').textContent==='자동 저장됨');return page.evaluate(async()=>{
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('lecture-slide-studio',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 try{return await new Promise((resolve,reject)=>{const r=db.transaction('workspace').objectStore('workspace').get('latest');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}
});}
async function fileBytes(file){for(let i=0;i<1200;i++){try{const bytes=await fs.readFile(file);if(bytes.length>10000)return bytes;}catch(_){}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('No export: '+file);}
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'studio-usability-')),downloads=path.join(temp,'downloads');let application,page;
 const env={...process.env,SLIDE_STUDIO_USER_DATA:path.join(temp,'profile'),SLIDE_STUDIO_DOWNLOADS:downloads};delete env.ELECTRON_RUN_AS_NODE;
 try{
  await fs.mkdir(downloads);await fs.mkdir(path.join(root,'test-results'),{recursive:true});
  application=await electron.launch({...packaged?{executablePath:executable,args:['--disable-gpu']}:{args:[root,'--disable-gpu']},env,cwd:root,timeout:60000});page=await application.firstWindow();
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  await application.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.setMinimumSize(0,0);window.setContentSize(1024,654);});
  await page.locator('#videoFile').setInputFiles(path.join(__dirname,'fixtures','slides.mp4'));await page.locator('#aiSkip').click();
  await page.waitForFunction(()=>!document.getElementById('progressDialog').open&&document.querySelectorAll('.slide-item').length===3);
  const ids=()=>page.locator('.slide-item').evaluateAll(rows=>rows.map(row=>row.dataset.id));
  const initial=await ids(),choose=id=>page.locator(`.slide-item[data-id="${id}"]`).click();
  assert.equal(await page.locator('#videoMeta').count(),0);
  assert.deepEqual(await page.evaluate(()=>['duplicateSlide','moveUp','moveDown','deleteSlide','undo','redo'].map(id=>!!document.getElementById(id).closest('.library-controls'))),[true,true,true,true,true,true]);
  assert.equal(await page.locator('#lectureTitle').evaluate(el=>getComputedStyle(el).borderTopStyle),'solid');
  assert.match(await page.locator('#previewTime').innerText(),/^\d{2,}:\d{2}$/);
  for(let i=0;i<9;i++)await page.locator('#duplicateSlide').click();
  assert.equal(await page.locator('.slide-item').count(),12);
  const scroll=await page.locator('#slideList').evaluate(el=>{el.scrollTop=el.scrollHeight;window.stableRow=el.firstElementChild;return el.scrollTop;});assert.ok(scroll>300);
  assert.equal(await page.locator('#slideList').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'Thumbnails create a horizontal scrollbar.');
  for(const id of [initial[2],initial[1],initial[2]]){
   // Click the visible portion without locator.click scrolling a clipped row
   // into view first. That automation scroll is unrelated to app selection.
   const row=await page.locator(`.slide-item[data-id="${id}"]`).boundingBox(),list=await page.locator('#slideList').boundingBox();
   const top=Math.max(row.y,list.y),bottom=Math.min(row.y+row.height,list.y+list.height);assert.ok(bottom-top>12,'The selected row must have a clickable visible portion.');
   await page.mouse.click(row.x+70,(top+bottom)/2);
   assert.equal(await page.locator('.slide-item.active').getAttribute('data-id'),id);
   assert.ok(Math.abs(await page.locator('#slideList').evaluate(el=>el.scrollTop)-scroll)<1,'Selecting a lower page moved the library scroll position.');
   assert.equal(await page.evaluate(()=>window.stableRow.isConnected),true,'Selecting a page rebuilt the thumbnail list.');
   const time=await page.locator(`.slide-item[data-id="${id}"] .item-meta span`).last().innerText();
   assert.match(time,/^\d{2,}:\d{2}$/);assert.equal(await page.locator('#previewTime').innerText(),time);
   await page.waitForFunction(expected=>!document.getElementById('video').seeking&&Math.abs(document.getElementById('video').currentTime-expected)<.11,id===initial[2]?4:2);
  }
  // Put the insertion target clear of the autoscroll edge. Native macOS may
  // constrain requested window heights to its display, so use actual geometry.
  // Edge autoscroll itself is covered by editing-smoke.cjs.
  await choose(initial[1]);assert.equal(await page.locator('.slide-item.active').getAttribute('data-id'),initial[1]);
  await page.locator('#slideList').evaluate((list,id)=>{const row=list.querySelector(`[data-id="${id}"]`);list.scrollTop+=row.getBoundingClientRect().top-list.getBoundingClientRect().top-44;},initial[1]);
  const beforeDrag=await ids(),source=await page.locator(`.slide-item[data-id="${initial[2]}"]`).boundingBox(),target=await page.locator(`.slide-item[data-id="${initial[1]}"]`).boundingBox();
  await page.mouse.move(source.x+45,source.y+10);await page.mouse.down();await page.mouse.move(source.x+60,source.y+10,{steps:8});
  await page.locator(`.slide-item.dragging[data-id="${initial[2]}"]`).waitFor();
  await page.mouse.move(target.x+50,target.y+target.height*.75,{steps:12});assert.equal(await page.locator('#dropIndicator').isVisible(),false,'A no-op drop should not show a valid insertion bar.');
  await page.mouse.move(target.x+50,target.y+18,{steps:8});await page.locator('#dropIndicator').waitFor({state:'visible'});
  const indicator=await page.locator('#dropIndicator').boundingBox();assert.ok(Math.abs(indicator.y-target.y)<16);
  await page.screenshot({path:path.join(root,'test-results','drop-insertion.png')});
  assert.equal(await page.locator('#dragStatus').innerText(),'11번째 위치에 놓기');
  await page.mouse.move(target.x+51,target.y+18);await page.mouse.up();
  const reordered=[...beforeDrag.slice(0,-2),initial[2],initial[1]];assert.deepEqual(await ids(),reordered);assert.equal(await page.locator('.slide-item.active').getAttribute('data-id'),initial[2]);await page.locator('#undo').click();assert.deepEqual(await ids(),beforeDrag);assert.equal(await page.locator('.slide-item.active').getAttribute('data-id'),initial[1]);await page.locator('#redo').click();assert.equal(await page.locator('.slide-item.active').getAttribute('data-id'),initial[2]);await page.locator('#undo').click();
  const cancelSource=await page.locator(`.slide-item[data-id="${initial[2]}"]`).boundingBox(),canvas=await page.locator('#slidePreview').boundingBox();
  await page.mouse.move(cancelSource.x+45,cancelSource.y+18);await page.mouse.down();await page.mouse.move(cancelSource.x+65,cancelSource.y+35,{steps:6});await page.mouse.move(canvas.x+canvas.width/2,canvas.y+30,{steps:12});
  assert.equal(await page.locator('#dropIndicator').isVisible(),false);await page.mouse.up();assert.deepEqual(await ids(),beforeDrag);
  console.log('PASS group 1: visible drop positions and no-op/cancel states, undo, fixed thumbnail scrolling, library controls.');

  await page.locator('#cropButton').click();await page.locator('#fullCrop').click();
  const red=await page.locator('#cropPreview').evaluate(c=>{const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<p.length;i+=4)if(p[i]>230&&p[i+1]<80&&p[i+2]<100)n++;return n;});assert.ok(red>100,'Crop selection has no red border.');
  const box=await page.locator('#cropPreview').boundingBox();
  await page.mouse.move(box.x+2,box.y+2);await page.mouse.down();await page.mouse.move(box.x+box.width*.14,box.y+box.height*.12,{steps:12});await page.mouse.up();
  const cropValues=()=>page.evaluate(()=>Object.fromEntries(['cropX','cropY','cropW','cropH'].map(id=>[id,Number(document.getElementById(id).value)])));
  const resized=await cropValues();assert.ok(resized.cropX>70&&resized.cropY>30);assert.ok(resized.cropW<900&&resized.cropH<530);
  await page.mouse.move(box.x+box.width*.6,box.y+box.height*.6);await page.mouse.down();await page.mouse.move(box.x+box.width*.53,box.y+box.height*.54,{steps:10});await page.mouse.up();
  const moved=await cropValues();assert.ok(moved.cropX<resized.cropX&&moved.cropY<resized.cropY);assert.equal(moved.cropW,resized.cropW);assert.equal(moved.cropH,resized.cropH);
  await page.mouse.move(box.x+box.width*.02,box.y+box.height*.02);await page.mouse.down();await page.mouse.move(box.x+box.width*.3,box.y+box.height*.3,{steps:10});await page.mouse.up();
  const drawn=await cropValues();assert.ok(drawn.cropX<30&&drawn.cropY<20&&drawn.cropW<400);await page.screenshot({path:path.join(root,'test-results','crop-drag.png')});
  await page.locator('#applyCrop').click();await page.locator('#progressDialog').waitFor({state:'hidden'});const cropped=await saved(page);assert.deepEqual(cropped.crop,{x:drawn.cropX,y:drawn.cropY,width:drawn.cropW,height:drawn.cropH});
  await page.locator('#undo').click();await page.locator('#redo').click();assert.deepEqual((await saved(page)).crop,cropped.crop);
  console.log('PASS group 2: red crop outline and handles, pointer resize/move/new selection, apply, undo and persistence.');

  await choose(initial[1]);
  if(await page.locator('#videoControls').isVisible())await page.locator('#toggleVideo').click();
  await page.locator('#markdownMode').click();
  const note='## 자동 맞춤 확인\n\n'+Array.from({length:10},(_,i)=>`${i+1}. 핵심 개념과 교수님 필기를 함께 복습합니다. 반응 조건과 예시를 확인하면서 이유를 설명합니다. 기본 원리를 다시 정리합니다.`).join('\n\n')+'\n\nEND_OF_NOTE';
  await page.locator('#markdownSource').fill(note);await page.waitForFunction(()=>document.getElementById('previewBody').classList.contains('planned')&&Number(document.getElementById('slidePreview').dataset.noteFont)<22.5&&Number(document.getElementById('slidePreview').dataset.notePages)===1);
  const autoSize=Number(await page.locator('#noteFontSize').inputValue());assert.equal(await page.locator('#autoNoteFont').isChecked(),true);assert.ok((await page.locator('#previewBody').textContent()).includes('END_OF_NOTE'));
  const unclipped=await page.evaluate(()=>{const p=document.getElementById('previewNotes').getBoundingClientRect();return [...document.querySelectorAll('#previewBody .preview-line')].every(line=>{const r=line.getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom-10&&r.left>=p.left&&r.right<=p.right+1;});});assert.equal(unclipped,true,'Automatic note fitting clips text in the preview.');
  await page.locator('#noteFontSize').fill('28');await page.locator('#noteFontSize').press('Tab');await page.waitForFunction(()=>document.getElementById('slidePreview').dataset.noteFont==='28'&&Number(document.getElementById('slidePreview').dataset.notePages)>1);
  assert.equal(await page.locator('#autoNoteFont').isChecked(),false);await page.locator('#autoNoteFont').check();await page.waitForFunction(size=>Number(document.getElementById('slidePreview').dataset.noteFont)===size,autoSize);
  const state=await saved(page);await page.evaluate(()=>{document.querySelector('.canvas-column').scrollTop=0;document.querySelector('.inspector').scrollTop=0;});await page.locator('#toast').waitFor({state:'hidden',timeout:10000});await page.screenshot({path:path.join(root,'test-results','notes-auto-fit.png')});
  const plan=await page.evaluate(async state=>{const result=await window.StudioExport.prepare(state),pdf=await window.StudioExport.toPdf(state),pptx=await window.StudioExport.toPptx(state);window.StudioExport.download(pdf.blob,'자동맞춤 검증.pdf');window.StudioExport.download(pptx.blob,'자동맞춤 검증.pptx');return{font:result.pages[0].fontSize,count:result.pages.length};},{...state,slides:state.slides.filter(s=>s.id===initial[1])});
  assert.equal(plan.font,autoSize);assert.equal(plan.count,1);
  const pdfBytes=await fileBytes(path.join(downloads,'자동맞춤 검증.pdf')),pptxBytes=await fileBytes(path.join(downloads,'자동맞춤 검증.pptx'));
  const pdf=await PDFLib.PDFDocument.load(pdfBytes);assert.equal(pdf.getPageCount(),1);const ops=Buffer.concat(pdf.getPage(0).node.Contents().asArray().map(ref=>Buffer.from(PDFLib.decodePDFRawStream(pdf.context.lookup(ref)).decode()))).toString();assert.ok(ops.includes(` ${autoSize} Tf`));
  const fontScope={window:{}};vm.runInNewContext(await fs.readFile(path.join(root,'vendor','font-data.js'),'utf8'),fontScope);const font=require('../vendor/fontkit.umd.js').create(Buffer.from(fontScope.window.STUDIO_FONT_BASE64,'base64'));
  const timestampGlyphs=Array.from('00:02').map(ch=>font.glyphForCodePoint(ch.codePointAt(0)).id.toString(16).padStart(4,'0')).join('').toUpperCase();assert.ok(ops.includes(`<${timestampGlyphs}> Tj`),'Timestamp must use cmap glyphs with explicit PDF widths; contextual colon substitution changes the spacing.');
  const zip=await JSZip.loadAsync(pptxBytes),xml=await zip.file('ppt/slides/slide1.xml').async('string');assert.ok(xml.includes(`sz="${Math.round(autoSize*100)}"`));assert.ok(xml.includes('<a:t>00:02</a:t>')&&!/<a:t>(?:강의 )?시작/.test(xml));assert.ok(!xml.includes('00:02.0'));
  await fs.writeFile(path.join(root,'test-results','notes-auto-fit.pdf'),pdfBytes);await fs.writeFile(path.join(root,'test-results','notes-auto-fit.pptx'),pptxBytes);
  console.log('PASS group 3/4: automatic and manual note fonts, complete preview, matching PDF/PPTX font size, compact note header, title field, mm:ss and video synchronization.');

  await page.locator('#richMode').click();
  await page.locator('#previewBody .preview-line').first().waitFor();
  assert.equal(await page.locator('#noteFontSize').evaluate(el=>!!el.closest('#noteToolbar')),true);
  assert.equal(await page.locator('#autoNoteFont').evaluate(el=>!!el.closest('#noteToolbar')),true);
  const typography=await page.evaluate(()=>{const editor=getComputedStyle(document.querySelector('.note-editor .tiptap')),preview=getComputedStyle(document.querySelector('.preview-line'));return{editor:editor.fontFamily.split(',')[0],preview:preview.fontFamily.split(',')[0],tracking:preview.letterSpacing,leading:Number.parseFloat(editor.lineHeight)/Number.parseFloat(editor.fontSize)};});
  assert.equal(typography.editor,'Pretendard');assert.equal(typography.preview,'Pretendard');assert.equal(typography.tracking,'normal');assert.ok(Math.abs(typography.leading-1.8)<.01);
  const glyphsFit=await page.locator('#previewBody .preview-line').evaluateAll(lines=>lines.every(line=>{const range=document.createRange();range.selectNodeContents(line);return range.getBoundingClientRect().right<=line.getBoundingClientRect().right+1;}));assert.equal(glyphsFit,true,'Actual note glyphs exceed measured line width.');
  await page.locator('.inspector-body').evaluate(body=>{const editor=document.getElementById('noteEditor');body.scrollTop+=editor.getBoundingClientRect().top-body.getBoundingClientRect().top+120;});
  await page.waitForFunction(()=>Math.abs(document.querySelector('.note-chrome').getBoundingClientRect().top-document.querySelector('.inspector-body').getBoundingClientRect().top)<1);
  const opaque=await page.evaluate(()=>{const chrome=document.querySelector('.note-chrome'),r=chrome.getBoundingClientRect();for(let y=r.top+2;y<r.bottom-2;y+=4)for(const x of [r.left+2,(r.left+r.right)/2,r.right-2])if(!document.elementFromPoint(x,y)?.closest('.note-chrome'))return false;return getComputedStyle(chrome).backgroundColor==='rgb(252, 252, 250)';});assert.equal(opaque,true,'The sticky toolbar leaves gaps over the scrolling text.');
  assert.equal(await page.locator('#noteOptionsControls').isVisible(),false);assert.equal(await page.locator('#toggleNoteOptions').innerText(),'펼치기');
  await page.locator('#toggleNoteOptions').click();assert.equal(await page.locator('#noteOptionsControls').isVisible(),true);assert.equal(await page.locator('#toggleNoteOptions').getAttribute('aria-expanded'),'true');
  await page.locator('#speakerNotes').fill('접었다 펼쳐도 유지되는 발표자 노트');await page.locator('#toggleNoteOptions').click();assert.equal(await page.locator('#noteOptionsControls').isVisible(),false);await page.locator('#toggleNoteOptions').click();assert.equal(await page.locator('#speakerNotes').inputValue(),'접었다 펼쳐도 유지되는 발표자 노트');await page.locator('#toggleNoteOptions').click();
  await page.screenshot({path:path.join(root,'test-results','note-toolbar-fixed.png')});
  for(const size of [{width:1100,height:740},{width:1512,height:950}]){await application.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(size.width,size.height),size);await page.waitForFunction(()=>Math.abs(document.querySelector('.note-chrome').getBoundingClientRect().top-document.querySelector('.inspector-body').getBoundingClientRect().top)<1);assert.equal(await page.locator('#noteToolbar').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'Toolbar overflows a narrow app window.');}
  console.log('PASS compact font controls inside toolbar, shared UI typography and real glyph widths, opaque sticky toolbar at two window sizes, foldable additional settings and preserved values.');

  if(!(await page.locator('#videoControls').isVisible()))await page.locator('#toggleVideo').click();
  await page.locator('#cropButton').click();await page.locator('#fullCrop').click();await page.locator('#applyCrop').click();await page.locator('#progressDialog').waitFor({state:'hidden'});
  await page.evaluate(()=>{const group=window.StudioCore.groupSegments;window.StudioCore.groupSegments=(...args)=>group(...args).reverse();window.sawOrderAudit=false;new MutationObserver(()=>{if(document.getElementById('progressTitle').textContent.includes('순서와 시작 시각'))window.sawOrderAudit=true;}).observe(document.getElementById('progressTitle'),{childList:true});});
  await page.locator('#extractSettings').click();await page.locator('#mergeRepeated').check();await page.locator('#splitExercises').uncheck();await page.locator('#excludeEnding').uncheck();await page.locator('#startExtract').click();
  await page.waitForFunction(()=>!document.getElementById('progressDialog').open&&document.querySelectorAll('.slide-item').length===15,{}, {timeout:60000});
  const verified=await saved(page),batch=verified.slides.slice(-3);assert.deepEqual(batch.map(s=>Math.round(s.startTime)),[0,2,4]);assert.equal(await page.evaluate(()=>window.sawOrderAudit),true);assert.ok((await page.locator('#status').innerText()).includes('보정'));assert.equal(await page.locator('#previewTime').innerText(),'00:00');
  await page.waitForFunction(()=>!document.getElementById('video').seeking&&document.getElementById('video').currentTime<.1);assert.deepEqual(errors,[]);
  await page.reload();await page.waitForFunction(()=>!!window.StudioCore);await page.locator('#videoFile').setInputFiles(path.join(__dirname,'fixtures','slides.mp4'));await page.waitForFunction(()=>!document.getElementById('progressDialog').open&&document.querySelectorAll('.slide-item').length===15);
  await choose(initial[1]);await page.waitForFunction(size=>Number(document.getElementById('slidePreview').dataset.noteFont)===size,autoSize);assert.equal(await page.locator('#autoNoteFont').isChecked(),true);
  console.log('PASS group 1 final audit: deliberately reversed extraction candidates restored to video order; start times, capture segments and restored fonts verified.');
  await saved(page);await application.close();application=null;
  console.log(`PASS ${packaged?'packaged':'development'} usability groups.`);
 }catch(err){if(page){await page.screenshot({path:path.join(root,'test-results','usability-failure.png')}).catch(()=>{});console.error(await page.locator('#status').innerText().catch(()=>''));console.error(await page.locator('#noteFontHint').innerText().catch(()=>''));}throw err;
 }finally{if(application){await application.evaluate(({app})=>app.exit(0)).catch(()=>{});await application.close().catch(()=>{});}await fs.rm(temp,{recursive:true,force:true});}
})().catch(err=>{console.error(err);process.exitCode=1;});
