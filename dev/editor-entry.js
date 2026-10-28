// Bundled for offline use. No cloud extensions, images, or remote services.
import { Editor, generateHTML } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';

function extensions(placeholder=false){
  return [
    StarterKit.configure({heading:{levels:[1,2,3]},underline:false,link:{openOnClick:false,autolink:false}}),
    TaskList,TaskItem.configure({nested:true}),
    Markdown.configure({markedOptions:{gfm:true,breaks:true},indentation:{style:'space',size:2}}),
    ...(placeholder?[Placeholder.configure({placeholder:'여기에 바로 적어 보세요.\n제목, 목록, 강조는 위 툴바로 넣을 수 있어요.'})]:[]),
  ];
}

// Treat raw HTML as text. Preserve angle brackets inside fenced/inline code.
function safeMarkdown(value){
  let fence=null;
  return String(value||'').normalize('NFC').split('\n').map(line=>{
    const marker=line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if(marker){
      const end=fence&&marker[1][0]===fence.char&&marker[1].length>=fence.length;
      if(!fence)fence={char:marker[1][0],length:marker[1].length};else if(end)fence=null;
      return line;
    }
    if(fence)return line;
    let out='',ticks=0;
    for(let i=0;i<line.length;i++){
      if(!ticks&&line[i]==='\\'&&i+1<line.length){out+=line.slice(i,i+2);i++;}
      else if(line[i]==='`'){let n=1;while(line[i+n]==='`')n++;ticks=ticks===n?0:ticks||n;out+=line.slice(i,i+n);i+=n-1;}
      else if(!ticks&&line[i]==='!'&&line[i+1]==='['){out+='\\!\\[';i++;}
      else out+=!ticks&&line[i]==='<'?'&lt;':!ticks&&line[i]==='|'?'\\|':line[i];
    }
    return out;
  }).join('\n');
}

let parser;
function manager(){
  if(!parser)parser=new Editor({element:document.createElement('div'),extensions:extensions(),editable:false,content:'',injectCSS:false});
  return parser.markdown;
}
function safeDoc(node){
  if(!node||typeof node!=='object')return null;
  const next={...node};
  if(node.marks)next.marks=node.marks.filter(mark=>mark.type!=='link'||/^(https?:\/\/|mailto:)/i.test(mark.attrs?.href||''));
  if(node.content)next.content=node.content.map(safeDoc).filter(Boolean);
  if(node.type==='image')return node.attrs?.alt?{type:'text',text:String(node.attrs.alt)}:null;
  return next;
}
export function parse(markdown){
  const doc=safeDoc(manager().parse(safeMarkdown(markdown)));
  // Unsupported syntax must remain readable text, never invalid inline nodes
  // directly under the document or a silently discarded Markdown table.
  if(doc?.content)doc.content=doc.content.map(node=>['text','hardBreak'].includes(node.type)?{type:'paragraph',content:[node]}:node);
  return doc?.content?.length?doc:{type:'doc',content:[{type:'paragraph'}]};
}
export function serialize(doc){return manager().serialize(doc);}
export function html(markdown){return generateHTML(parse(markdown),extensions());}
export function plainMarkdown(text){
  const content=String(text||'').normalize('NFC').split(/\n\s*\n/).map(paragraph=>{
    const nodes=[];paragraph.split('\n').forEach((line,i)=>{if(i)nodes.push({type:'hardBreak'});if(line)nodes.push({type:'text',text:line});});
    return{type:'paragraph',...(nodes.length?{content:nodes}:{})};
  });
  return serialize({type:'doc',content});
}
export function legacyMarkdown(slide){
  if(slide.notesFormat==='markdown')return slide.notes||'';
  const generic=/^(슬라이드 \d+|문제 · 슬라이드 \d+|풀이 · 슬라이드 \d+|문제|보충 설명)$/;
  const heading=slide.title&&!generic.test(slide.title)?serialize({type:'doc',content:[{type:'heading',attrs:{level:1},content:[{type:'text',text:slide.title}]}]}):'';
  return[heading,plainMarkdown(slide.notes||'')].filter(Boolean).join('\n\n');
}
export function create({element,markdown='',onChange=()=>{},onSelection=()=>{}}){
  const editor=new Editor({
    element,extensions:extensions(true),content:parse(markdown),injectCSS:false,
    editorProps:{attributes:{role:'textbox','aria-label':'강의노트 편집기','aria-multiline':'true',spellcheck:'true'}},
    onUpdate:({editor})=>onChange(editor.getMarkdown(),editor.getJSON()),
    onSelectionUpdate:({editor})=>onSelection(editor),
    onTransaction:({editor})=>onSelection(editor),
  });
  return editor;
}
