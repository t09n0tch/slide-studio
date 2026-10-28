/* Real renderer, editing history, re-extraction and exported page geometry. */
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright');
const JSZip=require('../vendor/jszip.min.js'),PDFLib=require('../vendor/pdf-lib.min.js'),C=require('../js/core.js');
const root=path.resolve(__dirname,'..'),packaged=process.argv.includes('--packaged');
const executable=process.platform==='win32'?path.join(root,'dist','win-unpacked','Slide Studio.exe'):path.join(root,'dist',process.arch==='arm64'?'mac-arm64':'mac','Slide Studio.app','Contents','MacOS','Slide Studio');
async function waitFile(file){for(let i=0;i<1200;i++){try{const bytes=await fs.readFile(file);if(bytes.length>10000)return bytes;}catch(_){}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Export timed out: '+file);}
async function savedWorkspace(page){await page.waitForFunction(()=>document.getElementById('saveStatus').textContent==='자동 저장됨');return page.evaluate(async()=>{
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('lecture-slide-studio',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 try{return await new Promise((resolve,reject)=>{const r=db.transaction('workspace').objectStore('workspace').get('latest');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}
});}
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'studio-editing-')),downloads=path.join(temp,'downloads');let application,page;
 const environment={...process.env,SLIDE_STUDIO_USER_DATA:path.join(temp,'profile'),SLIDE_STUDIO_DOWNLOADS:downloads};delete environment.ELECTRON_RUN_AS_NODE;
 try{
  await fs.mkdir(downloads);
  application=await electron.launch({...packaged?{executablePath:executable,args:['--disable-gpu']}:{args:[root,'--disable-gpu']},env:environment,cwd:root,timeout:60000});
  page=await application.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const ids=()=>page.locator('.slide-item').evaluateAll(rows=>rows.map(row=>row.dataset.id));
  const choose=id=>page.locator(`.slide-item[data-id="${id}"]`).click();
  const video=path.join(__dirname,'fixtures','slides.mp4');
  await page.locator('#videoFile').setInputFiles(video);await page.locator('#aiSkip').click();
  await page.waitForFunction(()=>!document.getElementById('progressDialog').open&&document.querySelectorAll('.slide-item').length===3);
  const original=await ids(),longNotes='# 보관할 강의노트\n\n'+Array.from({length:45},(_,i)=>`${i+1}. 긴 설명과 필기를 복습하는 내용입니다. 핵심 원리를 확인합니다.`).join('\n\n');
  await page.locator('#markdownMode').click();await page.locator('#markdownSource').fill(longNotes);
  await page.locator('#showNotes').uncheck();assert.equal(await page.locator('#previewNotes').isVisible(),false);assert.equal(await page.locator('#sourceTime').isVisible(),true);
  const geometry=await page.evaluate(()=>({source:document.getElementById('previewSource').getBoundingClientRect().width,page:document.getElementById('slidePreview').clientWidth}));
  assert.ok(Math.abs(geometry.source-geometry.page)<2,'Hidden notes still reserve a right-hand column.');
  await choose(original[1]);assert.equal(await page.locator('#showNotes').isChecked(),true);assert.equal(await page.locator('#previewNotes').isVisible(),true);
  await choose(original[0]);assert.equal(await page.locator('#showNotes').isChecked(),false);assert.equal(await page.locator('#markdownSource').inputValue(),longNotes);
  await page.locator('#duplicateSlide').click();const withCopy=await ids(),copy=withCopy[1];assert.equal(withCopy.length,4);assert.notEqual(copy,original[0]);assert.equal(await page.locator('#showNotes').isChecked(),false);
  assert.equal(await page.locator('#markdownSource').inputValue(),longNotes);await page.locator('#markdownSource').fill('# 복사본만 변경\n\n독립적으로 작성한 노트');
  await page.locator('#undo').click();assert.deepEqual(await ids(),original);assert.equal(await page.locator('#markdownSource').inputValue(),longNotes);
  await page.locator('#redo').click();assert.deepEqual(await ids(),withCopy);assert.ok((await page.locator('#markdownSource').inputValue()).includes('독립적으로'));
  await page.locator('#deleteSlide').click();assert.deepEqual(await ids(),original);
  await choose(original[1]);await page.locator('#markdownSource').fill('# 삭제 후 추가한 노트\n\n다른 페이지에 적은 내용도 유지합니다.');
  await page.locator('#undo').click();assert.deepEqual(await ids(),withCopy);
  await choose(original[1]);assert.ok((await page.locator('#markdownSource').inputValue()).includes('삭제 후 추가한 노트'));
  await page.locator('#redo').click();assert.deepEqual(await ids(),original);await page.locator('#undo').click();assert.deepEqual(await ids(),withCopy);
  await choose(copy);await page.locator('#moveDown').click();const moved=[original[0],original[1],copy,original[2]];assert.deepEqual(await ids(),moved);
  await page.locator('.slide-item.active').focus();await page.keyboard.press('ControlOrMeta+z');assert.deepEqual(await ids(),withCopy);
  await page.keyboard.press('ControlOrMeta+Shift+z');assert.deepEqual(await ids(),moved);
  // Exercise native drag + edge scrolling in a compact window. The source and
  // target need not fit together; read the target position after scrolling.
  await application.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.setMinimumSize(0,0);window.setContentSize(1024,654);});
  const dragSource=page.locator(`.slide-item[data-id="${copy}"]`);
  await dragSource.scrollIntoViewIfNeeded();const sourceRect=await dragSource.boundingBox(),listRect=await page.locator('#slideList').boundingBox();
  await page.mouse.move(sourceRect.x+45,sourceRect.y+18);await page.mouse.down();await page.mouse.move(sourceRect.x+60,sourceRect.y+32,{steps:8});
  await page.locator(`.slide-item.dragging[data-id="${copy}"]`).waitFor();
  await page.mouse.move(listRect.x+70,listRect.y+8,{steps:12});
  await page.waitForFunction(()=>document.getElementById('slideList').scrollTop===0);
  const targetRect=await page.locator(`.slide-item[data-id="${original[0]}"]`).boundingBox();
  await page.mouse.move(targetRect.x+50,targetRect.y+18,{steps:8});
  await page.waitForFunction(()=>!document.getElementById('dropIndicator').hidden&&document.getElementById('dragStatus').textContent==='1번째 위치에 놓기');
  await page.mouse.up();
  const dragged=[copy,...original];assert.deepEqual(await ids(),dragged);
  await page.locator('#undo').click();assert.deepEqual(await ids(),moved);await page.locator('#redo').click();assert.deepEqual(await ids(),dragged);
  await choose(original[1]);
  // Make room for editing below the sticky toolbar on this compact viewport.
  if(await page.locator('#videoControls').isVisible())await page.locator('#toggleVideo').click();
  await page.locator('#richMode').click();const editor=page.locator('#noteEditor .tiptap');
  await editor.click();await page.keyboard.press('ControlOrMeta+End');await page.keyboard.type(' editor-undo-check');assert.ok((await editor.innerText()).includes('editor-undo-check'));
  await page.keyboard.press('ControlOrMeta+z');assert.deepEqual(await ids(),dragged);assert.ok(!(await editor.innerText()).includes('editor-undo-check'),'Page undo intercepted note editing.');
  // The selection presets must reach the actual extraction algorithm.
  await page.evaluate(()=>{const Detector=window.StudioCore.SceneDetector;window.detectedThresholds=[];window.StudioCore.SceneDetector=class extends Detector{constructor(...args){super(...args);window.detectedThresholds.push(args[0]);}};});
  for(const [preset,threshold]of [['distinct',.060],['detailed',.025]]){
   await page.locator('#extractSettings').click();await page.locator('#sensitivity').selectOption(preset);assert.ok((await page.locator('#sensitivityHelp').innerText()).length>20);
   await page.locator('#sampleInterval').selectOption('0.5');assert.ok((await page.locator('#intervalHelp').innerText()).startsWith('0.5초'));
   await page.locator('#rangeEnd').fill('00:03');for(const id of ['mergeRepeated','refineFrames','splitExercises','excludeEnding'])await page.locator('#'+id).uncheck();
   await page.locator('#startExtract').click();await page.waitForFunction(()=>!document.getElementById('progressDialog').open&&!document.getElementById('extractDialog').open,{}, {timeout:60000});assert.ok((await ids()).length>4,await page.locator('#status').innerText());
   assert.equal(await page.evaluate(()=>window.detectedThresholds.at(-1)),threshold);await page.locator('#undo').click();assert.deepEqual(await ids(),dragged);
  }
  await page.locator('#extractSettings').click();await page.locator('#sensitivity').selectOption('balanced');
  await fs.mkdir(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results','extraction-settings.png')});await page.locator('#closeExtract').click();
  // A text-only supplement keeps its full-page body, and can also be copied.
  await page.locator('#addSupplement').click();assert.equal(await page.locator('#showNotes').isDisabled(),true);
  await page.locator('#duplicateSlide').click();assert.equal(await page.locator('.slide-item').count(),6);await page.locator('#undo').click();await page.locator('#undo').click();assert.deepEqual(await ids(),dragged);
  for(const id of [copy,original[2]])await page.locator(`.slide-item[data-id="${id}"] > input`).uncheck();
  await choose(original[0]);await page.locator('#lectureTitle').fill('페이지 표시 검증');
  const saved=await savedWorkspace(page);assert.equal(saved.slides.find(s=>s.id===original[0]).showNotes,false);assert.equal(saved.slides.find(s=>s.id===original[0]).notes,longNotes);
  const counts=await page.evaluate(async state=>{
   const hidden=await window.StudioExport.prepare(state),shown=await window.StudioExport.prepare({...state,slides:state.slides.map(s=>({...s,showNotes:true}))});
   return{hidden:hidden.pages.length,shown:shown.pages.length,sourceOnly:hidden.pages[0].sourceOnly,items:hidden.pages[0].items.length};
  },saved);
  assert.deepEqual({hidden:counts.hidden,sourceOnly:counts.sourceOnly,items:counts.items},{hidden:2,sourceOnly:true,items:0});assert.ok(counts.shown>2,'Long hidden notes should only paginate when shown.');
  await page.screenshot({path:path.join(root,'test-results','page-options.png')});
  await page.locator('#exportPdf').click();const pdfBytes=await waitFile(path.join(downloads,'페이지 표시 검증.pdf'));await page.locator('#progressDialog').waitFor({state:'hidden',timeout:120000});
  await page.locator('#exportPptx').click();const pptxBytes=await waitFile(path.join(downloads,'페이지 표시 검증.pptx'));await page.locator('#progressDialog').waitFor({state:'hidden',timeout:120000});
  const zip=await JSZip.loadAsync(pptxBytes),slideFiles=Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name));assert.equal(slideFiles.length,2);
  const firstXml=await zip.file('ppt/slides/slide1.xml').async('string');assert.ok(!firstXml.includes('보관할 강의노트'),'Hidden notes still render in PPTX.');assert.ok(firstXml.includes('<a:t>00:00</a:t>')&&!/<a:t>(?:강의 )?시작/.test(firstXml)&&firstXml.includes('<a:t>01</a:t>'),'Source-only PPTX lost timestamp or page.');assert.equal((firstXml.match(/<p:sp>/g)||[]).length,2,'Only the two footer text shapes should remain.');
  const source=saved.slides.find(s=>s.id===original[0]),box=C.sourceBox(source,true),emu=value=>Math.round(value*9525);
  assert.ok(firstXml.includes(`<a:off x="${emu(box.x)}" y="${emu(box.y)}"/>`),firstXml.slice(-1600));assert.ok(firstXml.includes(`<a:ext cx="${emu(box.w)}" cy="${emu(box.h)}"/>`));
  assert.ok((await zip.file('ppt/notesSlides/notesSlide1.xml').async('string')).includes('보관할 강의노트'),'Hidden content should be retained in PPTX speaker notes.');
  const pdf=await PDFLib.PDFDocument.load(pdfBytes);assert.equal(pdf.getPageCount(),2);
  const streams=pdf.getPage(0).node.Contents().asArray().map(ref=>PDFLib.decodePDFRawStream(pdf.context.lookup(ref)).decode());
  const operators=Buffer.concat(streams.map(bytes=>Buffer.from(bytes))).toString();assert.equal((operators.match(/\bBT\b/g)||[]).length,2,'PDF should contain only the timestamp and page number.');
  assert.ok(operators.includes(`${box.w*.75} 0 0 ${box.h*.75} 0 0 cm`),operators);assert.ok(operators.includes(`1 0 0 1 ${box.x*.75} ${810-(box.y+box.h)*.75} cm`),operators);
  await fs.writeFile(path.join(root,'test-results','page-options.pdf'),pdfBytes);await fs.writeFile(path.join(root,'test-results','page-options.pptx'),pptxBytes);
  await page.reload();await page.waitForFunction(()=>!!window.StudioNotes);await page.locator('#videoFile').setInputFiles(video);
  await page.waitForFunction(()=>!document.getElementById('progressDialog').open&&document.querySelectorAll('.slide-item').length===4);
  assert.deepEqual(await ids(),dragged);await choose(original[0]);assert.equal(await page.locator('#showNotes').isChecked(),false);assert.equal(await page.locator('#previewNotes').isVisible(),false);
  await choose(original[1]);assert.equal(await page.locator('#showNotes').isChecked(),true);assert.ok((await page.locator('#noteEditor').innerText()).includes('삭제 후 추가한 노트'));
  assert.deepEqual(errors,[]);await savedWorkspace(page);await application.close();application=null;
  console.log(`PASS ${packaged?'packaged':'development'} editing: per-page notes, persistence, full-slide preview/PDF/PPTX, retained hidden notes, independent copies, delete/reorder/drag undo+redo, keyboard and note-editor undo, extraction presets reaching the detector, supplements.`);
 }catch(error){if(page){await fs.mkdir(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results','editing-failure.png')}).catch(()=>{});console.error(await page.locator('#status').innerText().catch(()=>''));}throw error;
 }finally{if(application){await application.evaluate(({app})=>app.exit(0)).catch(()=>{});await application.close().catch(()=>{});}await fs.rm(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
