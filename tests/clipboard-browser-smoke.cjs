const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),{chromium}=require(path.join(root,'node_modules/playwright'));
(async()=>{
 const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
 const server=http.createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));}catch(_){res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({permissions:['clipboard-read','clipboard-write'],viewport:{width:1512,height:950}});
  await context.addInitScript(()=>{window.open=url=>{window.openedChatGPT=url;return null;};});const page=await context.newPage(),errors=[],downloads=[];page.on('pageerror',e=>errors.push(e.message));page.on('download',d=>downloads.push(d.suggestedFilename()));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);assert.equal(await page.evaluate(()=>typeof window.studioDesktop),'undefined');
  await page.locator('#videoFile').setInputFiles(path.join(root,'tests/fixtures/slides.mp4'));await page.locator('#aiChooseFree').click();await page.locator('#aiPrepare').click();
  await page.waitForFunction(()=>!!document.getElementById('aiSheetPreview').getAttribute('src')&&!document.getElementById('aiPrepare').disabled);
  const prompt=await page.locator('#aiPrompt').inputValue();const read=()=>page.evaluate(async()=>({types:(await navigator.clipboard.read()).flatMap(item=>item.types),text:await navigator.clipboard.readText()}));
  const first=await read();assert.equal(first.text,prompt);assert.ok(first.types.includes('text/plain'));assert.ok(!first.types.includes('image/png'));assert.equal(await page.evaluate(()=>window.openedChatGPT),'https://chatgpt.com/');assert.deepEqual(await page.locator('#aiPrepared > .ai-inline button').allTextContents(),['이미지 복사','텍스트 복사']);
  await page.evaluate(()=>document.addEventListener('paste',async e=>{e.preventDefault();window.lastPaste={text:e.clipboardData.getData('text/plain'),files:await Promise.all([...e.clipboardData.files].map(async f=>({type:f.type,size:f.size,signature:[...new Uint8Array(await f.arrayBuffer()).slice(0,8)]})))};}));
  const paste=async()=>{await page.locator('#aiReply').evaluate(el=>{el.closest('details').open=true;window.lastPaste=null;el.focus();});await page.keyboard.press('ControlOrMeta+v');await page.waitForFunction(()=>!!window.lastPaste);return page.evaluate(()=>window.lastPaste);};
  const pastedText=await paste();assert.equal(pastedText.text,prompt);assert.equal(pastedText.files.length,0);
  await page.locator('#aiCopyImage').click();await page.waitForFunction(()=>document.getElementById('aiPreparedName').textContent.startsWith('이미지 복사 완료'));
  const image=await read();assert.ok(image.types.includes('image/png'));assert.ok(!image.types.includes('text/plain'));assert.equal(image.text,'');const pastedImage=await paste();assert.equal(pastedImage.text,'');assert.equal(pastedImage.files[0].type,'image/png');assert.deepEqual(pastedImage.files[0].signature,[137,80,78,71,13,10,26,10]);
  await page.locator('#aiCopyPrompt').click();await page.waitForFunction(()=>document.getElementById('aiPreparedName').textContent.startsWith('텍스트 복사 완료'));const again=await read();assert.equal(again.text,prompt);assert.ok(!again.types.includes('image/png'));assert.equal((await paste()).text,prompt);
  await page.locator('#aiReply').evaluate(el=>el.closest('details').open=false);await page.screenshot({path:path.join(root,'test-results','assistant-free-chrome.png')});assert.deepEqual(downloads,[]);assert.deepEqual(errors,[]);
  console.log('PASS Chrome: default text-only clipboard, two buttons, image-only PNG clipboard and actual paste, text recopy/paste, no downloads.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
