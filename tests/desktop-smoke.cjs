const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const executable = process.platform === 'win32'
  ? path.join(root, 'dist', 'win-unpacked', 'Slide Studio.exe')
  : path.join(root, 'dist', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Slide Studio.app', 'Contents', 'MacOS', 'Slide Studio');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(operation, timeout = 60000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const result = await operation(); if (result) return result; await sleep(100); }
  throw new Error('Desktop smoke check timed out.');
}

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-smoke-'));
  const profile = path.join(temp, 'profile'), downloads = path.join(temp, 'downloads');
  const lectureFolder = path.join(temp, '한글 경로'), video = path.join(lectureFolder, '강의 테스트.mp4');
  await fs.mkdir(downloads); await fs.mkdir(lectureFolder);
  await fs.copyFile(path.join(__dirname, 'fixtures', 'slides.mp4'), video);
  const environment = { ...process.env, SLIDE_STUDIO_USER_DATA: profile, SLIDE_STUDIO_DOWNLOADS: downloads };
  delete environment.ELECTRON_RUN_AS_NODE;
  let application;
  const errors = [], requests = [];
  async function launch() {
    application = await electron.launch({
      ...(packaged ? { executablePath: executable, args: ['--disable-gpu'] } : { args: [root, '--disable-gpu'] }),
      env: environment, cwd: root, timeout: 60000
    });
    const page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await page.waitForFunction(() => Boolean(window.StudioCore && window.StudioNotes && window.StudioExport));
    return page;
  }
  try {
    let page = await launch();
    assert.equal(await page.locator('#welcome h1').innerText(), 'slide studio');
    assert.equal(await page.evaluate(() => location.origin), 'app://studio');
    assert.deepEqual(await page.evaluate(() => [typeof require, typeof process, window.isSecureContext]), ['undefined', 'undefined', true]);
    const preferences = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.sandbox, true);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getBackgroundThrottling()), false);
    const denied = await application.evaluate(async ({ net }) => (await net.fetch('app://studio/package.json')).status);
    assert.equal(denied, 404);
    await page.evaluate(() => {
      window.reached100 = false;
      new MutationObserver(() => { if (document.getElementById('progressPercent').textContent === '100%') window.reached100 = true; })
        .observe(document.getElementById('progressPercent'), { childList: true });
    });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    await page.locator('#videoFile').setInputFiles(video);
    await page.locator('#aiSkip').click();
    await page.waitForFunction(() => !document.getElementById('progressDialog').open && document.querySelectorAll('.slide-item').length === 3, {}, { timeout: 60000 });
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    assert.equal(await page.evaluate(() => window.reached100), true);
    const redPixels = await page.evaluate(async () => {
      const image = new Image(); image.src = document.querySelector('#slidePreview img').src; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data; let count = 0;
      for (let i = 0; i < bytes.length; i += 4) if (bytes[i] > 140 && bytes[i + 1] < 100 && bytes[i + 2] < 100) count++;
      return count;
    });
    assert.ok(redPixels > 100, 'Final handwriting was not retained.');
    await application.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); });
    await page.locator('#lectureTitle').fill('배포 테스트 강의');
    await page.locator('#markdownMode').click();
    await page.locator('#markdownSource').fill('# 저장 확인\n\n**중요한 개념**과 한글 설명입니다.\n\n- [x] 필기 화면 확인\n- [ ] 복습하기');
    await page.locator('#richMode').click();
    assert.equal(await page.locator('#noteEditor h1').innerText(), '저장 확인');
    assert.equal(await page.locator('#noteEditor strong').innerText(), '중요한 개념');
    await page.waitForFunction(() => document.getElementById('saveStatus').textContent === '자동 저장됨');
    await page.locator('#exportPdf').click();
    const pdf = path.join(downloads, '배포 테스트 강의.pdf');
    await poll(async () => { try { const data = await fs.readFile(pdf); return data.length > 100000 && data.subarray(0, 5).toString() === '%PDF-'; } catch (_) { return false; } });
    await page.locator('#progressDialog').waitFor({ state: 'hidden', timeout: 120000 });
    await page.locator('#exportPptx').click();
    const pptx = path.join(downloads, '배포 테스트 강의.pptx');
    await poll(async () => { try { const data = await fs.readFile(pptx); return data.length > 10000 && data.subarray(0, 2).toString() === 'PK'; } catch (_) { return false; } });
    await page.locator('#progressDialog').waitFor({ state: 'hidden', timeout: 120000 });
    const originalPdf = await fs.readFile(pdf);
    await page.locator('#exportPdf').click();
    await poll(async () => { try { return (await fs.stat(path.join(downloads, '배포 테스트 강의 (1).pdf'))).size > 100000; } catch (_) { return false; } });
    await page.locator('#progressDialog').waitFor({ state: 'hidden', timeout: 120000 });
    assert.deepEqual(await fs.readFile(pdf), originalPdf);
    await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'test-results', `desktop-${process.platform}-${process.arch}.png`) });
    await application.close(); application = null;
    page = await launch(); await page.locator('#videoFile').setInputFiles(video);
    await page.waitForFunction(() => !document.getElementById('progressDialog').open && document.querySelectorAll('.slide-item').length === 3);
    assert.equal(await page.locator('#noteEditor h1').innerText(), '저장 확인');
    assert.equal(await page.locator('#noteEditor strong').innerText(), '중요한 개념');
    await page.waitForFunction(() => document.getElementById('saveStatus').textContent === '자동 저장됨');
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    await application.close(); application = null;
    console.log(`PASS ${packaged ? 'packaged' : 'development'} ${process.platform}/${process.arch}: secure origin, Korean video path, hidden extraction, final handwriting, Markdown, PDF/PPTX, non-overwriting downloads, persistent notes, offline.`);
  } finally {
    if (application) {
      await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await application.close().catch(() => {});
    }
    await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
