'use strict';
// Default header/footer text for single-section DOCX. Complex imported parts
// remain protected rather than silently flattening fields, pictures or tables.
const path=require('node:path');
const {OfficeArtifactError,_internals}=require('./officeArtifactService');
const {xmlMatches,xmlReplaceSelected,xmlDirectMatches,xmlInsertChild}= _internals;
const NS='http://schemas.openxmlformats.org';
const fail=code=>{throw new OfficeArtifactError(400,code);};
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const attr=(s,k)=>xmlMatches(s, s.match(/^<([^\s/>]+)/)?.[1]||'__none')[0]?.node.attributes[k]||'';
const decode=v=>String(v).replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi,s=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[s]??String.fromCodePoint(s[2].toLowerCase()==='x'?parseInt(s.slice(3,-1),16):Number(s.slice(2,-1)))));
function validateOperation(op){
  if(op?.type!=='set_page_text')return false;
  if(Object.keys(op).length!==3||!['header','footer'].includes(op.part)||typeof op.value!=='string'||op.value.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(op.value))fail('invalid_editor_page_text');
  return true;
}
function inspect(entries){
  const xml=entries['word/document.xml']?.toString()||'',sections=xmlMatches(xml,'w:sectPr');
  const rels=entries['word/_rels/document.xml.rels']?.toString()||`<Relationships xmlns="${NS}/package/2006/relationships"></Relationships>`;
  const result={editable:sections.length<=1,header:'',footer:'',sections,rels,xml,parts:{}};
  for(const part of ['header','footer']){
    const refs=sections[0]?xmlDirectMatches(sections[0][0],`w:${part}Reference`).filter(r=>attr(r[0],'w:type')==='default'):[];
    if(refs.length>1){result.editable=false;continue;}
    if(!refs.length)continue;
    const ref=refs[0],rid=attr(ref[0],'r:id'),rel=xmlMatches(rels,'Relationship').find(r=>attr(r[0],'Id')===rid);
    if(!rel||attr(rel[0],'TargetMode')||attr(rel[0],'Type')!==`${NS}/officeDocument/2006/relationships/${part}`){result.editable=false;continue;}
    const target=decode(attr(rel[0],'Target')),file=target.startsWith('/')?target.slice(1):path.posix.normalize('word/'+target),body=entries[file]?.toString();
    if(!/^word\/[\w.-]+\.xml$/.test(file)||!body){result.editable=false;continue;}
    const root=part==='header'?'w:hdr':'w:ftr';
    // Reject semantic constructs that plain-text replacement would destroy.
    const allowed=new Set([root,'w:p','w:pPr','w:r','w:rPr','w:t','w:b','w:i','w:u','w:sz','w:szCs','w:color','w:jc','w:rFonts','w:spacing','w:pStyle','w:lang']);
    if([...body.matchAll(/<([A-Za-z_][\w:.-]*)\b/g)].some(m=>!allowed.has(m[1])))result.editable=false;
    result[part]=xmlMatches(body,'w:p').map(p=>xmlMatches(p[0],'w:t',true).map(t=>decode(t[1])).join('')).join('\n');
    result.parts[part]={file,ref,rid};
  }
  return result;
}
function enrich(entries,model){const p=inspect(entries);model.pageText={editable:p.editable,header:p.header,footer:p.footer};return model;}
function apply(entries,kind,op){
  if(!validateOperation(op))return false;
  if(kind!=='document')fail('editor_operation_type_mismatch');
  const state=inspect(entries);if(!state.editable)fail('editor_page_text_unsupported');
  let file=state.parts[op.part]?.file,xml=state.xml,rels=state.rels;
  if(!file){
    let serial=1;while(entries[`word/panthorium-${op.part}-${serial}.xml`])serial++;
    file=`word/panthorium-${op.part}-${serial}.xml`;
    let rid=`panthorium${op.part}${serial}`;while(xmlMatches(rels,'Relationship').some(r=>attr(r[0],'Id')===rid))rid+='x';
    const reference=`<w:${op.part}Reference w:type="default" r:id="${rid}"/>`;
    if(state.sections.length){const section=state.sections[0];xml=xmlReplaceSelected(xml,[section],s=>{
      if(op.part==='header')return xmlInsertChild(s,reference,true);
      const refs=['w:headerReference','w:footerReference'].flatMap(tag=>xmlDirectMatches(s,tag)).sort((a,b)=>a.index-b.index),last=refs.at(-1);
      return last?s.slice(0,last.index+last[0].length)+reference+s.slice(last.index+last[0].length):xmlInsertChild(s,reference,true);
    });}
    else {const body=xmlMatches(xml,'w:body');if(body.length!==1)fail('editor_office_unsupported');xml=xmlReplaceSelected(xml,body,s=>xmlInsertChild(s,`<w:sectPr>${reference}</w:sectPr>`));}
    // r is required by the new reference even for minimal imported documents.
    if(!/xmlns:r=/.test(xml.split('>')[0])&&!xml.match(/<w:document\b[^>]*xmlns:r=/))xml=xml.replace('<w:document',`<w:document xmlns:r="${NS}/officeDocument/2006/relationships"`);
    rels=xmlInsertChild(rels,`<Relationship Id="${rid}" Type="${NS}/officeDocument/2006/relationships/${op.part}" Target="${file.slice(5)}"/>`);
    entries['word/_rels/document.xml.rels']=Buffer.from(rels);entries['word/document.xml']=Buffer.from(xml);
    const types=entries['[Content_Types].xml']?.toString();if(!types)fail('editor_office_unsupported');
    entries['[Content_Types].xml']=Buffer.from(xmlInsertChild(types,`<Override PartName="/${file}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${op.part}+xml"/>`));
  }
  const root=op.part==='header'?'hdr':'ftr';
  entries[file]=Buffer.from(`<w:${root} xmlns:w="${NS}/wordprocessingml/2006/main">`+op.value.split('\n').map(t=>`<w:p><w:r><w:t xml:space="preserve">${escape(t)}</w:t></w:r></w:p>`).join('')+`</w:${root}>`);
  return true;
}
module.exports={validateOperation,enrich,apply};
