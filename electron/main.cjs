const { app, BrowserWindow, Menu, dialog, net, protocol, screen, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { APP_URL, assetPath, downloadPath } = require('./paths.cjs');

app.setName('Slide Studio');
const userData = process.env.SLIDE_STUDIO_USER_DATA || path.join(app.getPath('appData'), 'SlideStudio');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
if (process.env.SLIDE_STUDIO_DOWNLOADS) app.setPath('downloads', process.env.SLIDE_STUDIO_DOWNLOADS);
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

let window;
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
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
    });
    window.once('ready-to-show', () => window.show());
    window.on('closed', () => { window = null; });
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

  app.whenReady().then(() => {
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
}
