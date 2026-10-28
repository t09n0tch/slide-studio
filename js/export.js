/* Native, offline PPTX/PDF output from the same Markdown block layout. */
(function(root){
 'use strict';
 const C=root.StudioCore,N=root.StudioNotes,INK='263C36',TEAL='15869A',MUTED='647A7F';
 const fontCache={};
 function bytes(key){if(!fontCache[key])fontCache[key]=Uint8Array.from(atob(root[key]),ch=>ch.charCodeAt(0));return fontCache[key];}
 function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
 const basename=name=>(name||'강의자료').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,100);
 async function fontDocument(){
  if(!root.PDFLib||!root.fontkit||!N||!root.STUDIO_FONT_BOLD_BASE64)throw new Error('내보내기 파일을 읽지 못했습니다. vendor 폴더를 실행 파일과 함께 보관해 주세요.');
  const pdf=await root.PDFLib.PDFDocument.create();pdf.registerFontkit(root.fontkit);
  // Full static TrueType fonts avoid composite-glyph subsetting bugs in fontkit1.1.1.
  // Direct cmap glyphs keep contextual alternate spaces out of pdf-lib's width cache.
  // fontkit enables fraction features even in ordinary numbers. Some fonts
  // substitute colon.case, whose CID has no width in pdf-lib's cmap-based W
  // table. Disable every bundled optional feature so visible glyphs, widths,
  // measurement and the PDF's font dictionary all use the same direct cmap.
  const tags=new Set();for(const key of ['STUDIO_FONT_BASE64','STUDIO_FONT_BOLD_BASE64','STUDIO_LATIN_FONT_BASE64','STUDIO_LATIN_FONT_BOLD_BASE64'])for(const tag of root.fontkit.create(bytes(key)).availableFeatures)tags.add(tag);
  const features=Object.fromEntries([...tags].map(k=>[k,false]));
  const normal=await pdf.embedFont(bytes('STUDIO_FONT_BASE64'),{subset:false,features});
  const normalLatin=await pdf.embedFont(bytes('STUDIO_LATIN_FONT_BASE64'),{subset:false,features});
  const bold=await pdf.embedFont(bytes('STUDIO_FONT_BOLD_BASE64'),{subset:false,features});
  const boldLatin=await pdf.embedFont(bytes('STUDIO_LATIN_FONT_BOLD_BASE64'),{subset:false,features});
  const faces={normal:{main:normal,latin:normalLatin,mainSet:new Set(normal.getCharacterSet()),latinSet:new Set(normalLatin.getCharacterSet())},bold:{main:bold,latin:boldLatin,mainSet:new Set(bold.getCharacterSet()),latinSet:new Set(boldLatin.getCharacterSet())}};
  function runs(text,style={}){
   const face=style.bold?faces.bold:faces.normal,out=[];
   for(const ch of Array.from(String(text).normalize('NFC').replace(/\r/g,'').replace(/\t/g,'    '))){
    const cp=ch.codePointAt(0);if(cp===0xFE0F||cp===0xFE0E)continue;
    const font=face.mainSet.has(cp)?face.main:face.latinSet.has(cp)?face.latin:null;
    if(!font)throw new Error('출력 글꼴이 지원하지 않는 문자 '+ch+' (U+'+cp.toString(16).toUpperCase()+')가 있습니다. 해당 문자를 바꾼 뒤 다시 저장해 주세요.');
    if(out.length&&out.at(-1).font===font)out.at(-1).text+=ch;
    else out.push({...style,text:ch,font,fontFace:font===face.main?'Pretendard':'Noto Sans'});
   }
   return out;
  }
  const widths=new Map();
  function measure(text,size,style={}){const key=`${size}:${style.bold?'b':'r'}:${text}`;if(!widths.has(key))widths.set(key,runs(text,style).reduce((sum,r)=>sum+r.font.widthOfTextAtSize(r.text,size*.75)/.75,0));return widths.get(key);}
  return {pdf,runs,measure};
 }
 function noteArea(slide){const hasImage=!!slide.image;return{hasImage,x:hasImage?1456:64,width:hasImage?448:1792,top:hasImage?52:64,bottom:1000};}
 function notePlan(slide,measure){
  const area=noteArea(slide),{hasImage,x,width,top,bottom}=area,blocks=C.documentBlocks(N.parse(N.legacyMarkdown(slide)));
  function paginate(fontSize){
   const bodySize=fontSize/.75,chunks=[[]];let y=top;
   const current=()=>chunks.at(-1),ensure=height=>{if(y+height>bottom&&current().length){chunks.push([]);y=top;}};
   for(const block of blocks){
    if(block.type==='rule'){const height=bodySize*1.1;ensure(height);current().push({type:'rule',x,y:y+height/2,width,color:'D3DED4'});y+=height;continue;}
    const heading=block.type==='heading',codeBlock=block.type==='codeBlock';
    const size=heading?bodySize*[1.4,1.23,1.1][Math.min(2,Math.max(0,block.level-1))]:bodySize;
    const lineHeight=size*1.8,indent=Math.max(0,(block.depth||1)-1)*bodySize*.8+(block.quote?bodySize*.7:0),prefix=block.prefix||'';
    const prefixWidth=prefix?measure(prefix,size):0,textX=x+indent+prefixWidth,textWidth=Math.max(70,width-indent-prefixWidth);
    const content=(block.runs||[]).map(r=>({...r,bold:heading||!!r.bold,code:codeBlock||!!r.code}));
    const lines=C.wrapRichText(content,(text,style)=>measure(text,size,style),textWidth);
    const before=current().length?(heading?bodySize*.5:codeBlock?bodySize*.3:0):0;ensure(before+lineHeight);y+=before;
    lines.forEach((line,i)=>{
     ensure(lineHeight);
     if(codeBlock)current().push({type:'background',x:x+indent-5,y:y-2,width:width-indent+10,height:lineHeight+2,color:'EEF3EA'});
     if(block.quote)current().push({type:'quote',x:x+indent-15,y:y-1,height:lineHeight,color:'8AA99E'});
     if(prefix&&i===0)current().push({type:'text',x:x+indent,y,size,width:prefixWidth,runs:[{text:prefix}]});
     current().push({type:'text',x:textX,y,size,width:textWidth,runs:line});
     y+=lineHeight;
    });
    y+=bodySize*(heading ? .35 : block.depth ? .22 : .4);
   }
   return chunks;
  }
  let fontSize=Number.isFinite(slide.notesFontSize)?Math.max(8,Math.min(36,slide.notesFontSize)):null,chunks;
  if(fontSize===null){
   let low=(hasImage?10:14)*2,high=(hasImage?22.5:31.5)*2; fontSize=low/2;
   while(low<=high){const middle=Math.floor((low+high)/2),candidate=paginate(middle/2);if(candidate.length===1){fontSize=middle/2;low=middle+1;}else high=middle-1;}
  }
  chunks=paginate(fontSize);return {...area,fontSize,chunks,total:chunks.length};
 }
 let previewMetrics=null,previewFonts=null;
 async function loadFonts(){
  if(!previewFonts)previewFonts=Promise.all([
   ['Pretendard','STUDIO_FONT_BASE64','400'],['Pretendard','STUDIO_FONT_BOLD_BASE64','700'],['Noto Sans','STUDIO_LATIN_FONT_BASE64','400'],['Noto Sans','STUDIO_LATIN_FONT_BOLD_BASE64','700']
  ].map(async([family,key,weight])=>{const font=new FontFace(family,bytes(key),{weight});await font.load();document.fonts.add(font);})).catch(err=>{previewFonts=null;throw err;});
  await previewFonts;
 }
 async function previewPlan(slide){
  if(!previewMetrics)previewMetrics=fontDocument().catch(err=>{previewMetrics=null;throw err;});
  const metrics=await previewMetrics;await loadFonts();return notePlan(slide,metrics.measure);
 }
 async function prepare(state){
  const {pdf,runs,measure}=await fontDocument(),pages=[];
  for(const slide of state.slides.filter(s=>s.included)){
   if(slide.kind!=='supplement'&&!slide.image)throw new Error('화면이 없는 페이지가 있습니다. 현재 영상에서 화면을 지정하거나 내보내기에서 제외해 주세요.');
   if(slide.image&&slide.showNotes===false){pages.push({slide,hasImage:true,sourceOnly:true,items:[],continuation:1,total:1});continue;}
   const plan=notePlan(slide,measure);
   plan.chunks.forEach((items,i)=>pages.push({slide,hasImage:plan.hasImage,fontSize:plan.fontSize,items,continuation:i+1,total:plan.total}));
  }
  if(!pages.length)throw new Error('내보낼 페이지를 한 장 이상 선택해 주세요.');
  return{pdf,pages,runs};
 }
 function layout(page,number){
  if(page.sourceOnly)return[{type:'text',x:24,y:1030,width:1680,size:18,runs:[{text:C.timestamp(C.slideStart(page.slide)||0),color:MUTED}]},{type:'text',x:1840,y:1030,width:64,size:18,runs:[{text:String(number).padStart(2,'0'),color:MUTED}]}];
  const {x,width}=noteArea(page.slide),label=page.slide.kind==='question'?'직접 풀기':page.slide.kind==='solution'?'풀이와 해설':page.slide.kind==='supplement'?'보충 설명':'강의 노트';
  const start=C.slideStart(page.slide),header=label+(page.total>1?` · ${page.continuation}/${page.total}`:'');
  return[{type:'text',x,y:12,width,size:18,runs:[{text:header,color:TEAL}]},...page.items,{type:'text',x,y:1030,width,size:18,runs:[{text:start===null?'보충 설명':C.timestamp(start),color:MUTED}]},{type:'text',x:1840,y:1030,width:64,size:18,runs:[{text:String(number).padStart(2,'0'),color:MUTED}]}];
 }
 async function thumbnail(slide,number){
  const plan=await previewPlan(slide),metrics=await previewMetrics;
  const page={slide,hasImage:plan.hasImage,items:plan.chunks[0],continuation:1,total:plan.total};
  const canvas=document.createElement('canvas');canvas.width=480;canvas.height=270;const ctx=canvas.getContext('2d');ctx.scale(.25,.25);ctx.fillStyle='#F7FAFA';ctx.fillRect(0,0,1920,1080);ctx.textBaseline='alphabetic';ctx.fontKerning='none';
  for(const item of layout(page,number)){
   ctx.fillStyle='#'+(item.color||INK);ctx.strokeStyle=ctx.fillStyle;
   if(item.type==='background'){ctx.fillRect(item.x,item.y,item.width,item.height);continue;}
   if(item.type==='rule'||item.type==='quote'){ctx.lineWidth=item.type==='quote'?2:1;ctx.beginPath();ctx.moveTo(item.x,item.y);ctx.lineTo(item.x+(item.width||0),item.y+(item.height||0));ctx.stroke();continue;}
   let x=item.x;const baseline=item.y+item.size;
   for(const style of item.runs)for(const run of metrics.runs(style.text,style)){
    const width=run.font.widthOfTextAtSize(run.text,item.size*.75)/.75;
    if(run.code){ctx.fillStyle='#EEF3EA';ctx.fillRect(x-1,item.y,width+2,item.size*1.2);}
    ctx.font=`${run.italic?'italic':'normal'} ${run.bold?700:400} ${item.size}px "${run.fontFace}"`;ctx.fillStyle='#'+(run.color||(run.href?TEAL:INK));ctx.fillText(run.text,x,baseline);
    if(run.strike||run.href){const y=baseline+(run.strike?-item.size*.3:2);ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=.9;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+width,y);ctx.stroke();}x+=width;
   }
  }
  return canvas.toDataURL('image/png');
 }
 async function toPptx(state){
  const {pages,runs}=await prepare(state),P=root.PptxGenJS||root.pptxgen;if(!P)throw new Error('PPTX 내보내기 라이브러리를 읽지 못했습니다.');
  const pptx=new P();pptx.defineLayout({name:'LECTURE',width:20,height:11.25});pptx.layout='LECTURE';pptx.author='Lecture Slide Studio';pptx.subject='원본 화면과 서식이 있는 강의노트';pptx.title=state.title;pptx.lang='ko-KR';pptx.theme={headFontFace:'Pretendard',bodyFontFace:'Pretendard',lang:'ko-KR'};
  for(const [i,p]of pages.entries()){
   const slide=pptx.addSlide();slide.background={color:p.hasImage?'FFFFFF':'F7FAFA'};
   if(p.hasImage){const box=C.sourceBox(p.slide,p.sourceOnly);slide.addImage({data:p.slide.image,x:box.x/96,y:box.y/96,w:box.w/96,h:box.h/96,altText:`강의 시작 ${C.timestamp(C.slideStart(p.slide)||0)}`});if(!p.sourceOnly)slide.addShape(pptx.ShapeType.line,{x:15,y:0,w:0,h:11.25,line:{color:'D3E1E4',width:1}});}
   for(const item of layout(p,i+1)){
    if(item.type==='background'){slide.addShape(pptx.ShapeType.rect,{x:item.x/96,y:item.y/96,w:item.width/96,h:item.height/96,fill:{color:item.color},line:{color:item.color,transparency:100}});continue;}
    if(item.type==='rule'||item.type==='quote'){slide.addShape(pptx.ShapeType.line,{x:item.x/96,y:item.y/96,w:item.type==='rule'?item.width/96:0,h:item.type==='quote'?item.height/96:0,line:{color:item.color,width:item.type==='quote'?2:1}});continue;}
    if(!item.runs.length)continue;
    const rich=item.runs.flatMap(style=>runs(style.text,style).map(r=>({text:r.text,options:{fontFace:r.fontFace,bold:!!r.bold,italic:!!r.italic,strike:!!r.strike,color:r.color||(r.href?TEAL:INK),...(r.code?{highlight:'EEF3EA'}:{}),...(r.href?{hyperlink:{url:r.href},underline:{style:'sng'}}:{})}})));
    slide.addText(rich,{x:item.x/96,y:item.y/96,w:item.width/96,h:item.size*1.4/96,fontFace:'Pretendard',fontSize:item.size*.75,color:INK,margin:0,breakLine:false,vertAnchor:'top',paraSpaceAfterPt:0,wrap:false});
   }
   const start=C.slideStart(p.slide),notes=[p.slide.notes,p.slide.speakerNotes,state.video?`출처: ${state.video.name}`:'',start===null?'보충 설명':`강의 시작: ${C.timestamp(start)}`,p.slide.time!==null?`캡처 시각: ${C.timestamp(p.slide.time)}`:'',p.slide.segments.map(s=>`${C.timestamp(s.start)}–${C.timestamp(s.end)}`).join(', ')].filter(Boolean).join('\n\n');slide.addNotes(notes);
  }
  // PptxGenJS4.0.1 declares absent extra masters: keep only actual package parts.
  const generated=await pptx.write({outputType:'blob',compression:true}),zip=await root.JSZip.loadAsync(await generated.arrayBuffer());
  const manifest=new DOMParser().parseFromString(await zip.file('[Content_Types].xml').async('string'),'application/xml');
  for(const node of Array.from(manifest.getElementsByTagName('Override'))){const name=node.getAttribute('PartName').replace(/^\//,'');if(!zip.file(name)){if(!/^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(name))throw new Error('PPTX의 필수 구성 파일이 없습니다: '+name);node.remove();}}
  zip.file('[Content_Types].xml',new XMLSerializer().serializeToString(manifest));
  return{blob:await zip.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation'}),count:pages.length};
 }
 async function toPdf(state){
  const{pdf,pages,runs}=await prepare(state),rgb=hex=>{const n=parseInt(hex,16);return root.PDFLib.rgb((n>>16&255)/255,(n>>8&255)/255,(n&255)/255);};
  for(const[i,p]of pages.entries()){
   const page=pdf.addPage([1440,810]);page.drawRectangle({x:0,y:0,width:1440,height:810,color:rgb(p.hasImage?'FFFFFF':'F7FAFA')});
   if(p.hasImage){const image=p.slide.image.startsWith('data:image/png')?await pdf.embedPng(p.slide.image):await pdf.embedJpg(p.slide.image),box=C.sourceBox(p.slide,p.sourceOnly);page.drawImage(image,{x:box.x*.75,y:810-(box.y+box.h)*.75,width:box.w*.75,height:box.h*.75});if(!p.sourceOnly)page.drawLine({start:{x:1080,y:0},end:{x:1080,y:810},thickness:1,color:rgb('D3E1E4')});}
   for(const item of layout(p,i+1)){
    if(item.type==='background'){page.drawRectangle({x:item.x*.75,y:810-(item.y+item.height)*.75,width:item.width*.75,height:item.height*.75,color:rgb(item.color)});continue;}
    if(item.type==='rule'||item.type==='quote'){page.drawLine({start:{x:item.x*.75,y:810-item.y*.75},end:{x:(item.x+(item.width||0))*.75,y:810-(item.y+(item.height||0))*.75},thickness:item.type==='quote'?2:1,color:rgb(item.color)});continue;}
    let x=item.x*.75;const baseline=810-(item.y+item.size)*.75;
    for(const style of item.runs)for(const r of runs(style.text,style)){
     const size=item.size*.75,width=r.font.widthOfTextAtSize(r.text,size),color=rgb(r.color||(r.href?TEAL:INK));
     if(r.code)page.drawRectangle({x:x-1,y:baseline-size*.20,width:width+2,height:size*1.2,color:rgb('EEF3EA')});
     page.drawText(r.text,{x,y:baseline,size,font:r.font,color,ySkew:root.PDFLib.degrees(r.italic?12:0)});
     if(r.strike||r.href){const y=baseline+(r.strike?size*.3:-2);page.drawLine({start:{x,y},end:{x:x+width,y},thickness:.7,color});}
     x+=width;
    }
   }
  }
  pdf.setTitle(state.title);pdf.setAuthor('Lecture Slide Studio');const output=await pdf.save();return{blob:new Blob([output],{type:'application/pdf'}),count:pages.length};
 }
 root.StudioExport={download,basename,toPptx,toPdf,prepare,previewPlan,loadFonts,thumbnail};
})(window);
