import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
async function download(url){
  try{
    const response=await fetch(url,{signal:AbortSignal.timeout(180000)});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }catch{
    // Some source hosts exceed Node's connect deadline. macOS and the Windows
    // build runners include curl; the same pinned SHA-256 is checked below.
    return execFileSync('curl',['--silent','--show-error','--fail','--location','--proto','=https','--proto-redir','=https','--retry','2','--connect-timeout','20','--max-time','180',url],{maxBuffer:200*1024*1024,timeout:200000,windowsHide:true});
  }
}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await fs.readFile(path.join(root,'dev/audio-tools.json'),'utf8'));
const target=manifest.targets[`${process.platform}-${process.arch}`];
if(!target)throw new Error('Audio tool builds support Windows x64 and macOS arm64/x64.');
const folder=path.join(root,'build','audio-tools',`${process.platform}-${process.arch}`),archive=path.join(folder,'download.tar.gz');
const binary=path.join(folder,process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
const sourceFolder=path.join(root,'build','audio-tools','sources');
await fs.mkdir(sourceFolder,{recursive:true});
await Promise.all(manifest.sources.map(async source=>{
  const target=path.join(sourceFolder,source.name);let bytes;
  try{bytes=await fs.readFile(target);}catch{}
  if(!bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==source.sha256){
    bytes=await download(source.url);
    if(crypto.createHash('sha256').update(bytes).digest('hex')!==source.sha256)throw new Error(`Audio source checksum does not match: ${source.name}`);
    await fs.writeFile(target,bytes);
  }
}));
await fs.mkdir(folder,{recursive:true});
try {await fs.access(binary);} catch {
  const name=`ffmpeg-${manifest.version}-${target.triple}.tar.gz`;
  const bytes=await download(`${manifest.release}/${name}`);
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==target.sha256)throw new Error('Audio tool checksum does not match the pinned release.');
  await fs.writeFile(archive,bytes);
  const entries=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split(/\r?\n/);
  if(entries.some(name=>path.posix.isAbsolute(name)||name.replaceAll('\\','/').split('/').includes('..')))throw new Error('Unsafe audio archive path.');
  execFileSync('tar',['-xzf',archive,'-C',folder]);
  await fs.rm(archive);
}
const version=execFileSync(binary,['-version'],{encoding:'utf8',windowsHide:true});
if(!version.startsWith(`ffmpeg version ${manifest.version}`)||/--enable-(?:gpl|nonfree|version3)\b/.test(version))throw new Error('Unexpected FFmpeg version or license configuration.');
await fs.rm(path.join(folder,process.platform==='win32'?'ffprobe.exe':'ffprobe'),{force:true});
await fs.writeFile(path.join(folder,'SLIDE-STUDIO-SOURCE.txt'),`FFmpeg ${manifest.version}, unmodified LGPL-2.1 executable, invoked as a separate process.\nBuilds: ${manifest.release}\nCorresponding source: ${manifest.source}\nSource SHA-256: ${manifest.sourceSha256}\nRebuild instructions: https://github.com/serversideup/ffmpeg-lgpl-builds/tree/v8.1.2-27\nOriginal FFmpeg/OpenSSL sources and the matching build scripts are bundled in ../audio-sources/.\nBundled license and dependency notices are in this directory.\n`);
await build({entryPoints:[path.join(root,'dev/mp3-encoder.mjs')],outfile:path.join(root,'electron/mp3-encoder.cjs'),bundle:true,platform:'node',format:'cjs',minify:false,legalComments:'inline',banner:{js:'/* LAME JavaScript encoder, @breezystack/lamejs 1.2.7, LGPL-3.0. See LAME-LICENSE.txt and LAME-SOURCE.txt for original source and replacement instructions. */'}});
const pkg=path.join(root,'node_modules','@breezystack','lamejs');
const names=await fs.readdir(pkg),license=names.find(name=>/^licen[sc]e(?:\.|$)/i.test(name));
if(!license)throw new Error('LAME license not found.');
await fs.copyFile(path.join(pkg,license),path.join(root,'electron/LAME-LICENSE.txt'));
for(const [from,to] of [['COPYING.LGPLv3','LGPL-3.0.txt'],['COPYING.GPLv3','GPL-3.0.txt']]){
  const text=execFileSync('tar',['-xOf',path.join(sourceFolder,`ffmpeg-${manifest.version}.tar.xz`),`ffmpeg-${manifest.version}/${from}`]);
  await fs.writeFile(path.join(root,'electron',to),text);
}
await fs.writeFile(path.join(root,'electron/LAME-SOURCE.txt'),'LAME JavaScript MP3 encoder, @breezystack/lamejs 1.2.7, LGPL-3.0.\nUpstream: https://github.com/shijinyu/lamejs/tree/1fb0ef5fa177413107e2e107d054a9b994e3f79c\nOriginal, preferred-form sources and build configuration are bundled as audio-sources/lamejs-1.2.7-source.tar.gz under the app Resources directory.\nSlide Studio repackages the npm distribution as CommonJS with esbuild without additional minification; it does not modify the encoder algorithm.\nRebuild this wrapper: npm ci && npm run build:audio (dev/mp3-encoder.mjs and dev/build-audio.mjs).\nTo rebuild a modified encoder: unpack the source archive, install its dependencies, run npm run build, then bundle the resulting dist/lamejs.js as CommonJS with esbuild. Export Mp3Encoder.\nReplace app.asar.unpacked/electron/mp3-encoder.cjs with the rebuilt encoder; audio-worker.cjs loads this replaceable library.\nNo local speech recognition model or cloud API is used to create MP3 files.\n');
console.log(`Bundled verified FFmpeg ${manifest.version} (${process.platform}/${process.arch}) and replaceable LAME encoder with licenses and original sources.`);
