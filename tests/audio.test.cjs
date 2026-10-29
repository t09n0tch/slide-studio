const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {createAudio,audioToolsPath,PART_SECONDS}=require('../electron/audio.cjs');
const root=path.resolve(__dirname,'..'),ffmpeg=audioToolsPath({root});
test('real MP3 encoding keeps silence and duration, splits at original offsets, handles Unicode and cleans only its own temporary files',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'studio-audio-test-')),source=path.join(temp,"교수님의 강의.mp4"),directory=path.join(temp,'prepared');await fs.copyFile(path.join(__dirname,'fixtures/lecture-audio.mp4'),source);
 const audio=createAudio({directory,ffmpeg});try{
  const result=await audio.prepare({source,duration:6,jobId:'real-mp3'});assert.equal(result.files.length,1);assert.ok(Math.abs(result.duration-6)<.01);const file=await audio.file(result.files[0].id);assert.ok(file.name.endsWith('.mp3'));assert.equal((await fs.readdir(directory)).filter(n=>n.endsWith('.mp3')).length,1);
  const pcm=execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-i',file.path,'-f','s16le','-ac','1','-ar','44100','pipe:1'],{maxBuffer:4*1024*1024,windowsHide:true});
  const rms=(start,end)=>{let sum=0,count=0;for(let i=Math.floor(start*44100)*2;i<Math.min(pcm.length,end*44100*2);i+=2){sum+=pcm.readInt16LE(i)**2;count++;}return Math.sqrt(sum/count);};assert.ok(rms(.6,1.4)>100);assert.ok(rms(2.6,3.4)<rms(.6,1.4)/100,'Silence was removed or the timeline shifted.');
  await audio.discard(file.id);assert.equal(audio.list().length,0);assert.ok((await fs.stat(source)).size>0);
 }finally{await audio.reset();await fs.rm(temp,{recursive:true,force:true});}
 const splitRoot=await fs.mkdtemp(path.join(os.tmpdir(),'studio-audio-parts-')),split=createAudio({directory:path.join(splitRoot,'prepared'),ffmpeg,partSeconds:2});try{const result=await split.prepare({source:path.join(__dirname,'fixtures/lecture-audio.mp4'),duration:6,jobId:'split'});assert.deepEqual(result.files.map(f=>[f.start,f.end]),[[0,2],[2,4],[4,6]]);assert.equal(PART_SECONDS,10799);}finally{await split.reset();await fs.rm(splitRoot,{recursive:true,force:true});}
});
test('no-audio and cancellation leave no MP3 or stale jobs and a later attempt succeeds',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'studio-audio-failure-'));let audio,cancelOnProgress=true;
 audio=createAudio({directory:path.join(temp,'prepared'),ffmpeg,report:()=>{if(cancelOnProgress)audio.cancel();}});
 try{
  await assert.rejects(audio.prepare({source:path.join(__dirname,'fixtures/slides.mp4'),duration:6,jobId:'silent'}),{code:'no_audio'});
  await assert.rejects(audio.prepare({source:path.join(__dirname,'fixtures/lecture-audio.mp4'),duration:6,jobId:'cancel'}),{code:'cancelled'});assert.equal(audio.list().length,0);await assert.rejects(fs.access(path.join(temp,'prepared')));
  cancelOnProgress=false;const retry=await audio.prepare({source:path.join(__dirname,'fixtures/lecture-audio.mp4'),duration:6,jobId:'retry'});assert.equal(retry.files.length,1);
 }finally{await audio.reset();await fs.rm(temp,{recursive:true,force:true});}
});
