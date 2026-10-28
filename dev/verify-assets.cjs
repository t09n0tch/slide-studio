const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'manifest.json'), 'utf8'));
for (const [name, expected] of Object.entries(manifest.files)) {
  const data = fs.readFileSync(path.join(root, 'vendor', name));
  assert.equal(data.length, expected.bytes, name);
  assert.equal(crypto.createHash('sha256').update(data).digest('hex'), expected.sha256, name);
}
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if (!/^(?:https?:|data:|blob:)/.test(match[1])) assert.ok(fs.existsSync(path.join(root, match[1])), match[1]);
}
console.log('Offline assets and license manifest verified.');
