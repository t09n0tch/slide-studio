const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../js/core.js');
function frame(level,marks=0){const pixels=new Uint8Array(300).fill(level);for(let i=0;i<marks*3;i++)pixels[i]=0;return{pixels,ink:marks/100};}
test('keeps final handwriting, ignores a transient screen, and finds the next page',()=>{
 const d=new C.SceneDetector(.055);d.push(0,frame(255));d.push(2,frame(255,1));d.push(4,frame(50));d.push(6,frame(255,2));d.push(8,frame(100));d.push(10,frame(100,1));d.push(12,frame(100,2));
 const s=d.finish(14);assert.equal(s.length,2);assert.equal(s[0].chosenTime,6);assert.equal(s[1].chosenTime,12);assert.deepEqual(s.map(v=>[v.start,v.end]),[[0,8],[8,14]]);
});
test('merging revisits preserves separate source intervals and the fuller frame',()=>{
 const original=frame(255,1),full=frame(255,2);
 const groups=C.groupSegments([{start:0,end:20,chosenTime:18,signature:Array.from(original.pixels),ink:.01},{start:20,end:40,chosenTime:38,signature:Array.from(frame(60).pixels),ink:.9},{start:60,end:80,chosenTime:78,signature:Array.from(full.pixels),ink:.02}],.03);
 assert.equal(groups.length,2);assert.equal(groups[0].chosenTime,78);assert.deepEqual(groups[0].segments,[{start:0,end:20},{start:60,end:80}]);
});
test('question pages have no copied answers in titles or note fields',()=>{
 const source={...C.blankSlide(),title:'정답은 메틸 에스터',notes:'정답은 메틸 에스터',speakerNotes:'상세한 정답',image:'data:image/png;base64,AA==',time:80,segments:[{start:10,end:90}]};
 const pair=C.splitExerciseFrames(source,'data:image/png;base64,AQ==',12,1440,1080);
 assert.equal(pair.question.title,'문제');assert.equal(pair.question.notes,'');assert.equal(pair.question.speakerNotes,'');assert.equal(pair.question.kind,'question');assert.equal(pair.solution.notes,source.notes);assert.notEqual(pair.question.id,pair.solution.id);assert.equal(pair.question.pairId,pair.solution.pairId);assert.equal(source.kind,'original');
});
test('saved notes round-trip, but active image URLs and invalid crops are rejected',()=>{
 const slide={...C.blankSlide('supplement'),title:'α와 β',notes:'한글 설명\n검산: C 수 1개 감소'};
 const p=C.workspaceState([slide],'강의',null,null);assert.equal(C.validateWorkspace(JSON.parse(JSON.stringify(p))).slides[0].notes,slide.notes);
 assert.throws(()=>C.validateWorkspace({...p,slides:[{...slide,image:'https://example.com/track.png',width:100,height:100}]}));
 assert.throws(()=>C.cropBounds({x:240,y:0,width:2000,height:1080},1920,1080));
 assert.throws(()=>C.validateWorkspace({...p,slides:[slide,{...slide}]}));
});
test('long Korean notes wrap without dropping characters',()=>{
 const input='이것은 긴 한글 설명입니다. ABC 123\n다음 줄 α β ⇌';const lines=C.wrapText(input,v=>Array.from(v).length*10,80);
 assert.equal(lines.join('').replace(/\s/g,''),input.replace(/\s/g,''));assert.ok(lines.every(v=>Array.from(v).length<=8));
});
test('time parsing and image fit keep source bounds',()=>{
 assert.equal(C.parseTime('01:02:03.5'),3723.5);assert.ok(Number.isNaN(C.parseTime('abc')));assert.equal(C.timecode(3723.5,true),'1:02:03.5');
 assert.deepEqual(C.contain(1920,1080,0,0,1440,1080),{x:0,y:135,w:1440,h:810});
});
test('source-only image fitting leaves an unobscured metadata footer',()=>{
 const slide={width:1920,height:1080},box=C.sourceBox(slide,true);
 assert.equal(box.y,0);assert.equal(box.h,1024);assert.ok(box.x>0);assert.ok(Math.abs(box.w/box.h-16/9)<1e-12);
 assert.ok(box.y+box.h<1030);assert.deepEqual(C.sourceBox(slide,false),C.contain(1920,1080,0,0,1440,1080));
});
test('crop magnets align controlled edges, preserve moving size, and reject invalid/outside matches',()=>{
 const targets=[{axis:'x',value:120,label:'content'},{axis:'x',value:0,label:'frame'},{axis:'y',value:30,label:'content'},{axis:'x',value:960,label:'frame'}];
 const snap=(box,mode,handle,start={x:0,y:0},point={x:100,y:100})=>C.snapCrop(box,mode,handle,start,point,targets,960,540,{x:8,y:8});
 const corner=snap({x:125,y:35,width:600,height:400},'resize','nw');assert.deepEqual(corner.crop,{x:120,y:30,width:605,height:405});assert.equal(corner.guides.length,2);
 const untouched=snap({x:125,y:35,width:600,height:400},'resize','se');assert.deepEqual(untouched.crop,{x:125,y:35,width:600,height:400});assert.equal(untouched.guides.length,0);
 const moved=snap({x:125,y:35,width:600,height:400},'move','');assert.deepEqual(moved.crop,{x:120,y:30,width:600,height:400});
 assert.equal(snap({x:130,y:80,width:600,height:400},'move','').guides.length,0);
 const narrow=snap({x:2,y:80,width:123,height:400},'resize','e');assert.equal(narrow.crop.width,118);
 assert.equal(snap({x:0,y:80,width:125,height:400},'move','').crop.x,0);
 const reverse=snap({x:125,y:35,width:600,height:400},'create','',{x:725,y:435},{x:125,y:35});assert.deepEqual(reverse.crop,corner.crop);
 assert.equal(snap({x:118,y:80,width:8,height:400},'resize','w').crop.width,8,'Snapping must not produce crops smaller than eight pixels.');
});
test('automatic crop ignores a black opening and retains borders used by any content frame',()=>{
 const w=100,h=60;
 function image(left,right){const rgba=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;rgba[i+3]=255;if(x>=left&&x<right)rgba[i]=rgba[i+1]=rgba[i+2]=255;}return rgba;}
 const dark=image(0,0),first=image(12,88),wider=image(10,90);
 // A small recorder button in the margin must not preserve the whole gutter.
 for(let y=4;y<9;y++)for(let x=95;x<99;x++){const i=(y*w+x)*4;first[i]=first[i+1]=first[i+2]=255;}
 assert.deepEqual(C.detectBlackMargins([dark,first,wider],w,h),{x:10,y:0,width:80,height:60});
 assert.deepEqual(C.detectBlackMargins([dark],w,h),{x:0,y:0,width:w,height:h});
 assert.deepEqual(C.detectBlackMargins([first,image(0,100)],w,h),{x:0,y:0,width:w,height:h});
});
test('two unrelated transient screens do not confirm each other as a stable page',()=>{
 const d=new C.SceneDetector(.03,2);d.push(0,frame(255));d.push(2,frame(60));d.push(4,frame(140));d.push(6,frame(255));
 const result=d.finish(8);assert.equal(result.length,1);assert.equal(result[0].chosenTime,6);
});
test('only a short, sparse final screen without a title is an ending candidate',()=>{
 const pixels=new Uint8Array(96*72*3).fill(255);
 const paint=(x,y,w,h,color)=>{for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)pixels.set(color,(row*96+col)*3);};
 paint(0,0,96,8,[22,132,153]);paint(12,34,70,2,[0,0,0]);
 const candidate={signature:pixels,segments:[{start:994,end:1000}]};
 assert.equal(C.isSparseEnding(candidate,1000),true);
 assert.equal(C.isSparseEnding({...candidate,segments:[{start:980,end:1000}]},1000),false);
 assert.equal(C.isSparseEnding(candidate,1200),false);
 paint(5,2,30,2,[0,0,0]);assert.equal(C.isSparseEnding(candidate,1000),false);
 const slide={...C.blankSlide(),included:false,autoExcludedReason:'자동 제외 · 마지막 화면'};
 assert.equal(C.validateWorkspace(C.workspaceState([slide],'강의',null,null)).slides[0].autoExcludedReason,slide.autoExcludedReason);
});
test('the exercise rule uses a large pale blue body panel, excluding the header',()=>{
 const pixels=new Uint8Array(96*72*3).fill(255);
 for(let y=0;y<8;y++)for(let x=0;x<96;x++)pixels.set([235,245,247],(y*96+x)*3);
 assert.equal(C.layoutStats(pixels).panelFraction,0);
 for(let y=20;y<40;y++)for(let x=8;x<80;x++)pixels.set([235,245,247],(y*96+x)*3);
 assert.ok(C.layoutStats(pixels).panelFraction>C.DETECTION_DEFAULTS.exercisePanelFraction);
});
test('display time uses the first slide appearance, independently of the captured handwriting frame',()=>{
 const slide={...C.blankSlide(),time:326.2,segments:[{start:100,end:254},{start:321,end:327}]};
 assert.equal(C.slideStart(slide),100);assert.equal(C.slideStart({...slide,startTime:99.82}),99.82);
 const pair=C.splitExerciseFrames({...slide,startTime:99.82},'data:image/png;base64,AA==',101,1440,1080);
 assert.equal(C.slideStart(pair.question),99.82);assert.equal(C.slideStart(pair.solution),99.82);
 assert.equal(C.slideStart(C.blankSlide('supplement')),null);
 assert.equal(C.slideStart({...C.blankSlide(),time:55}),55);
});
test('Markdown blocks preserve inline emphasis, nested numbering, tasks, and quote structure',()=>{
 const text=(value,marks=[])=>({type:'text',text:value,marks});
 const doc={type:'doc',content:[{type:'heading',attrs:{level:2},content:[text('카복실산')]},{type:'orderedList',attrs:{start:3},content:[{type:'listItem',content:[{type:'paragraph',content:[text('시약 ',[{type:'bold'}]),text('확인',[{type:'italic'}])]},{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[text('조건')]}]}]}]}]},{type:'taskList',content:[{type:'taskItem',attrs:{checked:true},content:[{type:'paragraph',content:[text('검산')]}]}]},{type:'blockquote',content:[{type:'paragraph',content:[text('중요한 원리')]}]}]};
 const blocks=C.documentBlocks(doc);assert.equal(C.noteTitle(doc),'카복실산');assert.equal(blocks[0].level,2);assert.equal(blocks[1].prefix,'3. ');assert.equal(blocks[1].runs[0].bold,true);assert.equal(blocks[1].runs[1].italic,true);assert.equal(blocks[2].prefix,'• ');assert.equal(blocks[2].depth,2);assert.equal(blocks[3].prefix,'[x] ');assert.equal(blocks[4].quote,true);
});
test('styled wrapping keeps every character and carries marks across page-width line breaks',()=>{
 const runs=[{text:'한글과 ',bold:true},{text:'α β ⇌ CO₂ R′ ',italic:true},{text:'여러 줄로 이어지는 설명입니다.'}];
 const measure=(text,style)=>Array.from(text).length*(style.bold?12:10);
 const lines=C.wrapRichText(runs,measure,70);
 assert.equal(lines.flat().map(r=>r.text).join(''),runs.map(r=>r.text).join(''));
 assert.ok(lines.every(line=>line.reduce((sum,r)=>sum+measure(r.text,r),0)<=70));
 assert.ok(lines[0][0].bold);assert.ok(lines.flat().some(r=>r.italic));
});
test('note wrapping prefers words and keeps closing punctuation with text across styled runs',()=>{
 const runs=[{text:'개념 설명을 '},{text:'정리합니다',bold:true},{text:'. VeryLongChemicalName(AB) 끝.'}],measure=text=>Array.from(text).length*10;
 const lines=C.wrapRichText(runs,measure,70),texts=lines.map(line=>line.map(run=>run.text).join(''));
 assert.equal(texts.join(''),runs.map(r=>r.text).join(''));assert.ok(!texts.some(t=>/^[.,!?;)\]}]+$/.test(t.trim())));
 assert.ok(lines.every(line=>line.reduce((n,run)=>n+measure(run.text),0)<=70));assert.ok(lines.flat().some(run=>run.bold));
 assert.deepEqual(C.wrapRichText([{text:'a\n\nb'}],measure,70).map(line=>line.map(run=>run.text).join('')),['a','','b']);
});
test('note visibility is per page, persists, and defaults to visible for older saved work',()=>{
 const hidden={...C.blankSlide(),showNotes:false,notes:'숨겨도 보관할 노트'},legacy=C.blankSlide();delete legacy.showNotes;
 const saved=C.validateWorkspace(JSON.parse(JSON.stringify(C.workspaceState([hidden,legacy],'강의',null,null))));
 assert.equal(saved.slides[0].showNotes,false);assert.equal(saved.slides[0].notes,hidden.notes);assert.equal(saved.slides[1].showNotes,true);
});
test('a copied page retains its source, notes, visibility and timing without sharing mutable metadata',()=>{
 const original={...C.blankSlide('solution'),title:'중요한 개념',image:'data:image/png;base64,AA==',width:1920,height:1080,notes:'# 핵심\n\n설명',speakerNotes:'발표자 메모',showNotes:false,startTime:15,time:29,segments:[{start:15,end:30}],pairId:'old-pair'};
 original.ai={requestId:'request',mode:'manual',sourceId:original.id};const copy=C.duplicateSlide(original);
 assert.notEqual(copy.id,original.id);assert.equal(copy.title,'중요한 개념 (복사)');assert.equal(copy.pairId,null);
 for(const field of ['image','notes','speakerNotes','showNotes','startTime','time','included'])assert.equal(copy[field],original[field]);
 assert.equal(copy.ai.sourceId,copy.id);copy.segments[0].start=21;copy.ai.mode='paid';copy.notes='복사본만 수정';
 assert.equal(original.segments[0].start,15);assert.equal(original.ai.mode,'manual');assert.equal(original.notes,'# 핵심\n\n설명');
});
test('undoing order, deletion, or a display option preserves later edits to unrelated note fields',()=>{
 const first={...C.blankSlide(),notes:'이전 설명'},second=C.blankSlide(),before=[first,second],reordered=[second,first];
 const edited=reordered.map(s=>({...s,notes:s.id===first.id?'이후에 적은 노트':s.notes}));
 const undo=C.restoreSlideHistory(edited,reordered,before);assert.deepEqual(undo.map(s=>s.id),before.map(s=>s.id));assert.equal(undo[0].notes,'이후에 적은 노트');
 const deleted=[{...second,notes:'삭제 후 다른 페이지에 적은 내용'}];const restored=C.restoreSlideHistory(deleted,[second],before);
 assert.equal(restored[0].notes,'이전 설명');assert.equal(restored[1].notes,deleted[0].notes);
 const hidden=[{...first,showNotes:false},second],editedHidden=[{...hidden[0],notes:'새 노트'},second];
 const shown=C.restoreSlideHistory(editedHidden,hidden,before);assert.equal(shown[0].showNotes,true);assert.equal(shown[0].notes,'새 노트');
 restored[0].segments.push({start:1,end:2});assert.equal(first.segments.length,0);
});
test('discrete detection presets preserve the tuned default and change which small transitions count',()=>{
 assert.equal(C.DETECTION_PRESETS.balanced.threshold,C.DETECTION_DEFAULTS.threshold);
 const counts=Object.fromEntries(Object.entries(C.DETECTION_PRESETS).map(([name,preset])=>{
  const detector=new C.SceneDetector(preset.threshold,2);detector.push(0,frame(255));detector.push(1,frame(245));detector.push(2,frame(245));return[name,detector.finish(3).length];
 }));
 assert.deepEqual(counts,{detailed:2,balanced:1,distinct:1});
});
test('display timestamps use total minutes and whole seconds without rounding the seek time',()=>{
 assert.equal(C.timestamp(125.99),'02:05');assert.equal(C.timestamp(3723.5),'62:03');assert.equal(C.timestamp(0),'00:00');assert.equal(C.timestamp(-1),'00:00');
 const s={...C.blankSlide(),startTime:125.99};assert.equal(C.slideStart(s),125.99);
});
test('drag insertion uses the midpoint and covers before, between and after pages',()=>{
 const rows=[{top:10,bottom:110},{top:120,bottom:220},{top:230,bottom:330}];
 assert.equal(C.insertionIndex(rows,-20),0);assert.equal(C.insertionIndex(rows,59),0);assert.equal(C.insertionIndex(rows,60),1);assert.equal(C.insertionIndex(rows,115),1);assert.equal(C.insertionIndex(rows,220),2);assert.equal(C.insertionIndex(rows,400),3);
});
test('crop dragging supports corners, edges, movement and reverse drawing within image bounds',()=>{
 const box={x:100,y:50,width:400,height:300},start={x:100,y:50};
 assert.deepEqual(C.dragCrop(box,'resize','nw',start,{x:150,y:80},960,540),{x:150,y:80,width:350,height:270});
 assert.deepEqual(C.dragCrop(box,'resize','e',start,{x:900,y:50},960,540),{x:100,y:50,width:860,height:300});
 assert.deepEqual(C.dragCrop(box,'move','',start,{x:900,y:700},960,540),{x:560,y:240,width:400,height:300});
 assert.deepEqual(C.dragCrop(box,'create','',{x:600,y:400},{x:200,y:100},960,540),{x:200,y:100,width:400,height:300});
 const tiny=C.dragCrop(box,'resize','nw',start,{x:900,y:900},960,540);assert.equal(tiny.width,8);assert.equal(tiny.height,8);
 assert.doesNotThrow(()=>C.dragCrop(box,'resize','e',start,{x:100.5,y:50},501,540));
});
test('the final extraction audit orders first appearances, repairs revisit start times and keeps problem pairs together',()=>{
 const source=(start,end,time,extra={})=>({...C.blankSlide(),time,startTime:start,segments:[{start,end}],...extra});
 const first=source(0,10,109,{startTime:105,segments:[{start:100,end:110},{start:0,end:10}]}),question=source(20,40,21,{kind:'question',pairId:'pair'}),solution=source(20,40,39,{kind:'solution',pairId:'pair'}),last=source(40,60,59);
 const result=C.verifyExtraction([last,solution,first,question],120);
 assert.deepEqual(result.slides.map(s=>s.id),[first.id,question.id,solution.id,last.id]);assert.equal(result.slides[0].startTime,0);assert.equal(result.slides[0].time,109);assert.equal(result.corrected,1);assert.equal(result.reordered,true);assert.equal(first.startTime,105);
 assert.throws(()=>C.verifyExtraction([source(0,10,30)],120));assert.throws(()=>C.verifyExtraction([first,first],120));
});
test('font overrides survive saving and copying, while legacy or invalid settings use automatic fitting',()=>{
 const manual={...C.blankSlide(),notesFontSize:14.5},old=C.blankSlide();delete old.notesFontSize;
 const data=C.validateWorkspace(C.workspaceState([manual,old,{...C.blankSlide(),notesFontSize:100}],'강의',null,null));
 assert.deepEqual(data.slides.map(s=>s.notesFontSize),[14.5,null,null]);assert.equal(C.duplicateSlide(manual).notesFontSize,14.5);
});
