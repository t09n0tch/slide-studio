const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
(async () => {
  const asar = await import('@electron/asar');
  const root = path.resolve(__dirname, '..');
  const resources = process.platform === 'win32'
    ? path.join(root, 'dist', 'win-unpacked', 'resources')
    : path.join(root, 'dist', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Slide Studio.app', 'Contents', 'Resources');
  const archive = path.join(resources, 'app.asar'), files = asar.listPackage(archive).map(name => name.replace(/\\/g, '/'));
  for (const needed of ['/index.html', '/ai.css', '/transcript.css', '/js/ai.js', '/js/ai-ui.js', '/js/transcript.js', '/js/transcript-ui.js', '/electron/main.cjs', '/electron/preload.cjs', '/electron/chatgpt.cjs', '/electron/chatgpt-jwt.cjs', '/electron/JOSE-LICENSE.md', '/electron/audio.cjs', '/electron/audio-worker.cjs', '/electron/mp3-encoder.cjs', '/electron/LAME-LICENSE.txt', '/electron/LAME-SOURCE.txt', '/vendor/font-bold-data.js', '/vendor/PRETENDARD-LICENSE.txt', '/vendor/notes-editor.js', '/LICENSE']) assert.ok(files.includes(needed), needed);
  for (const file of files) assert.ok(!/(?:^|\/)(?:tests|test-results|node_modules|\.git|audio-temporary)(?:\/|$)|\.(?:mp3|mp4|pdf|pptx|p12|pfx)$/i.test(file), file);
  for (const name of ['audio-worker.cjs','mp3-encoder.cjs']) assert.ok(fs.statSync(path.join(resources,'app.asar.unpacked','electron',name)).size>0,name);
  const tools=path.join(resources,'audio-tools'),manifest=require('./audio-tools.json');
  for (const [name,expected] of Object.entries(manifest.licenses)) assert.equal(crypto.createHash('sha256').update(asar.extractFile(archive,`electron/${name}`)).digest('hex'),expected,name);
  for (const name of ['COPYING.LGPLv2.1','FFMPEG-LICENSE.md','SOURCE.txt','SLIDE-STUDIO-SOURCE.txt']) assert.ok(fs.statSync(path.join(tools,name)).size>0,name);
  const binary=path.join(tools,process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
  const version=execFileSync(binary,['-version'],{encoding:'utf8',timeout:30000,windowsHide:true});
  assert.ok(version.startsWith(`ffmpeg version ${manifest.version}`),'FFmpeg version');
  assert.ok(!/--enable-(?:gpl|nonfree|version3)\b/.test(version),'FFmpeg license configuration');
  for (const source of manifest.sources) {
    const bytes=fs.readFileSync(path.join(resources,'audio-sources',source.name));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),source.sha256,source.name);
  }
  console.log(`Packaged app contains offline editing/MP3 tools, licenses and matching source archives; no user media, notes, tests or signing keys (${files.length} entries).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
