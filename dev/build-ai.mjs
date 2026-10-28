import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
await build({ entryPoints: ['dev/chatgpt-jwt.mjs'], outfile: 'electron/chatgpt-jwt.cjs', bundle: true,
  platform: 'node', format: 'cjs', target: 'node22', minify: true, legalComments: 'eof' });
await copyFile('node_modules/jose/LICENSE.md', 'electron/JOSE-LICENSE.md');
console.log('ChatGPT identity verification and MIT license bundled.');
