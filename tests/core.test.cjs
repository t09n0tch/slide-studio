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
