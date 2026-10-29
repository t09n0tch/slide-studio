const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {Worker}=require('node:worker_threads');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const runFile=promisify(execFile);
const PART_SECONDS=180*60-1;
const MESSAGES={cancelled:'MP3 준비를 취소했습니다.',no_audio:'이 영상에는 읽을 수 있는 음성 트랙이 없습니다.',decode_failed:'영상의 음성을 읽지 못했습니다. 재생 가능한 MP4 파일인지 확인해 주세요.',encode_failed:'MP3를 준비하지 못했습니다. 저장 공간과 영상 파일을 확인해 주세요.'};
function problem(code){const error=new Error(MESSAGES[code]||'음성 파일 작업을 완료하지 못했습니다.');error.code=code;return error;}
function audioToolsPath({packaged,resources,root,platform=process.platform,arch=process.arch}){return path.join(packaged?path.join(resources,'audio-tools'):path.join(root,'build','audio-tools',`${platform}-${arch}`),platform==='win32'?'ffmpeg.exe':'ffmpeg');}
function createAudio({directory,ffmpeg,report=()=>{},partSeconds=PART_SECONDS}){
 let active=null,files=new Map();
 const publicFiles=()=>[...files.values()].map(({id,name,start,end,bytes})=>({id,name,start,end,bytes}));
 const clearFiles=async()=>{files.clear();await fs.rm(directory,{recursive:true,force:true});};
 function cancel(){if(active){active.cancelled=true;active.worker?.postMessage('cancel');}}
 async function reset(){const current=active;cancel();if(current)await current.done.catch(()=>{});await clearFiles();}
 function prepare({source,duration,jobId}){
  if(active)throw new Error('MP3를 준비하고 있습니다. 완료하거나 취소한 뒤 다시 시도해 주세요.');
  if(typeof source!=='string'||!path.isAbsolute(source)||!Number.isFinite(duration)||duration<=0||duration>48*3600||typeof jobId!=='string'||!/^[A-Za-z0-9-]{1,100}$/.test(jobId))throw new Error('선택한 원본 영상 정보를 확인해 주세요.');
  const job={id:jobId,cancelled:false,worker:null,done:null};active=job;
  job.done=(async()=>{
   try{
    await clearFiles();const stat=await fs.stat(source);if(!stat.isFile()||!stat.size)throw problem('decode_failed');
    await fs.access(ffmpeg);await fs.mkdir(directory,{recursive:true});if(job.cancelled)throw problem('cancelled');
    const result=await new Promise((resolve,reject)=>{
     let settled=false;const finish=(error,result)=>{if(settled)return;settled=true;error?reject(error):resolve(result);};
     const workerFile=path.join(__dirname,'audio-worker.cjs').replace(`${path.sep}app.asar${path.sep}`,`${path.sep}app.asar.unpacked${path.sep}`);
     const worker=new Worker(workerFile,{workerData:{source,ffmpeg,directory,partSeconds,duration}});job.worker=worker;
     worker.on('message',message=>{
      if(message?.type==='progress'&&Number.isFinite(message.seconds))report({jobId,seconds:message.seconds,duration});
      else if(message?.type==='done')finish(null,message);
      else if(message?.type==='error')finish(problem(message.code));
     });
     worker.on('error',()=>finish(problem('encode_failed')));worker.on('exit',code=>{if(!settled)finish(problem(job.cancelled?'cancelled':'encode_failed'));});
     if(job.cancelled)worker.postMessage('cancel');
    });
    if(job.cancelled)throw problem('cancelled');
    let stem=path.basename(source,path.extname(source)).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');
    while(Buffer.byteLength(stem)>170)stem=Array.from(stem).slice(0,-1).join('');
    stem=stem.replace(/[. ]+$/,'')||'강의 음성';if(/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(stem))stem=`강의-${stem}`;
    for(let i=0;i<result.files.length;i++){
     const file=result.files[i];if(!/^audio-\d{3,}\.mp3$/.test(file.name)||!Number.isFinite(file.start)||!Number.isFinite(file.end)||file.end<=file.start)throw problem('encode_failed');
     const name=`${stem}${result.files.length>1?`-${String(i+1).padStart(2,'0')}`:''}.mp3`,target=path.join(directory,name);
     await fs.rename(path.join(directory,file.name),target);const id=crypto.randomUUID();files.set(id,{...file,id,name,path:target});
    }
    report({jobId,seconds:duration,duration});return {files:publicFiles(),duration:result.duration};
   }catch(error){await clearFiles();throw error;}
   finally{if(active===job)active=null;}
  })();return job.done;
 }
 async function file(id){const value=files.get(id);if(!value)throw new Error('음성 파일을 다시 준비해 주세요. 임시 파일은 스크립트 반영·새 강의·앱 종료 시 정리합니다.');await fs.access(value.path);return value;}
 async function discard(id){if(active)throw new Error('MP3 준비가 끝난 뒤 다시 시도해 주세요.');if(id){const value=files.get(id);if(value){await fs.rm(value.path,{force:true});files.delete(id);}}else await clearFiles();return publicFiles();}
 return {prepare,cancel,reset,file,discard,list:publicFiles};
}
async function copyAudioFile(file,{clipboard,ClipboardItem,platform=process.platform}={}){
 if(platform==='darwin'){
  const {pathToFileURL}=require('node:url');
  await clipboard.write([new ClipboardItem({'electron application/osclipboard;format="public.file-url"':new Blob([pathToFileURL(file).href],{type:'application/octet-stream'})})]);
 }else if(platform==='win32'){
  // Use Windows' real CF_HDROP file clipboard. The path is passed through the
  // child environment; no user-controlled string is evaluated as PowerShell.
  const script="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Windows.Forms; $files=New-Object System.Collections.Specialized.StringCollection; [void]$files.Add([Environment]::GetEnvironmentVariable('SLIDE_STUDIO_AUDIO_FILE')); [System.Windows.Forms.Clipboard]::SetFileDropList($files)";
  await runFile('powershell.exe',['-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env:{...process.env,SLIDE_STUDIO_AUDIO_FILE:file},windowsHide:true,timeout:15000});
 }else throw new Error('파일 복사는 Windows·Mac 설치 앱에서 사용할 수 있습니다.');
}
module.exports={createAudio,audioToolsPath,copyAudioFile,PART_SECONDS};
