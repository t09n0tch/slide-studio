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
  const DETECTION_PRESETS=Object.freeze({
    detailed:{threshold:.025,description:'작은 화면 변화도 별도 페이지로 찾습니다. 같은 슬라이드가 여러 장 생길 수 있습니다.'},
    balanced:{threshold:DETECTION_DEFAULTS.threshold,description:'일반적인 슬라이드 전환을 찾습니다. 처음에는 이 설정으로 시작하세요.'},
    distinct:{threshold:.060,description:'화면이 크게 바뀔 때만 나눕니다. 비슷한 슬라이드나 짧게 나온 화면을 놓칠 수 있습니다.'}
  });
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
  function timestamp(seconds){const n=Math.max(0,Math.floor(Number(seconds)||0));return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
  function insertionIndex(rects,y){const index=rects.findIndex(r=>y<(r.top+r.bottom)/2);return index<0?rects.length:index;}
  function dragCrop(initial,mode,handle,start,point,width,height){
    const clamp=(n,min,max)=>Math.min(max,Math.max(min,n)),dx=point.x-start.x,dy=point.y-start.y;
    let left=initial.x,top=initial.y,right=left+initial.width,bottom=top+initial.height;
    if(mode==='move'){left=clamp(left+dx,0,width-initial.width);top=clamp(top+dy,0,height-initial.height);return cropBounds({...initial,x:left,y:top},width,height);}
    if(mode==='create'){
      left=clamp(Math.min(start.x,point.x),0,width-8);top=clamp(Math.min(start.y,point.y),0,height-8);
      right=clamp(Math.max(start.x,point.x),left+8,width);bottom=clamp(Math.max(start.y,point.y),top+8,height);
    }else{
      if(handle.includes('w'))left=clamp(left+dx,0,right-8);if(handle.includes('e'))right=clamp(right+dx,left+8,width);
      if(handle.includes('n'))top=clamp(top+dy,0,bottom-8);if(handle.includes('s'))bottom=clamp(bottom+dy,top+8,height);
    }
    left=Math.round(left);top=Math.round(top);right=Math.round(right);bottom=Math.round(bottom);
    return cropBounds({x:left,y:top,width:right-left,height:bottom-top},width,height);
  }
  // Tolerances use source pixels; the UI converts an eight-pixel screen gap.
  // Moving preserves size and resizing preserves the opposite edge.
  function snapCrop(box,mode,handle,start,point,targets,width,height,tolerance){
    let left=box.x,right=left+box.width,top=box.y,bottom=top+box.height;const guides=[];
    const edges=mode==='create'?(point.x<start.x?'w':'e')+(point.y<start.y?'n':'s'):handle;
    for(const axis of ['x','y']){
      const horizontal=axis==='x',low=horizontal?left:top,high=horizontal?right:bottom,limit=horizontal?width:height;
      const controlled=mode==='move'?[['low',low],['high',high]]:[];
      if(mode!=='move'){if(edges.includes(horizontal?'w':'n'))controlled.push(['low',low]);if(edges.includes(horizontal?'e':'s'))controlled.push(['high',high]);}
      const matches=[];
      for(const [edge,value]of controlled)for(const target of targets.filter(t=>t.axis===axis)){
        const delta=target.value-value;if(Math.abs(delta)>tolerance[axis])continue;
        const nextLow=mode==='move'||edge==='low'?low+delta:low,nextHigh=mode==='move'||edge==='high'?high+delta:high;
        if(nextLow<0||nextHigh>limit||nextHigh-nextLow<8)continue;
        matches.push({edge,delta,target});
      }
      matches.sort((a,b)=>Math.abs(a.delta)-Math.abs(b.delta));const match=matches[0];if(!match)continue;
      if(horizontal){if(mode==='move'||match.edge==='low')left+=match.delta;if(mode==='move'||match.edge==='high')right+=match.delta;}
      else{if(mode==='move'||match.edge==='low')top+=match.delta;if(mode==='move'||match.edge==='high')bottom+=match.delta;}
      guides.push(match.target);
    }
    return{crop:cropBounds({x:left,y:top,width:right-left,height:bottom-top},width,height),guides};
  }
  // Leave a slim footer below source-only pages so metadata never covers ink.
  function sourceBox(slide,sourceOnly=false){return contain(slide.width,slide.height,0,0,sourceOnly?1920:1440,sourceOnly?1024:1080);}
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
    return {id:uid(),kind,title:'',notes:'',notesFormat:'markdown',notesFontSize:null,speakerNotes:'',included:true,showNotes:true,image:null,width:0,height:0,time:null,startTime:null,segments:[],pairId:null,autoExcludedReason:null,ai:null};
  }
  function duplicateSlide(slide) {
    const id=uid();
    return {...slide,id,title:(slide.title||KINDS[slide.kind]||'슬라이드').slice(0,95)+' (복사)',segments:slide.segments.map(s=>({...s})),pairId:null,ai:slide.ai?{...slide.ai,sourceId:slide.ai.sourceId===slide.id?id:slide.ai.sourceId}:null};
  }
  function restoreSlideHistory(current,from,to) {
    const currentById=new Map(current.map(s=>[s.id,s])),fromById=new Map(from.map(s=>[s.id,s]));
    return to.map(target=>{
      const existing=currentById.get(target.id),source=fromById.get(target.id);
      const result={...(existing&&source?existing:target)};
      // Undo the recorded operation without discarding later edits to other fields.
      if(existing&&source)for(const key of new Set([...Object.keys(source),...Object.keys(target)])){
        if(source[key]===target[key]||JSON.stringify(source[key])===JSON.stringify(target[key]))continue;
        if(Object.hasOwn(target,key))result[key]=target[key];else delete result[key];
      }
      result.segments=result.segments.map(s=>({...s}));result.ai=result.ai?{...result.ai}:null;
      return result;
    });
  }
  function splitExerciseFrames(solution,image,time,width,height) {
    const pairId=solution.pairId||uid();
    // Never copy solution annotations into a question page.
    const question={...blankSlide('question'),pairId,title:'문제',image,time,startTime:slideStart(solution),width,height,segments:solution.segments.map(s=>({...s}))};
    return {question,solution:{...solution,kind:'solution',pairId}};
  }
  function verifyExtraction(slides,duration,interval=1){
    const ids=new Set();let corrected=0;
    const checked=slides.map((slide,index)=>{
      if(ids.has(slide.id))throw new Error('추출한 페이지 ID가 중복되어 목록을 추가하지 않았습니다.');ids.add(slide.id);
      const segments=(slide.segments||[]).map(s=>({...s})).sort((a,b)=>a.start-b.start);
      if(!segments.length||segments.some(s=>!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<s.start||s.end>duration+.1))throw new Error('영상 구간을 확인하지 못한 페이지가 있어 추출 결과를 추가하지 않았습니다.');
      if(!Number.isFinite(slide.time)||!segments.some(s=>slide.time>=s.start-.1&&slide.time<=s.end+.1))throw new Error('캡처 시각과 원본 영상 구간이 맞지 않습니다. 구간을 나누어 다시 추출해 주세요.');
      const first=segments[0],start=slide.startTime,valid=Number.isFinite(start)&&start>=Math.max(0,first.start-interval-.1)&&start<=Math.min(first.end,first.start+.1);
      if(!valid)corrected++;
      return {slide:{...slide,segments,startTime:valid?start:first.start},first:first.start,index};
    });
    const pairOrder=s=>s.kind==='question'?0:s.kind==='solution'?1:2;
    checked.sort((a,b)=>a.first-b.first||a.slide.startTime-b.slide.startTime||(a.slide.pairId&&a.slide.pairId===b.slide.pairId?pairOrder(a.slide)-pairOrder(b.slide):0)||a.index-b.index);
    for(let i=1;i<checked.length;i++)if(checked[i].slide.startTime<checked[i-1].slide.startTime){checked[i].slide.startTime=checked[i].first;corrected++;}
    return {slides:checked.map(s=>s.slide),corrected,reordered:checked.some((s,i)=>s.index!==i)};
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
      const ai=s.ai&&typeof s.ai.requestId==='string'&&s.ai.requestId.length<=100&&['paid','manual','service'].includes(s.ai.mode)&&typeof s.ai.sourceId==='string'?{requestId:s.ai.requestId,mode:s.ai.mode,sourceId:s.ai.sourceId,...(typeof s.ai.speechFingerprint==='string'&&s.ai.speechFingerprint.length<100?{speechFingerprint:s.ai.speechFingerprint}:{})}:null;
      return {...blankSlide(),id:s.id,kind:s.kind,title:s.title,notes:s.notes,notesFormat:s.notesFormat==='markdown'?'markdown':'plain',notesFontSize:Number.isFinite(s.notesFontSize)&&s.notesFontSize>=8&&s.notesFontSize<=36?s.notesFontSize:null,speakerNotes:s.speakerNotes,image:s.image,width:s.width,height:s.height,time:s.time,startTime:s.startTime??null,segments:s.segments.map(v=>({start:v.start,end:v.end})),included:s.included!==false,showNotes:s.showNotes!==false,pairId:typeof s.pairId==='string'?s.pairId:null,autoExcludedReason:typeof s.autoExcludedReason==='string'?s.autoExcludedReason.slice(0,200):null,ai};
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
    const flush=()=>{const row=[];for(const atom of line){const last=row.at(-1);if(last&&last._key===atom.key)last.text+=atom.ch;else row.push({...atom.style,text:atom.ch,_key:atom.key});}lines.push(row);line=[];width=0;};
    for(const source of runs){
      const {text,...style}=source,key=JSON.stringify(style);
      for(const ch of Array.from(String(text).normalize('NFC'))){
        if(ch==='\n'){flush();continue;}
        const w=measure(ch,style);
        if(line.length&&width+w>maxWidth){
          // Prefer a word boundary, retaining every character and its marks.
          // Long words still split; punctuation never gets a line to itself.
          const boundary=line.findLastIndex(atom=>/\s/.test(atom.ch));
          let carry=[];
          if(boundary>0){const tail=line.slice(boundary+1),tailWidth=tail.reduce((n,a)=>n+a.width,0);if(tailWidth+w<=maxWidth){carry=tail;line=line.slice(0,boundary+1);}}
          if(!carry.length&&line.length>1&&(/[.,!?;:%…，。、！？)\]}〉》」』】”’]/.test(ch)||/[(\[{〈《「『【“‘]/.test(line.at(-1).ch))&&line.at(-1).width+w<=maxWidth)carry=[line.pop()];
          flush();line=carry;width=carry.reduce((n,a)=>n+a.width,0);
        }
        line.push({ch,width:w,style,key});width+=w;
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
  return {VERSION,KINDS,DETECTION_DEFAULTS,DETECTION_PRESETS,uid,timecode,timestamp,parseTime,cropBounds,dragCrop,snapCrop,sourceBox,insertionIndex,descriptor,difference,detectBlackMargins,layoutStats,isSparseEnding,SceneDetector,groupSegments,blankSlide,duplicateSlide,restoreSlideHistory,splitExerciseFrames,verifyExtraction,validateWorkspace,workspaceState,slideStart,documentBlocks,noteTitle,wrapRichText,wrapText,contain};
});
