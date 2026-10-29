/* Timestamped text import and alignment; no network or speech model. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.StudioTranscript=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const MAX_TEXT=1000000;
 const CLOCK='\\d{1,3}:\\d{2}(?::\\d{2})?(?:[.,]\\d{1,3})?';
 const range=new RegExp(`^\\s*(${CLOCK})\\s*-->\\s*(${CLOCK})(?:\\s+.*)?$`);
 const timed=new RegExp(`^\\s*(?:\\[\\s*)?(${CLOCK})(?:\\s*\\])?(?:\\s+|$)(.*)$`);
 const speakerTimed=new RegExp(`^\\s*((?:참석자|발화자|화자|speaker|participant)\\s*[^:]{0,30}?)\\s+(${CLOCK})(?:\\s+|$)(.*)$`,'i');
 const nameTimed=new RegExp(`^\\s*([가-힣A-Za-z][가-힣A-Za-z ._-]{0,28})\\s+(${CLOCK})(?:\\s+|$)(.*)$`);
 function seconds(value){
  if(typeof value!=='string'||!new RegExp(`^${CLOCK}$`).test(value))throw new Error('스크립트의 시간 표시를 확인해 주세요.');
  const parts=value.replace(',','.').split(':').map(Number);
  if(parts.some(n=>!Number.isFinite(n))||parts.length<2||parts.length>3||parts.at(-1)>=60||(parts.length===3&&parts[1]>=60))throw new Error('스크립트의 시간 표시를 확인해 주세요.');
  return parts.reduce((sum,n)=>sum*60+n,0);
 }
 function fingerprint(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return `${text.length.toString(36)}-${(h>>>0).toString(36)}`;}
 function parse(text,{duration,offset=0}={}){
  if(typeof text!=='string'||!text.trim()||text.length>MAX_TEXT)throw new Error('시간 표시가 포함된 스크립트 원문을 붙여넣어 주세요. 최대 1,000,000자까지 가져올 수 있습니다.');
  if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(offset)||offset<0||offset>=duration)throw new Error('원본 영상과 스크립트 시작 시각을 확인해 주세요.');
  const cues=[];let current=null,lastStart=-1,pendingSpeaker='';
  const finish=()=>{if(current){current.text=current.lines.join('\n').trim();delete current.lines;if(current.text)cues.push(current);}current=null;};
  // Clova's copy action can flatten every speaker/timestamp block into one line.
  const normalized=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').replace(new RegExp(`(?:^|[ \\t\\u00a0])((?:참석자|발화자|화자|speaker|participant)\\s*\\d+\\s+${CLOCK})(?=\\s|$)`,'gi'),'\n$1');
  const lines=normalized.split('\n');
  for(const [index,line] of lines.entries()){
   const span=line.match(range),spoken=line.match(speakerTimed)||line.match(nameTimed),stamp=span?null:line.match(timed);
   if(span||spoken||stamp){
    finish();const start=seconds(span?span[1]:spoken?spoken[2]:stamp[1])+offset,end=span?seconds(span[2])+offset:null;
    if(start<lastStart)throw new Error('스크립트 시간이 앞뒤로 바뀝니다. 분할 MP3라면 파일별로 시작 구간을 선택해 하나씩 가져와 주세요.');
    if(start>=duration+.5||end!==null&&end<=start)throw new Error('스크립트 시간이 원본 영상과 맞지 않습니다. 같은 강의의 원문과 시작 구간인지 확인해 주세요.');
    lastStart=start;current={start,end:end===null?null:Math.min(end,duration),speaker:spoken?spoken[1].trim():pendingSpeaker,text:'',lines:[]};pendingSpeaker='';
    const body=spoken?spoken[3]:stamp?stamp[2]:'';if(body)current.lines.push(body);continue;
   }
   if(/^\s*(?:(?:참석자|발화자|화자|speaker|participant)\s*\d+)\s*$/i.test(line)){pendingSpeaker=line.trim();continue;}
   if(!line.trim()||/^\s*WEBVTT(?:\s.*)?$/.test(line)||/^\s*\d+\s*$/.test(line)&&range.test(lines[index+1]||''))continue;
   if(current)current.lines.push(line.trim());
  }
  finish();
  if(!cues.length)throw new Error('시간 표시를 찾지 못했습니다. 클로바노트의 요약이 아닌 음성 기록 원문을 복사하거나, 시간 기록을 포함한 TXT·SRT 파일을 가져와 주세요.');
  for(let i=0;i<cues.length;i++)if(cues[i].end===null)cues[i].end=cues[i+1]?.start??duration;
  if(cues.some(c=>c.end<c.start))throw new Error('스크립트의 시간 순서를 확인해 주세요.');
  return {version:1,source:'clovanote',cues};
 }
 function restore(value,duration){
  if(value==null)return null;
  if(value.version!==1||value.source!=='clovanote'||!Array.isArray(value.cues)||value.cues.length>50000||!Number.isFinite(duration))throw new Error('저장한 음성 기록을 읽지 못했습니다.');
  let length=0,last=-1;const cues=value.cues.map(c=>{if(!c||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.start<last||c.end<c.start||c.end>duration+.5||typeof c.text!=='string'||!c.text.trim()||typeof c.speaker!=='string'||c.speaker.length>100)throw new Error('저장한 음성 기록 형식이 올바르지 않습니다.');last=c.start;length+=c.text.length;return{start:c.start,end:c.end,speaker:c.speaker,text:c.text};});
  if(length>MAX_TEXT)throw new Error('저장한 음성 기록이 너무 깁니다.');return {version:1,source:'clovanote',cues};
 }
 function merge(previous,next,{start=0,end=Infinity}={}){
  const kept=(previous?.cues||[]).filter(c=>c.start<start||c.start>=end).map(c=>c.start<start&&c.end>start?{...c,end:start}:c);
  return {version:1,source:'clovanote',cues:[...kept,...next.cues].sort((a,b)=>a.start-b.start||a.end-b.end)};
 }
 function forSlide(transcript,slide){
  if(!transcript||!slide.image)return [];
  const intervals=slide.segments?.length?slide.segments:[];
  // Clova timestamps describe paragraphs, not individual words. Preserve the
  // original paragraph as boundary context instead of inventing word timings.
  return transcript.cues.filter(c=>intervals.some(s=>c.start<s.end&&(c.end>s.start||c.start===c.end&&c.start>=s.start)));
 }
 function speech(transcript,slide){const cues=forSlide(transcript,slide),intervals=slide.segments?.map(s=>({start:s.start,end:s.end}))||[];return cues.length?{source:'clovanote',intervals,cues,fingerprint:fingerprint(JSON.stringify({intervals,cues}))}:null;}
 return {MAX_TEXT,seconds,fingerprint,parse,restore,merge,forSlide,speech};
});
