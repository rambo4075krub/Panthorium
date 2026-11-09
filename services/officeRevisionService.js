'use strict';
// Bounded native DOCX text revisions. Never flatten fields, hyperlinks, moves,
// nested revisions or non-text runs. Author is generated here, not user input.
const {OfficeArtifactError,_internals}=require('./officeArtifactService');
const {xmlMatches,xmlDirectMatches,xmlParagraphMatches,xmlReplaceSelected}= _internals;
const {documentRuns}=require('./officeRichText');
const fail=code=>{throw new OfficeArtifactError(409,code);};
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const decode=value=>String(value).replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi,match=>{
  const known={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"};
  if(known[match])return known[match];
  const code=match[2].toLowerCase()==='x'?parseInt(match.slice(3,-1),16):Number(match.slice(2,-1));
  return Number.isInteger(code)&&code>=0&&code<=0x10ffff?String.fromCodePoint(code):'';
});
const ids=new WeakMap();
const unsafe=['w:hyperlink','w:fldChar','w:fldSimple','w:instrText','w:sdt','w:moveFrom','w:moveTo','w:moveFromRangeStart','w:moveFromRangeEnd','w:moveToRangeStart','w:moveToRangeEnd','w:rPrChange','w:pPrChange','w:sectPrChange','w:customXml','w:drawing','w:pict','w:object'];
const numericId=id=>typeof id==='string'&&/^(0|[1-9]\d{0,9})$/.test(id)&&Number(id)<=2147483647;
function validateOperation(op){
  if(!['track_text','accept_revision','reject_revision'].includes(op?.type))return false;
  const keys=op.type==='track_text'?['type','index','value']:['type','index','revisionId'];
  if(Object.keys(op).length!==keys.length||!keys.every(k=>Object.hasOwn(op,k))||!Number.isInteger(op.index)||op.index<0||op.index>1999)fail('invalid_editor_revision');
  if(op.type==='track_text'?(typeof op.value!=='string'||op.value.length>6000||/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/.test(op.value)):!numericId(op.revisionId))fail('invalid_editor_revision');
  return true;
}
function children(source){
  const root=xmlMatches(source,source.match(/^<([^\s/>]+)/)?.[1]||'')[0]?.node;
  const tags=new Set([...source.matchAll(/<([\w:.-]+)(?:\s|\/?>)/g)].map(m=>m[1]));
  return [...tags].flatMap(tag=>xmlMatches(source,tag).filter(n=>n.node.parent===root)).sort((a,b)=>a.index-b.index);
}
function plainRun(run,deleted=false){
  const parts=children(run);return parts.every(p=>['w:rPr',deleted?'w:delText':'w:t'].includes(p.node.name)&&(p.node.name==='w:rPr'||!p[1].includes('<')))&&parts.some(p=>p.node.name===(deleted?'w:delText':'w:t'))&&!unsafe.some(t=>xmlMatches(run,t).length)&&xmlMatches(run,'w:ins').length===0&&xmlMatches(run,'w:del').length===0;
}
function plainRevision(revision){
  const root=xmlMatches(revision,revision.startsWith('<w:ins')?'w:ins':'w:del')[0];
  return !!root&&children(revision).length>0&&children(revision).every(p=>p.node.name==='w:r'&&plainRun(p[0],root.node.name==='w:del'));
}
function paragraphRevisions(paragraph){
  const root=xmlMatches(paragraph,'w:p',true)[0]?.node;
  if(!root)return [];
  return ['w:ins','w:del'].flatMap(tag=>xmlMatches(paragraph,tag).map(m=>({revisionId:m.node.attributes['w:id']||'',type:tag==='w:ins'?'insert':'delete',text:xmlMatches(m[0],tag==='w:ins'?'w:t':'w:delText',true).map(t=>decode(t[1])).join(''),author:m.node.attributes['w:author']||'',supported:m.node.parent===root&&numericId(m.node.attributes['w:id'])&&plainRevision(m[0])&&!unsafe.some(t=>xmlMatches(paragraph,t).length),_position:m.index}))).sort((a,b)=>a._position-b._position).map(({_position,...r})=>({...r,...(!r.supported?{reason:'editor_revision_unsupported'}:{})}));
}
function canTrack(paragraph){
  return !!xmlMatches(paragraph,'w:p',true).length&&!unsafe.some(t=>xmlMatches(paragraph,t).length)&&children(paragraph).every(p=>p.node.name==='w:pPr'||p.node.name==='w:r'&&plainRun(p[0]))&&xmlMatches(paragraph,'w:ins').length===0&&xmlMatches(paragraph,'w:del').length===0&&xmlDirectMatches(paragraph,'w:r').length>0;
}
function allRevisionMatches(xml){return ['w:ins','w:del'].flatMap(t=>xmlMatches(xml,t));}
function enrich(entries,model){
  const source=entries['word/document.xml']?.toString();if(!source||!model.blocks)return model;
  const paragraphs=xmlMatches(source,'w:p',true),counts=new Map();
  for(const m of allRevisionMatches(source)){const id=m.node.attributes['w:id'];counts.set(id,(counts.get(id)||0)+1);}
  model.revisions=[];
  for(const block of model.blocks){
    const p=paragraphs[block.ordinal];if(!p)continue;
    block.canTrackText=canTrack(p[0]);
    block.revisions=paragraphRevisions(p[0]).map(r=>({...r,supported:r.supported&&counts.get(r.revisionId)===1,...(counts.get(r.revisionId)!==1?{reason:'editor_revision_duplicate_id'}:{})}));
    model.revisions.push(...block.revisions.map(r=>({...r,index:block.index})));
    // Display current (accepted) text while retaining deletion metadata separately.
    if(block.revisions.length){block.text=xmlParagraphMatches(p[0],'w:t','w').filter(t=>{let n=t.node.parent;while(n&&n.name!=='w:p'){if(n.name==='w:del')return false;n=n.parent;}return true;}).map(t=>decode(t[1])).join('');block.runs=documentRuns(p[0]);}
  }
  return model;
}
function initializeIds(entries){
  if(ids.has(entries))return;
  let high=0;
  // Read actual attributes, not lookalike content inside comments/text/CDATA.
  for(const [name,body]of Object.entries(entries))if(/^word\/.*\.xml$/.test(name)){
    const xml=body.toString(),tags=new Set([...xml.matchAll(/<([\w:.-]+)(?:\s|\/?>)/g)].map(m=>m[1]));
    for(const tag of tags)for(const m of xmlMatches(xml,tag))if(Object.hasOwn(m.node.attributes,'w:id')){
      const id=m.node.attributes['w:id'];if(!/^\d+$/.test(id))continue;
      const n=Number(id);if(!Number.isSafeInteger(n)||n>2147483647)fail('editor_revision_id_limit');high=Math.max(high,n);
    }
  }
  ids.set(entries,high);
}
function nextId(entries){
  initializeIds(entries);const id=ids.get(entries)+1;if(id>2147483647)fail('editor_revision_id_limit');ids.set(entries,id);return String(id);
}
function runPart(run,text,deleted=false){
  const root=xmlMatches(run,'w:r')[0],properties=xmlDirectMatches(run,'w:rPr').map(p=>p[0]).join('');
  return run.slice(0,root.node.openEnd)+properties+`<w:${deleted?'delText':'t'} xml:space="preserve">${escape(text)}</w:${deleted?'delText':'t'}>`+'</w:r>';
}
function tracked(paragraph,value,entries){
  if(!canTrack(paragraph))fail('editor_revision_unsupported');
  const runs=xmlDirectMatches(paragraph,'w:r'),texts=runs.map(r=>Array.from(xmlDirectMatches(r[0],'w:t').map(t=>decode(t[1])).join(''))),original=texts.flat(),next=Array.from(value);
  if(original.join('')===value)return paragraph;
  let start=0,suffix=0;while(start<original.length&&start<next.length&&original[start]===next[start])start++;
  while(suffix<original.length-start&&suffix<next.length-start&&original[original.length-1-suffix]===next[next.length-1-suffix])suffix++;
  const end=original.length-suffix,inserted=next.slice(start,next.length-suffix).join('');let offset=0,anchor=-1;
  for(let i=0;i<texts.length;i++){const length=texts[i].length;if(length&&(start<offset+length||start===end&&start===offset+length)){anchor=i;break;}offset+=length;}
  if(anchor<0)anchor=texts.length-1;
  const wrap=(type,body)=>`<w:${type} w:id="${nextId(entries)}" w:author="Panthorium">${body}</w:${type}>`;
  offset=0;let i=0;
  return xmlReplaceSelected(paragraph,runs,run=>{
    const index=i++,chars=texts[index],from=offset,to=offset+chars.length;offset=to;
    const lo=Math.max(0,Math.min(chars.length,start-from)),hi=Math.max(0,Math.min(chars.length,end-from));
    if(lo===hi&&!(index===anchor&&inserted))return run;
    const before=chars.slice(0,lo).join(''),removed=chars.slice(lo,hi).join(''),after=chars.slice(hi).join('');
    return (before?runPart(run,before):'')+(removed?wrap('del',runPart(run,removed,true)):'')+(index===anchor&&inserted?wrap('ins',runPart(run,inserted)):'')+(after?runPart(run,after):'');
  });
}
function apply(entries,kind,op,model){
  if(!validateOperation(op))return false;if(kind!=='document')fail('editor_operation_type_mismatch');
  const block=model.blocks?.find(b=>b.index===op.index);if(!block||block.file!=='word/document.xml')fail('editor_text_not_found');
  const source=entries[block.file].toString(),paragraph=xmlMatches(source,'w:p',true)[block.ordinal];if(!paragraph)fail('editor_text_not_found');
  initializeIds(entries); // Keep the high-water mark across decisions within one save.
  let updated;
  if(op.type==='track_text')updated=tracked(paragraph[0],op.value,entries);
  else{
    const known=block.revisions?.find(r=>r.revisionId===op.revisionId);if(!known||!known.supported)fail('editor_revision_not_found');
    const matches=allRevisionMatches(source).filter(m=>m.node.attributes['w:id']===op.revisionId);if(matches.length!==1)fail('editor_revision_not_found');
    const revision=paragraphRevisions(paragraph[0]).find(r=>r.revisionId===op.revisionId);if(!revision||!revision.supported)fail('editor_revision_unsupported');
    const matchesInParagraph=allRevisionMatches(paragraph[0]).filter(m=>m.node.attributes['w:id']===op.revisionId),match=matchesInParagraph[0];
    const keep=op.type==='accept_revision'?revision.type==='insert':revision.type==='delete';
    const replacement=keep?(revision.type==='delete'?match[1].replace(/<(\/?)(w:)delText(?=[\s/>])/g,'<$1$2t'):match[1]):'';
    updated=xmlReplaceSelected(paragraph[0],[match],replacement);
  }
  entries[block.file]=Buffer.from(xmlReplaceSelected(source,[paragraph],updated));return true;
}
module.exports={validateOperation,paragraphRevisions,enrich,apply};
