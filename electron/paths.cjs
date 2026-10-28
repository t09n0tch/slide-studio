const path = require('node:path');

const APP_URL = 'app://studio/index.html';
const ROOT_FILES = new Set(['index.html', 'style.css', 'editor.css', 'welcome.css', 'icon.svg']);

function assetPath(root, requestUrl) {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== 'app:' || url.hostname !== 'studio' || url.port || url.username || url.password) return null;
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\\') || pathname.includes('\0')) return null;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const pieces = relative.split('/');
    if (pieces.some(piece => piece === '..' || piece === '.' || !piece)) return null;
    if (!ROOT_FILES.has(relative) && !/^(?:js|vendor)\/[\w.-]+\.(?:js|txt|md|json)$/.test(relative)) return null;
    const resolved = path.resolve(root, relative);
    if (!resolved.startsWith(path.resolve(root) + path.sep)) return null;
    return resolved;
  } catch (_) { return null; }
}

function downloadPath(directory, filename, exists, occupied = new Set()) {
  let safeName = path.basename(filename).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  if (!/\.(?:pdf|pptx)$/i.test(safeName)) throw new Error('지원하지 않는 내보내기 형식입니다.');
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safeName)) safeName = '_' + safeName;
  const extension = path.extname(safeName), stem = safeName.slice(0, -extension.length);
  for (let i = 0; i < 10000; i++) {
    const candidate = path.join(directory, `${stem}${i ? ` (${i})` : ''}${extension}`);
    if (!exists(candidate) && !occupied.has(candidate)) return candidate;
  }
  throw new Error('같은 이름의 내보내기 파일이 너무 많습니다. 다운로드 폴더를 정리해 주세요.');
}

module.exports = { APP_URL, assetPath, downloadPath };
