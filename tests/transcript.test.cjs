const test=require('node:test'),assert=require('node:assert/strict');
const T=require('../js/transcript.js'),C=require('../js/core.js'),A=require('../js/ai.js');
const inline='참석자 1 00:00 First explanation and a quoted value: 12:34.  참석자 1 00:35 Second explanation.  참석자 2 01:13 A question.';
function source(id,start,end){return{...C.blankSlide(),id,image:'data:image/png;base64,'+Buffer.from(id).toString('base64'),width:100,height:100,startTime:start,time:end-.1,segments:[{start,end}]};}
test('Clova flattened copy, separated speaker lines, English/Korean, numeric utterances, hours and SRT/VTT retain text and timestamps',()=>{
 const parsed=T.parse(inline,{duration:100});assert.deepEqual(parsed.cues.map(c=>[c.start,c.end,c.speaker]),[[0,35,'참석자 1'],[35,73,'참석자 1'],[73,100,'참석자 2']]);assert.ok(parsed.cues[0].text.includes('12:34'));
 const lines=T.parse('참석자 1\n00:00\n첫 설명\n15\n참석자 2\n00:35\n질문입니다.',{duration:100});assert.equal(lines.cues[0].text,'첫 설명\n15');assert.equal(lines.cues[1].speaker,'참석자 2');
 const subtitles=T.parse('WEBVTT\n\n1\n00:00:00.500 --> 00:00:01.500\n첫 문장\n\n2\n00:00:01.500 --> 00:00:02.000\nSecond sentence',{duration:10,offset:3});assert.deepEqual(subtitles.cues.map(c=>[c.start,c.end]),[[3.5,4.5],[4.5,5]]);
 assert.equal(T.parse('[01:02:03] Three hours marker',{duration:4000}).cues[0].start,3723);
});
test('untimed, backwards, out-of-video and malformed transcripts fail without changing existing data',()=>{
 const existing=T.parse(inline,{duration:100}),before=JSON.stringify(existing);
 for(const text of ['시간이 없는 설명','참석자 1 00:35 B 참석자 1 00:00 A','참석자 1 05:00 Outside','00:61 Invalid'])assert.throws(()=>T.parse(text,{duration:100}));
 assert.equal(JSON.stringify(existing),before);assert.throws(()=>T.restore({...existing,cues:[{...existing.cues[0],end:999}]},100));assert.deepEqual(T.restore(JSON.parse(before),100),existing);
 for(const time of ['-1:20','1.5:20','00:','00:60','00:00:60'])assert.throws(()=>T.seconds(time));
});
test('alignment uses original intervals, includes boundary paragraph context and revisits, survives copies/reordering and skips supplements',()=>{
 const parsed=T.parse(inline,{duration:100}),first=source('a',0,20),second=source('b',20,73),revisit={...first,segments:[{start:0,end:20},{start:73,end:100}]};
 assert.equal(T.forSlide(parsed,first).length,1);assert.equal(T.forSlide(parsed,second).length,2);assert.equal(T.forSlide(parsed,revisit).length,2);assert.deepEqual(T.forSlide(parsed,C.duplicateSlide(second)),T.forSlide(parsed,second));assert.deepEqual(T.forSlide(parsed,C.blankSlide('supplement')),[]);
 const reordered=[second,first];assert.equal(T.speech(parsed,reordered[0]).cues[0].start,0);assert.deepEqual(T.speech(parsed,reordered[0]).intervals,[{start:20,end:73}]);
});
test('part imports retain original offsets, replace a part atomically and never duplicate it',()=>{
 const first=T.parse('참석자 1 00:00 First part',{duration:20}),second=T.parse('참석자 1 00:00 Second part',{duration:40,offset:20});
 const joined=T.merge(first,second,{start:20,end:40});assert.deepEqual(joined.cues.map(c=>[c.start,c.end]),[[0,20],[20,40]]);assert.deepEqual(T.merge(joined,second,{start:20,end:40}),joined);
 const unfinished=T.parse('참석자 1 00:00 First part',{duration:40});assert.deepEqual(T.merge(unfinished,second,{start:20,end:40}),joined);assert.equal(unfinished.cues[0].end,40);
});
test('free and paid prompts include only aligned speech, pending requests invalidate on speech edits, completion persists with speech provenance',()=>{
 const slides=[source('a',0,35),source('b',35,100)],parsed=T.parse(inline,{duration:100}),old=A.createRequest(slides,'강의',2,'old');
 assert.equal(A.restoreRequest(old,slides,parsed),null);
 const request=A.createRequest(slides,'강의',2,'new',parsed),prompt=A.prompt(request);assert.ok(prompt.includes('lecturerTranscript')&&prompt.includes('videoIntervals')&&prompt.includes('First explanation'));assert.ok(!prompt.includes('교수님의 음성은 제공되지 않았으므로'));assert.equal(request.slides[0].speech.cues.length,1);
 const reply=JSON.stringify({version:1,requestId:'new',notes:request.slides.map(s=>({slideId:s.id,title:'정리',markdown:'교수님 설명 요약'})),supplements:[]});
 const result=A.applyReply(slides,request,reply,C.blankSlide,'manual',parsed);assert.equal(A.pending(result.slides,parsed).length,0);
 const recovered=C.validateWorkspace(C.workspaceState(result.slides,'강의',null,null));assert.equal(A.pending(recovered.slides,parsed).length,0);
 const changed=structuredClone(parsed);changed.cues[0].text='Corrected explanation';assert.equal(A.restoreRequest(request,slides,changed),null);assert.throws(()=>A.applyReply(slides,request,reply,C.blankSlide,'paid',changed),/음성 기록이 변경/);assert.equal(A.pending(recovered.slides,changed).length,1);
});
