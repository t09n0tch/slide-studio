import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import crypto from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const modules=process.env.STUDIO_EDITOR_NODE_MODULES||path.join(root,'node_modules');
const {build}=await import(pathToFileURL(path.join(modules,'esbuild/lib/main.js')).href);
const result=await build({entryPoints:[path.join(root,'dev/editor-entry.js')],outfile:path.join(root,'vendor/notes-editor.js'),bundle:true,minify:true,format:'iife',globalName:'StudioNotes',target:'es2022',legalComments:'linked',nodePaths:[modules],metafile:true});
const packages=new Map();
for(const input of Object.keys(result.metafile.inputs)){
  let directory=path.dirname(path.resolve(input));
  if(!directory.includes('node_modules'))continue;
  while(directory!==path.dirname(directory)){
    try{
      const pkg=JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'));
      if(pkg.name&&pkg.version){
        if(!packages.has(pkg.name)){
          const files=await fs.readdir(directory),licenseFile=files.find(name=>/^licen[sc]e(?:\.(?:md|txt))?$/i.test(name));
          if(!licenseFile)throw new Error(`Missing license for ${pkg.name}`);
          const license=await fs.readFile(path.join(directory,licenseFile),'utf8');
          packages.set(pkg.name,{name:pkg.name,version:pkg.version,license:pkg.license,text:license});
        }
        break;
      }
    }catch(error){if(error.code!=='ENOENT')throw error;}
    directory=path.dirname(directory);
  }
}
const sorted=Array.from(packages.values()).sort((a,b)=>a.name.localeCompare(b.name));
await fs.writeFile(path.join(root,'vendor/EDITOR-NOTICES.txt'),'Offline editor dependencies and their license texts\n\n'+sorted.map(p=>`${p.name} ${p.version} (${p.license})\n${'-'.repeat(70)}\n${p.text.trim()}\n`).join('\n'));
const manifest=JSON.parse(await fs.readFile(path.join(root,'vendor/manifest.json'),'utf8'));
manifest.libraries.Tiptap=sorted.find(p=>p.name==='@tiptap/core').version;
manifest.editorDependencies=sorted.map(({text,...p})=>p);
manifest.fonts[0].weights=[400,700];manifest.fonts[0].transform='Static wght=400 and wght=700 TrueType instances made with fontTools4.68.0';manifest.fonts[1].weights=[400,700];
manifest.files={};
for(const name of (await fs.readdir(path.join(root,'vendor'))).sort()){
  if(name==='manifest.json')continue;
  const bytes=await fs.readFile(path.join(root,'vendor',name));manifest.files[name]={sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
}
await fs.writeFile(path.join(root,'vendor/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Built offline editor and license notices for ${sorted.length} packages.`);
