const { app, BrowserWindow, Menu, dialog, net, protocol, screen, session, ipcMain, shell, safeStorage, clipboard, ClipboardItem } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { APP_URL, assetPath, downloadPath } = require('./paths.cjs');
const { createService } = require('./service.cjs');
const { publicError } = require('../shared/service-protocol.cjs');
const { createAudio, audioToolsPath, copyAudioFile } = require('./audio.cjs');

app.setName('Slide Studio');
const userData = process.env.SLIDE_STUDIO_USER_DATA || path.join(app.getPath('appData'), 'SlideStudio');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
if (process.env.SLIDE_STUDIO_DOWNLOADS) app.setPath('downloads', process.env.SLIDE_STUDIO_DOWNLOADS);
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

let window;
let service;
let audio;
const pendingDownloads = new Set();
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  });

  function createWindow() {
    const available = screen.getPrimaryDisplay().workAreaSize;
    window = new BrowserWindow({
      width: Math.min(1512, available.width), height: Math.min(982, available.height),
      minWidth: Math.min(1100, available.width), minHeight: Math.min(740, available.height),
      title: 'Slide Studio', backgroundColor: '#ffffff', show: false,
      icon: path.join(app.getAppPath(), 'build', 'icon.png'), autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
    });
    window.once('ready-to-show', () => window.show());
    window.on('closed', () => { service?.cancel(); audio?.reset().catch(()=>{}); window = null; });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (url !== APP_URL) event.preventDefault(); });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('will-prevent-unload', event => {
      const choice = dialog.showMessageBoxSync(window, {
        type: 'question', title: 'Slide Studio 종료',
        message: '진행 중인 작업이나 저장되지 않은 변경이 있습니다.',
        detail: '종료하면 진행 중인 추출·내보내기와 아직 저장되지 않은 변경을 잃을 수 있습니다.',
        buttons: ['계속 작업', '종료'], defaultId: 0, cancelId: 0, noLink: true
      });
      if (choice === 1) event.preventDefault();
    });
    window.loadURL(APP_URL).catch(error => dialog.showErrorBox('Slide Studio를 열지 못했습니다', error.message));
  }

  app.whenReady().then(async () => {
    service = createService({storageDir:path.join(userData,'service'),safeStorage});
    audio=createAudio({directory:path.join(userData,'audio-temporary'),ffmpeg:audioToolsPath({packaged:app.isPackaged,resources:process.resourcesPath,root:app.getAppPath()}),report:value=>{if(window&&!window.isDestroyed())window.webContents.send('studio:audio-progress',value);}});
    await audio.reset();
    ipcMain.handle('studio:audio',async(event,method,payload)=>{
      if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==APP_URL)return{ok:false,error:{message:'지원하지 않는 화면입니다.'}};
      try{
        let value;
        if(method==='prepare')value=await audio.prepare(payload||{});
        else if(method==='cancel')audio.cancel();
        else if(method==='reset')await audio.reset();
        else if(method==='readText'){value=await clipboard.readText();if(value.length>1000000)throw new Error('스크립트가 너무 깁니다. 현재 강의의 원문만 복사해 주세요.');}
        else if(method==='discard')value=await audio.discard(payload);
        else if(method==='open')await shell.openExternal('https://clovanote.naver.com/');
        else if(['copy','drag','reveal'].includes(method)){
          const file=await audio.file(payload);
          if(method==='copy')await copyAudioFile(file.path,{clipboard,ClipboardItem});
          else if(method==='drag')event.sender.startDrag({file:file.path,icon:path.join(app.getAppPath(),'build','icon.png')});
          else shell.showItemInFolder(file.path);
        }else throw new Error('지원하지 않는 음성 파일 작업입니다.');
        return{ok:true,value};
      }catch(error){return{ok:false,error:{code:error.code||'audio_failed',message:error.code==='ENOENT'?'음성 파일을 다시 준비해 주세요.':error.message?.startsWith('Command failed')?'파일을 복사하지 못했습니다. MP3를 끌어놓거나 파일 위치를 열어 첨부해 주세요.':error.message||'음성 파일 작업을 완료하지 못했습니다.'}};}
    });
    ipcMain.handle('studio:service', async (event, method, payload) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== APP_URL) return {ok:false,error:{code:'invalid_sender',message:'지원하지 않는 화면입니다.'}};
      try {
        let value;
        if(method==='session')value=await service.session();
        else if(method==='connect')value=await service.connect(payload);
        else if(method==='disconnect')value=await service.disconnect();
        else if(method==='generate')value=await service.generate(payload);
        else if(method==='cancel')service.cancel();
        else throw Error();
        return {ok:true,value};
      }catch(error){return {ok:false,error:publicError(error)};}
    });
    protocol.handle('app', async request => {
      const file = assetPath(app.getAppPath(), request.url);
      if (!file || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
      try { return await net.fetch(pathToFileURL(file).toString()); }
      catch (_) { return new Response('Not found', { status: 404 }); }
    });
    const current = session.defaultSession;
    current.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    current.setPermissionCheckHandler(() => false);
    current.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
    current.on('will-download', (event, item) => {
      let target;
      try {
        target = downloadPath(app.getPath('downloads'), item.getFilename(), fs.existsSync, pendingDownloads);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        pendingDownloads.add(target); item.setSavePath(target);
        item.once('done', (_event, state) => {
          pendingDownloads.delete(target);
          if (state !== 'completed') dialog.showErrorBox('파일 저장 실패', '다운로드 폴더의 저장 공간과 쓰기 권한을 확인한 뒤 다시 내보내 주세요.');
        });
      } catch (error) {
        if (target) pendingDownloads.delete(target);
        event.preventDefault(); dialog.showErrorBox('파일 저장 실패', error.message);
      }
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { label: '편집', role: 'editMenu' },
      { label: '보기', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
      { label: '창', role: 'windowMenu' }
    ]));
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  }).catch(error => { dialog.showErrorBox('Slide Studio 실행 실패', error.message); app.exit(1); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  let audioCleanup=false;
  app.on('will-quit',event=>{if(audio&&!audioCleanup){event.preventDefault();audioCleanup=true;audio.reset().catch(()=>{}).finally(()=>app.quit());}});
}
