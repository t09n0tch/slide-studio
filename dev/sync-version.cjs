const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const file = path.join(root, 'index.html'), html = fs.readFileSync(file, 'utf8');
const updated = html.replace(/v\d+\.\d+\.\d+(?:-[\w.-]+)? · 로컬 실행/, `v${version} · 로컬 실행`);
if (!updated.includes(`v${version} · 로컬 실행`)) throw new Error('App version label not found.');
if (updated !== html) fs.writeFileSync(file, updated);
