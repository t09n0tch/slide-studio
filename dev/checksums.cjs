const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
(async () => {
  const directory = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
  const names = (await fs.readdir(directory)).filter(name => /\.(?:exe|dmg|zip)$/i.test(name)).sort();
  if (!names.length) throw new Error('No distributable files found.');
  const rows = [];
  for (const name of names) rows.push(`${crypto.createHash('sha256').update(await fs.readFile(path.join(directory, name))).digest('hex')}  ${name}`);
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), rows.join('\n') + '\n');
  console.log(rows.join('\n'));
})().catch(error => { console.error(error); process.exitCode = 1; });
