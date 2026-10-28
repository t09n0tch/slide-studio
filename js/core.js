/* Classical image comparison and project data. No models, services, or network. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudioCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 2;
  const KINDS = {original: '원본', question: '문제', solution: '풀이', supplement: '보충 설명'};
  // Tuned against one lecture/reference deck. These are pixel rules, with no
  // semantic recognition. Keep both paired frames and every excluded screen.
  const DETECTION_DEFAULTS=Object.freeze({interval:1,threshold:.040,confirmations:2,mergeTolerance:.018,refineResolution:.12,transitionGuard:.15,endingMaxDuration:10,endingHeaderInk:.002,endingBodySpan:.20,exercisePanelFraction:.12,exerciseMinChange:.004,exerciseSettle:1,exerciseStableDifference:.003});
  const uid = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  function timecode(seconds, precise = false) {
    const n = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(n / 3600), m = Math.floor(n / 60) % 60, s = Math.floor(n % 60);
    const base = [h ? String(h) : null, String(m).padStart(2, '0'), String(s).padStart(2, '0')].filter(v => v !== null).join(':');
    return base + (precise ? '.' + Math.floor((n % 1) * 10) : '');
  }
  function parseTime(value) {
    const parts = String(value).trim().split(':');
    if (!parts.length || parts.length > 3 || parts.some(p => !/^\d+(\.\d+)?$/.test(p))) return NaN;
    return parts.reduce((n, v) => n * 60 + Number(v), 0);
  }
  function cropBounds(crop, width, height) {
    const x = Math.round(Number(crop.x)), y = Math.round(Number(crop.y));
    const w = Math.round(Number(crop.width)), h = Math.round(Number(crop.height));
    if (![x,y,w,h,width,height].every(Number.isFinite) || x < 0 || y < 0 || w < 8 || h < 8 || x+w > width || y+h > height) throw new Error('슬라이드 영역이 영상 크기를 벗어납니다.');
    return {x,y,width:w,height:h};
  }
  function descriptor(rgba) {
    const out = new Uint8Array(rgba.length / 4 * 3); let ink = 0;
    for (let i=0,j=0; i<rgba.length; i+=4) {
      out[j++] = rgba[i]; out[j++] = rgba[i+1]; out[j++] = rgba[i+2];
      if (0.299*rgba[i]+0.587*rgba[i+1]+0.114*rgba[i+2] < 180) ink++;
    }
    return {pixels:out, ink:ink/(rgba.length/4)};
  }
  function difference(a,b) {
    if (!a || !b || a.length!==b.length || !a.length) return 1;
    let sum=0,changed=0;
    for (let i=0;i<a.length;i+=3) {
      const d=(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/765;
      sum+=d; if(d>0.12) changed++;
    }
    return (sum+changed*0.25)/(a.length/3);
  }
  // Only remove margins shared by the sampled frames. An entirely black
  // opening/ending frame gives no evidence about the slide's actual bounds.
  function detectBlackMargins(frames,width,height) {
    const boxes=[];
    for(const rgba of frames){
      if(rgba.length!==width*height*4)throw new Error('화면 크기가 올바르지 않습니다.');
      const black=(x,y)=>{const i=(y*width+x)*4;return Math.max(rgba[i],rgba[i+1],rgba[i+2])<30;};
      let dark=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(black(x,y))dark++;
      if(dark/(width*height)>.98)continue;
      const col=x=>{let n=0;for(let y=0;y<height;y++)if(black(x,y))n++;return n/height>.80;};
      const row=y=>{let n=0;for(let x=0;x<width;x++)if(black(x,y))n++;return n/width>.98;};
      let x0=0,x1=width-1,y0=0,y1=height-1;
      while(x0<width*.2&&col(x0))x0++;while(x1>width*.8&&col(x1))x1--;
      while(y0<height*.2&&row(y0))y0++;while(y1>height*.8&&row(y1))y1--;
      boxes.push({x:x0,y:y0,right:x1+1,bottom:y1+1});
    }
    if(!boxes.length)return{x:0,y:0,width,height};
    const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
    return{x,y,width:Math.max(...boxes.map(b=>b.right))-x,height:Math.max(...boxes.map(b=>b.bottom))-y};
  }
  function layoutStats(pixels,width=96,height=72){
    if(pixels.length!==width*height*3)throw new Error('비교 화면 크기가 올바르지 않습니다.');
    const headerBottom=Math.round(height/9),headerRight=Math.round(width*.896),bodyTop=Math.round(height*.18),bodyBottom=Math.round(height*.889);
    let headerInk=0,panel=0,bodyPixels=0,firstRow=null,lastRow=null;
    for(let y=0;y<height;y++){
      let rowInk=0;
      for(let x=0;x<width;x++){
        const i=(y*width+x)*3,r=pixels[i],g=pixels[i+1],b=pixels[i+2],luma=.299*r+.587*g+.114*b;
        if(y<headerBottom&&x<headerRight&&luma<95)headerInk++;
        if(y>=bodyTop&&y<bodyBottom){
          bodyPixels++;if(luma<180)rowInk++;
          if(r>200&&r<248&&g-r>3&&b-r>3&&Math.abs(b-g)<15)panel++;
        }
      }
      if(rowInk>=Math.max(2,Math.round(width*.02))){if(firstRow===null)firstRow=y;lastRow=y;}
    }
    return{headerInk:headerInk/(headerBottom*headerRight),bodySpan:firstRow===null?0:(lastRow-firstRow+1)/(bodyBottom-bodyTop),panelFraction:panel/bodyPixels};
  }
  function isSparseEnding(candidate,duration,config=DETECTION_DEFAULTS){
    const intervals=candidate.segments||[{start:candidate.start,end:candidate.end}];
    if(!intervals.some(s=>s.end>=duration-.1)||intervals.reduce((n,s)=>n+s.end-s.start,0)>=config.endingMaxDuration)return false;
    const shape=layoutStats(candidate.signature);
    return shape.headerInk<config.endingHeaderInk&&shape.bodySpan<config.endingBodySpan;
  }
  // Keep the last stable sample in each segment. Require a second changed
  // sample so one transient menu/pointer frame does not create a new slide.
  class SceneDetector {
    constructor(threshold=DETECTION_DEFAULTS.threshold,confirmations=DETECTION_DEFAULTS.confirmations) { this.threshold=threshold;this.confirmations=confirmations;this.current=null;this.pending=null;this.segments=[]; }
    push(time, desc) {
      const sample={time, pixels:desc.pixels, ink:desc.ink};
      if(!this.current){ this.current={start:time,last:sample,anchor:sample};return; }
      if(difference(this.current.anchor.pixels,sample.pixels)>this.threshold){
        if(!this.pending||difference(this.pending.pixels,sample.pixels)>this.threshold)this.pending={...sample,count:1,last:sample};
        else{this.pending.count++;this.pending.last=sample;}
        if(this.pending.count<this.confirmations)return;
        this.finishCurrent(this.pending.time);
        this.current={start:this.pending.time,anchor:this.pending,last:sample}; this.pending=null;
      }else{this.pending=null;this.current.last=sample;}
    }
    finishCurrent(end) {
      const c=this.current;
      this.segments.push({start:c.start,end,chosenTime:c.last.time,signature:Array.from(c.last.pixels),ink:c.last.ink});
    }
    finish(duration) {
      if(!this.current)return [];
      // A lone final changed sample remains a distinct candidate for review.
      if(this.pending && duration-this.pending.time>=0.5){
        this.finishCurrent(this.pending.time);
        this.current={start:this.pending.time,anchor:this.pending,last:this.pending.last};
      }
      this.finishCurrent(duration);this.current=null;this.pending=null;
      return this.segments;
    }
  }
  function groupSegments(segments,tolerance=DETECTION_DEFAULTS.mergeTolerance) {
    const groups=[];
    for(const seg of segments){
      const match=groups.find(g=>difference(g.signature,seg.signature)<tolerance);
      if(match){
        match.segments.push({start:seg.start,end:seg.end});
        // More foreground usually retains additional handwriting; this is a
        // candidate heuristic. Every representative can be replaced manually.
        if(seg.ink>=match.ink-0.0005){match.chosenTime=seg.chosenTime;match.signature=seg.signature;match.ink=seg.ink;}
      }else groups.push({...seg,segments:[{start:seg.start,end:seg.end}]});
    }
    return groups;
  }
  function blankSlide(kind='original') {
    return {id:uid(),kind,title:'',notes:'',notesFormat:'markdown',speakerNotes:'',included:true,image:null,width:0,height:0,time:null,startTime:null,segments:[],pairId:null,autoExcludedReason:null};
  }
  function splitExerciseFrames(solution,image,time,width,height) {
    const pairId=solution.pairId||uid();
    // Never copy solution annotations into a question page.
    const question={...blankSlide('question'),pairId,title:'문제',image,time,startTime:slideStart(solution),width,height,segments:solution.segments.map(s=>({...s}))};
    return {question,solution:{...solution,kind:'solution',pairId}};
  }
  function validateWorkspace(data) {
    if(!data || data.format!=='lecture-slide-studio' || ![1,VERSION].includes(data.version) || !Array.isArray(data.slides)) throw new Error('브라우저에 저장된 노트를 읽을 수 없습니다.');
    if(data.slides.length>1000) throw new Error('저장한 화면이 1,000페이지를 넘습니다.');
    const ids=new Set();
    const slides=data.slides.map((s,i)=>{
      if(!s || !Object.hasOwn(KINDS,s.kind))throw new Error(`${i+1}페이지의 종류가 올바르지 않습니다.`);
      if(typeof s.id!=='string'||ids.has(s.id))throw new Error('페이지 ID가 중복되거나 없습니다.');ids.add(s.id);
      for(const key of ['title','notes','speakerNotes'])if(typeof s[key]!=='string'||s[key].length>100000)throw new Error('노트 형식이 올바르지 않습니다.');
      if(s.image!==null && (typeof s.image!=='string'|| !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s.image))) throw new Error('화면에는 PNG 또는 JPEG 이미지가 필요합니다.');
      if(s.image && (!Number.isFinite(s.width)||!Number.isFinite(s.height)||s.width<1||s.height<1||s.width>20000||s.height>20000))throw new Error('이미지 크기가 올바르지 않습니다.');
      if(s.time!==null&&(!Number.isFinite(s.time)||s.time<0))throw new Error('화면 시각이 올바르지 않습니다.');
      if(s.startTime!==undefined&&s.startTime!==null&&(!Number.isFinite(s.startTime)||s.startTime<0))throw new Error('슬라이드 시작 시각이 올바르지 않습니다.');
      if(!Array.isArray(s.segments)||s.segments.some(v=>!v||!Number.isFinite(v.start)||!Number.isFinite(v.end)||v.start<0||v.end<v.start))throw new Error('영상 구간이 올바르지 않습니다.');
      return {...blankSlide(),id:s.id,kind:s.kind,title:s.title,notes:s.notes,notesFormat:s.notesFormat==='markdown'?'markdown':'plain',speakerNotes:s.speakerNotes,image:s.image,width:s.width,height:s.height,time:s.time,startTime:s.startTime??null,segments:s.segments.map(v=>({start:v.start,end:v.end})),included:s.included!==false,pairId:typeof s.pairId==='string'?s.pairId:null,autoExcludedReason:typeof s.autoExcludedReason==='string'?s.autoExcludedReason.slice(0,200):null};
    });
    const video=data.video && typeof data.video.name==='string' && Number.isFinite(data.video.duration) && Number.isFinite(data.video.width) && Number.isFinite(data.video.height) ? {...data.video}:null;
    const crop=video?cropBounds(data.crop,video.width,video.height):null;
    return {format:data.format,version:VERSION,title:typeof data.title==='string'?data.title.slice(0,200):'강의자료',video,crop,slides};
  }
  function workspaceState(slides,title,video,crop) {return {format:'lecture-slide-studio',version:VERSION,title,video,crop,slides,savedAt:new Date().toISOString()};}
  function slideStart(slide){
    if(slide.kind==='supplement'&&!slide.image)return null;
    if(Number.isFinite(slide.startTime)&&slide.startTime>=0)return slide.startTime;
    const starts=(slide.segments||[]).map(s=>s.start).filter(Number.isFinite);
    return starts.length?Math.min(...starts):Number.isFinite(slide.time)?slide.time:null;
  }
  function documentBlocks(doc){
    const blocks=[];
    function inline(nodes){
      return(nodes||[]).flatMap(node=>{
        if(node.type==='hardBreak')return[{text:'\n'}];
        if(node.type!=='text')return inline(node.content);
        const run={text:String(node.text||'').normalize('NFC')};
        for(const mark of node.marks||[]){
          if(['bold','italic','strike','code'].includes(mark.type))run[mark.type]=true;
          if(mark.type==='link'&&/^(https?:\/\/|mailto:)/i.test(mark.attrs?.href||''))run.href=mark.attrs.href;
        }
        return[run];
      });
    }
    function walk(nodes,context={}){
      for(const node of nodes||[]){
        if(['bulletList','orderedList','taskList'].includes(node.type)){
          let number=Number(node.attrs?.start)||1;
          for(const item of node.content||[]){
            const prefix=node.type==='orderedList'?`${number++}. `:node.type==='taskList'?(item.attrs?.checked?'[x] ':'[ ] '):'• ';
            const children=item.content||[];walk(children,{...context,depth:(context.depth||0)+1,prefix});
          }
        }else if(node.type==='blockquote')walk(node.content,{...context,quote:true});
        else if(['doc','listItem','taskItem'].includes(node.type))walk(node.content,context);
        else if(node.type==='horizontalRule')blocks.push({type:'rule',...context});
        else if(['paragraph','heading','codeBlock'].includes(node.type)){
          blocks.push({type:node.type,level:node.attrs?.level||1,runs:inline(node.content),...context});
          if(context.prefix)context={...context,prefix:''};
        }
      }
    }
    walk(doc?.content);return blocks;
  }
  function noteTitle(doc){return documentBlocks(doc).map(b=>(b.runs||[]).map(r=>r.text).join('')).find(t=>t.trim())?.trim().slice(0,100)||'';}
  function wrapRichText(runs,measure,maxWidth){
    const lines=[];let line=[],width=0;
    const flush=()=>{lines.push(line);line=[];width=0;};
    for(const source of runs){
      const {text,...style}=source;
      for(const ch of Array.from(String(text).normalize('NFC'))){
        if(ch==='\n'){flush();continue;}
        const w=measure(ch,style);
        if(line.length&&width+w>maxWidth)flush();
        const last=line.at(-1),key=JSON.stringify(style);
        if(last&&last._key===key)last.text+=ch;else line.push({...style,text:ch,_key:key});width+=w;
      }
    }
    if(line.length||!lines.length)flush();
    return lines.map(row=>row.map(({_key,...run})=>run));
  }
  function wrapText(text,measure,maxWidth){
    const lines=[];
    for(const paragraph of String(text).normalize('NFC').replace(/\r/g,'').replace(/\t/g,'    ').split('\n')){
      if(!paragraph){lines.push('');continue;}
      let line='';
      for(const ch of Array.from(paragraph)){
        if(line && measure(line+ch)>maxWidth){lines.push(line.trimEnd());line=ch.trimStart();}else line+=ch;
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }
  function contain(w,h,x,y,maxW,maxH){const scale=Math.min(maxW/w,maxH/h);return{x:x+(maxW-w*scale)/2,y:y+(maxH-h*scale)/2,w:w*scale,h:h*scale};}
  return {VERSION,KINDS,DETECTION_DEFAULTS,uid,timecode,parseTime,cropBounds,descriptor,difference,detectBlackMargins,layoutStats,isSparseEnding,SceneDetector,groupSegments,blankSlide,splitExerciseFrames,validateWorkspace,workspaceState,slideStart,documentBlocks,noteTitle,wrapRichText,wrapText,contain};
});
