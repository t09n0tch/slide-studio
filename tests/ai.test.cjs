const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../js/ai.js'),C=require('../js/core.js');
function fixture(){return ['a','b','c','d','e'].map((id,i)=>({...C.blankSlide(),id,title:`슬라이드 ${i+1}`,image:'data:image/png;base64,'+Buffer.from(id).toString('base64'),width:100,height:100,time:i*20,startTime:i*20,segments:[]}));}
function reply(request){return {version:1,requestId:request.id,notes:request.slides.map(s=>({slideId:s.id,title:'이해하기',markdown:'## 핵심\n\n핵심 개념 설명입니다.'})),supplements:[{afterSlideId:request.slides[1]?.id||request.slides[0].id,title:'개념 비교',markdown:'## 배경 보충\n\n- 첫 번째 개념\n- 두 번째 개념'}]};}
test('batches use included source images, preserve exact IDs/timestamps, and skip completed notes',()=>{
 const slides=fixture();slides[0].included=false;slides[1].ai={requestId:'old',mode:'paid',sourceId:'b'};slides.splice(3,0,C.blankSlide('supplement'));
 const request=A.createRequest(slides,'강의',4,'request-1');assert.deepEqual(request.slides.map(s=>s.id),['c','d','e']);assert.equal(request.slides[0].start,40);assert.equal(request.slides[1].number,5);assert.ok(A.prompt(request).includes('교수님의 음성은 제공되지 않았으므로'));
});
test('one pasted code block maps notes, preserves handwritten images and manual writing, inserts supplements at source',()=>{
 const slides=fixture();slides[0].notes='# 내가 쓴 설명';const request=A.createRequest(slides,'강의',4,'request-1'),original=JSON.stringify(slides);
 const result=A.applyReply(slides,request,'답변입니다.\n```json\n'+JSON.stringify(reply(request))+'\n```',C.blankSlide,'manual');
 assert.equal(JSON.stringify(slides),original);assert.ok(result.slides[0].notes.startsWith('# 내가 쓴 설명'));assert.ok(result.slides[0].notes.includes('핵심 개념'));assert.equal(result.slides[0].image,slides[0].image);assert.equal(result.slides[2].kind,'supplement');assert.equal(result.slides[2].ai.sourceId,'b');assert.equal(A.pending(result.slides).length,1);
 const restored=C.validateWorkspace(C.workspaceState(result.slides,'강의',null,null));assert.equal(A.pending(restored.slides).length,1);
 assert.throws(()=>A.applyReply(result.slides,request,JSON.stringify(reply(request)),C.blankSlide,'manual'),/이미 반영/);
});
test('wrong lecture, duplicate IDs, unknown references, truncated output, missing notes never partially apply',()=>{
 const slides=fixture(),request=A.createRequest(slides,'강의',4,'request-1'),original=JSON.stringify(slides);
 for(const mutate of [r=>{r.requestId='other';},r=>{r.notes[1].slideId=r.notes[0].slideId;},r=>{r.supplements[0].afterSlideId='other';},r=>{r.notes.pop();}]){const data=reply(request);mutate(data);assert.throws(()=>A.applyReply(slides,request,JSON.stringify(data),C.blankSlide,'paid'));assert.equal(JSON.stringify(slides),original);}
 assert.throws(()=>A.parseReply('{"version":1',request,slides));
});
test('a pending request survives restart, but stale/replaced images and completed requests cannot be reused',()=>{
 const slides=fixture(),request=A.createRequest(slides,'강의',2,'request-1');assert.deepEqual(A.restoreRequest(JSON.parse(JSON.stringify(request)),slides),request);
 slides[0].image='data:image/png;base64,AAAA';assert.equal(A.restoreRequest(request,slides),null);assert.throws(()=>A.parseReply(JSON.stringify(reply(request)),request,slides),/원본 화면이 변경/);
});
test('appending AI notes cannot make an otherwise valid saved workspace unrecoverable',()=>{
 const slides=fixture();slides[0].notes='가'.repeat(100000);const request=A.createRequest(slides,'강의',1,'request-1');
 assert.equal(request.slides[0].existingNotes.length,3000);assert.throws(()=>A.applyReply(slides,request,JSON.stringify(reply(request)),C.blankSlide,'paid'),/100,000/);assert.equal(slides[0].notes.length,100000);assert.equal(slides[0].ai,null);
});
