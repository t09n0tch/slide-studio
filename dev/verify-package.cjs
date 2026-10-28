const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const asar = await import('@electron/asar');
  const root = path.resolve(__dirname, '..');
  const resources = process.platform === 'win32'
    ? path.join(root, 'dist', 'win-unpacked', 'resources')
    : path.join(root, 'dist', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Slide Studio.app', 'Contents', 'Resources');
  const archive = path.join(resources, 'app.asar'), files = asar.listPackage(archive).map(name => name.replace(/\\/g, '/'));
  for (const needed of ['/index.html', '/electron/main.cjs', '/vendor/font-bold-data.js', '/vendor/notes-editor.js', '/LICENSE']) assert.ok(files.includes(needed), needed);
  for (const file of files) assert.ok(!/(?:^|\/)(?:tests|test-results|node_modules|\.git)(?:\/|$)|\.(?:mp4|pdf|pptx|p12|pfx)$/i.test(file), file);
  console.log(`Packaged app contains the expected offline assets and no tests, videos, notes, dependencies, or signing keys (${files.length} entries).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
