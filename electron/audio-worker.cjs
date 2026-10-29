/* PCM decoding and MP3 encoding stay off Electron's UI/main thread. */
const {parentPort,workerData}=require('node:worker_threads');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const {Mp3Encoder}=require('./mp3-encoder.cjs');
const RATE=44100,FRAME=1152,limit=Math.floor(workerData.partSeconds*RATE);
let cancelled=false,child,encoder,fd=null,frames=0,partFrames=0,partStart=0,partIndex=0,files=[],lastProgress=0;
parentPort.on('message',message=>{if(message==='cancel'){cancelled=true;child?.kill();}});
function write(bytes){if(bytes.length)fs.writeSync(fd,Buffer.from(bytes));}
function openPart(){const name=`audio-${String(partIndex++).padStart(3,'0')}.mp3`;fd=fs.openSync(path.join(workerData.directory,name),'wx');encoder=new Mp3Encoder(1,RATE,96);partFrames=0;partStart=frames;return name;}
let name;
function finishPart(){if(fd===null)return;write(encoder.flush());fs.closeSync(fd);fd=null;files.push({name,start:partStart/RATE,end:frames/RATE,bytes:fs.statSync(path.join(workerData.directory,name)).size});}
(async()=>{
 try{
  child=spawn(workerData.ffmpeg,['-hide_banner','-nostdin','-loglevel','error','-protocol_whitelist','file,pipe','-i',workerData.source,'-map','0:a:0','-vn','-ac','1','-ar',String(RATE),'-af','aresample=async=1:first_pts=0','-t',String(workerData.duration),'-c:a','pcm_s16le','-f','s16le','pipe:1'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  let stderr='',spawnError;child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-12000);});child.on('error',error=>{spawnError=error;});
  const closed=new Promise(resolve=>child.on('close',code=>resolve(code)));let pending=Buffer.alloc(0);
  for await(const chunk of child.stdout){
   if(cancelled)break;pending=Buffer.concat([pending,chunk]);let cursor=0;
   while(pending.length-cursor>=FRAME*2){
    if(!encoder||partFrames===limit){if(encoder)finishPart();name=openPart();}
    const count=Math.min(FRAME,limit-partFrames),pcm=new Int16Array(count);
    for(let i=0;i<count;i++)pcm[i]=pending.readInt16LE(cursor+i*2);
    write(encoder.encodeBuffer(pcm));cursor+=count*2;frames+=count;partFrames+=count;
   }
   pending=pending.subarray(cursor);
   if(Date.now()-lastProgress>200){lastProgress=Date.now();parentPort.postMessage({type:'progress',seconds:frames/RATE});}
  }
  const code=await closed;
  if(cancelled)throw new Error('cancelled');
  if(spawnError||code!==0)throw new Error(/matches no streams|does not contain any stream|Stream map.*no streams/i.test(stderr)?'no_audio':'decode_failed');
  let cursor=0;
  while(cursor+1<pending.length){if(!encoder||partFrames===limit){if(encoder)finishPart();name=openPart();}const count=Math.min(Math.floor((pending.length-cursor)/2),limit-partFrames),pcm=new Int16Array(count);for(let i=0;i<count;i++)pcm[i]=pending.readInt16LE(cursor+i*2);write(encoder.encodeBuffer(pcm));cursor+=count*2;frames+=count;partFrames+=count;}
  if(!frames)throw new Error('no_audio');finishPart();parentPort.postMessage({type:'done',files,duration:frames/RATE});
 }catch(error){child?.kill();if(fd!==null){try{fs.closeSync(fd);}catch(_){}fd=null;}parentPort.postMessage({type:'error',code:cancelled?'cancelled':['no_audio','decode_failed'].includes(error.message)?error.message:'encode_failed'});
 }finally{parentPort.close();}
})();
