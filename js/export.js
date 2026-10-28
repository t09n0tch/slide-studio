/* Native, offline PPTX/PDF output from the same Markdown block layout. */
(function(root){
 'use strict';
 const C=root.StudioCore,N=root.StudioNotes,INK='17353D',TEAL='15869A',MUTED='647A7F';
 const fontCache={};
 function bytes(key){if(!fontCache[key])fontCache[key]=Uint8Array.from(atob(root[key]),ch=>ch.charCodeAt(0));return fontCache[key];}
 function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
 const basename=name=>(name||'강의자료').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,100);
 async function prepare(state){
  if(!root.PDFLib||!root.fontkit||!N||!root.STUDIO_FONT_BOLD_BASE64)throw new Error('내보내기 파일을 읽지 못했습니다. vendor 폴더를 실행 파일과 함께 보관해 주세요.');
  const pdf=await root.PDFLib.PDFDocument.create();pdf.registerFontkit(root.fontkit);
  // Full static TrueType fonts avoid composite-glyph subsetting bugs in fontkit1.1.1.
  // Direct cmap glyphs keep contextual alternate spaces out of pdf-lib's width cache.
  const features=Object.fromEntries(['aalt','calt','ccmp','dlig','fwid','hist','hwid','liga','pwid','ruby','vert','vrt2','halt','kern','mark','palt','vhal','vkrn','vpal'].map(k=>[k,false]));
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
    else out.push({...style,text:ch,font,fontFace:font===face.main?'Noto Sans KR':'Noto Sans'});
   }
   return out;
  }
  const widths=new Map();
  function measure(text,size,style={}){const key=`${size}:${style.bold?'b':'r'}:${text}`;if(!widths.has(key))widths.set(key,runs(text,style).reduce((sum,r)=>sum+r.font.widthOfTextAtSize(r.text,size*.75)/.75,0));return widths.get(key);}
  const pages=[];
  for(const slide of state.slides.filter(s=>s.included)){
   if(slide.kind!=='supplement'&&!slide.image)throw new Error('화면이 없는 페이지가 있습니다. 현재 영상에서 화면을 지정하거나 내보내기에서 제외해 주세요.');
   const hasImage=!!slide.image,x=hasImage?1480:100,width=hasImage?400:1720,bodySize=hasImage?30:42;
   const blocks=C.documentBlocks(N.parse(N.legacyMarkdown(slide))),chunks=[[]];let y=130;
   const current=()=>chunks.at(-1),ensure=height=>{if(y+height>955&&current().length){chunks.push([]);y=130;}};
   for(const block of blocks){
    if(block.type==='rule'){ensure(40);current().push({type:'rule',x,y:y+17,width,color:'D3DED4'});y+=40;continue;}
    const heading=block.type==='heading',codeBlock=block.type==='codeBlock';
    const size=heading?(hasImage?[40,36,32]:[62,52,46])[Math.min(2,Math.max(0,block.level-1))]:bodySize;
    const lineHeight=size*1.45,indent=Math.max(0,(block.depth||1)-1)*(hasImage?23:34)+(block.quote?20:0),prefix=block.prefix||'';
    const prefixWidth=prefix?measure(prefix,size):0,textX=x+indent+prefixWidth,textWidth=Math.max(70,width-indent-prefixWidth);
    const content=(block.runs||[]).map(r=>({...r,bold:heading||!!r.bold,code:codeBlock||!!r.code}));
    const lines=C.wrapRichText(content,(text,style)=>measure(text,size,style),textWidth);
    const before=current().length?(heading?18:codeBlock?10:0):0;ensure(before+lineHeight);y+=before;
    lines.forEach((line,i)=>{
     ensure(lineHeight);
     if(codeBlock)current().push({type:'background',x:x+indent-5,y:y-2,width:width-indent+10,height:lineHeight+2,color:'EEF3EA'});
     if(block.quote)current().push({type:'quote',x:x+indent-15,y:y-1,height:lineHeight,color:'8AA99E'});
     if(prefix&&i===0)current().push({type:'text',x:x+indent,y,size,width:prefixWidth,runs:[{text:prefix}]});
     current().push({type:'text',x:textX,y,size,width:textWidth,runs:line});
     y+=lineHeight;
    });
    y+=heading?13:block.depth?9:16;
   }
   chunks.forEach((items,i)=>pages.push({slide,hasImage,items,continuation:i+1,total:chunks.length}));
  }
  if(!pages.length)throw new Error('내보낼 페이지를 한 장 이상 선택해 주세요.');
  return{pdf,pages,runs};
 }
 function layout(page,number){
  const x=page.hasImage?1480:100,width=page.hasImage?400:1720,label=page.slide.kind==='question'?'직접 풀기':page.slide.kind==='solution'?'풀이와 해설':page.slide.kind==='supplement'?'보충 설명':'강의 노트';
  const start=C.slideStart(page.slide),header=label+(page.total>1?` · ${page.continuation}/${page.total}`:'');
  return[{type:'text',x,y:48,width,size:30,runs:[{text:header,bold:true,color:TEAL}]},...page.items,{type:'text',x,y:1000,width,size:23,runs:[{text:start===null?'보충 설명':`강의 시작 ${C.timecode(start,true)}`,color:MUTED}]},{type:'text',x:1810,y:1000,width:80,size:23,runs:[{text:String(number).padStart(2,'0'),color:MUTED}]}];
 }
 async function toPptx(state){
  const {pages,runs}=await prepare(state),P=root.PptxGenJS||root.pptxgen;if(!P)throw new Error('PPTX 내보내기 라이브러리를 읽지 못했습니다.');
  const pptx=new P();pptx.defineLayout({name:'LECTURE',width:20,height:11.25});pptx.layout='LECTURE';pptx.author='Lecture Slide Studio';pptx.subject='원본 화면과 서식이 있는 강의노트';pptx.title=state.title;pptx.lang='ko-KR';pptx.theme={headFontFace:'Noto Sans KR',bodyFontFace:'Noto Sans KR',lang:'ko-KR'};
  for(const [i,p]of pages.entries()){
   const slide=pptx.addSlide();slide.background={color:p.hasImage?'FFFFFF':'F7FAFA'};
   if(p.hasImage){const box=C.contain(p.slide.width,p.slide.height,0,0,1440,1080);slide.addImage({data:p.slide.image,x:box.x/96,y:box.y/96,w:box.w/96,h:box.h/96,altText:`강의 시작 ${C.timecode(C.slideStart(p.slide)||0,true)}`});slide.addShape(pptx.ShapeType.line,{x:15,y:0,w:0,h:11.25,line:{color:'D3E1E4',width:1}});}
   for(const item of layout(p,i+1)){
    if(item.type==='background'){slide.addShape(pptx.ShapeType.rect,{x:item.x/96,y:item.y/96,w:item.width/96,h:item.height/96,fill:{color:item.color},line:{color:item.color,transparency:100}});continue;}
    if(item.type==='rule'||item.type==='quote'){slide.addShape(pptx.ShapeType.line,{x:item.x/96,y:item.y/96,w:item.type==='rule'?item.width/96:0,h:item.type==='quote'?item.height/96:0,line:{color:item.color,width:item.type==='quote'?2:1}});continue;}
    if(!item.runs.length)continue;
    const rich=item.runs.flatMap(style=>runs(style.text,style).map(r=>({text:r.text,options:{fontFace:r.fontFace,bold:!!r.bold,italic:!!r.italic,strike:!!r.strike,color:r.color||(r.href?TEAL:INK),...(r.code?{highlight:'EEF3EA'}:{}),...(r.href?{hyperlink:{url:r.href},underline:{style:'sng'}}:{})}})));
    slide.addText(rich,{x:item.x/96,y:item.y/96,w:item.width/96,h:item.size*1.4/96,fontFace:'Noto Sans KR',fontSize:item.size*.75,color:INK,margin:0,breakLine:false,vertAnchor:'top',paraSpaceAfterPt:0,wrap:false});
   }
   const start=C.slideStart(p.slide),notes=[p.slide.notes,p.slide.speakerNotes,state.video?`출처: ${state.video.name}`:'',start===null?'보충 설명':`강의 시작: ${C.timecode(start,true)}`,p.slide.time!==null?`캡처 시각: ${C.timecode(p.slide.time,true)}`:'',p.slide.segments.map(s=>`${C.timecode(s.start,true)}–${C.timecode(s.end,true)}`).join(', ')].filter(Boolean).join('\n\n');slide.addNotes(notes);
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
   if(p.hasImage){const image=p.slide.image.startsWith('data:image/png')?await pdf.embedPng(p.slide.image):await pdf.embedJpg(p.slide.image),box=C.contain(p.slide.width,p.slide.height,0,0,1440,1080);page.drawImage(image,{x:box.x*.75,y:810-(box.y+box.h)*.75,width:box.w*.75,height:box.h*.75});page.drawLine({start:{x:1080,y:0},end:{x:1080,y:810},thickness:1,color:rgb('D3E1E4')});}
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
 root.StudioExport={download,basename,toPptx,toPdf,prepare};
})(window);
