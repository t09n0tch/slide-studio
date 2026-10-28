const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { assetPath, downloadPath } = require('../electron/paths.cjs');
const root = path.resolve('fixture-app');

test('desktop origin serves bundled UI assets without exposing app or filesystem internals', () => {
  assert.equal(assetPath(root, 'app://studio/index.html'), path.join(root, 'index.html'));
  assert.equal(assetPath(root, 'app://studio/js/core.js'), path.join(root, 'js/core.js'));
  assert.equal(assetPath(root, 'app://studio/vendor/notes-editor.js.LEGAL.txt'), path.join(root, 'vendor/notes-editor.js.LEGAL.txt'));
  for (const url of [
    'file:///etc/passwd', 'https://studio/index.html', 'app://other/index.html',
    'app://studio/package.json', 'app://studio/electron/main.cjs',
    'app://studio/js/%2e%2e%2fpackage.json', 'app://studio/js/%2e%2e%5cpackage.json',
    'app://studio/js/%00.js', 'app://studio/js/%zz.js', 'app://user@studio/index.html'
  ]) assert.equal(assetPath(root, url), null, url);
});

test('downloads preserve existing files and reserve names for simultaneous exports', () => {
  const directory = path.resolve('downloads'), existing = new Set([path.join(directory, '강의.pdf')]);
  const occupied = new Set([path.join(directory, '강의 (1).pdf')]);
  assert.equal(downloadPath(directory, '강의.pdf', p => existing.has(p), occupied), path.join(directory, '강의 (2).pdf'));
  assert.equal(downloadPath(directory, 'CON.pdf', () => false), path.join(directory, '_CON.pdf'));
  assert.equal(downloadPath(directory, 'LPT1.notes.pptx', () => false), path.join(directory, '_LPT1.notes.pptx'));
  assert.throws(() => downloadPath(directory, 'executable.exe', () => false));
});
