'use strict';
// Preserve mixed formatting when editing ordinary DOCX text. A text-area edit is
// represented as one contiguous replacement; unchanged prefix/suffix stay in
// their original runs. The replacement inherits the first affected run's style.
const { _internals, OfficeArtifactError } = require('./officeArtifactService');
const { xmlMatches, xmlParagraphMatches, xmlReplaceSelected } = _internals;
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const decode = value => String(value).replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, s => {
  const named = {'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"};
  if (Object.hasOwn(named,s)) return named[s];
  const n = s[2].toLowerCase() === 'x' ? parseInt(s.slice(3,-1),16) : Number(s.slice(2,-1));
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
});
// These have semantics the plain paragraph surface cannot faithfully display.
const protectedTags = ['w:ins','w:del','w:moveFrom','w:moveTo','w:fldChar','w:fldSimple','w:instrText','w:sdt','w:hyperlink','w:sym','w:noBreakHyphen','w:softHyphen'];
function textTokens(paragraph,prefix='w') {
  return ['t','br',...(prefix==='w'?['cr','tab']:[])].flatMap(tag=>xmlParagraphMatches(paragraph,prefix+':'+tag,prefix,false)).sort((a,b)=>a.index-b.index);
}
function tokenText(token) {const name=token.node.name;return name.endsWith(':t')?decode(token[1]):name.endsWith(':tab')?'\t':'\n';}
function paragraphText(paragraph,prefix='w') {return textTokens(paragraph,prefix).map(tokenText).join('');}
function documentTextXml(value) {return String(value).replace(/\r\n?/g,'\n').split(/([\n\t])/).map(part=>part==='\n'?'<w:br/>':part==='\t'?'<w:tab/>':'<w:t xml:space="preserve">'+escape(part)+'</w:t>').join('');}
function protectionReason(paragraph) {
  const root = xmlMatches(paragraph,'w:p',true)[0]?.node;
  if (!root) return 'editor_rich_text_unsupported';
  if(xmlParagraphMatches(paragraph,'w:br','w',false).some(m=>m.node.attributes['w:type']&&!['textWrapping'].includes(m.node.attributes['w:type'])))return 'editor_rich_text_protected';
  for (const name of protectedTags) if (xmlMatches(paragraph,name).some(m => {
    let p = m.node.parent;
    while (p && p.name !== 'w:p') p = p.parent;
    return p === root;
  })) return 'editor_rich_text_protected';
  return null;
}
function replaceDocumentText(paragraph, value) {
  value=String(value).replace(/\r\n?/g,'\n');
  const matches = textTokens(paragraph);
  const parts = matches.map(m => Array.from(tokenText(m)));
  const original = parts.flat(), next = Array.from(value);
  if (original.join('') === value) return paragraph;
  const reason = protectionReason(paragraph);
  if (reason) throw new OfficeArtifactError(409,reason);
  if (!matches.length) {const content='<w:r>'+documentTextXml(value)+'</w:r>';return _internals.xmlInsertChild(paragraph,content);}
  let start = 0, suffix = 0;
  while (start < original.length && start < next.length && original[start] === next[start]) start++;
  while (suffix < original.length-start && suffix < next.length-start && original[original.length-1-suffix] === next[next.length-1-suffix]) suffix++;
  const end = original.length-suffix, inserted = next.slice(start,next.length-suffix).join('');
  // Boundary insertion uses the preceding run, matching ordinary typing at the
  // end of that run. Replacements use the first character being replaced.
  let offset=0, anchor=-1;
  for(let i=0;i<parts.length;i++) {
    const length=parts[i].length;
    if(length && (start < offset+length || start===end && start===offset+length)){anchor=i;break;}
    offset+=length;
  }
  if(anchor<0)anchor=parts.length-1;
  offset=0;
  const values=parts.map((chars,i)=>{
    const from=offset,to=offset+chars.length;offset=to;
    const before=chars.slice(0,Math.max(0,Math.min(chars.length,start-from))).join('');
    const after=chars.slice(Math.max(0,Math.min(chars.length,end-from))).join('');
    return before+(i===anchor?inserted:'')+after;
  });
  let i=0;
  return xmlReplaceSelected(paragraph,matches,old=>{
    const value=values[i], unchanged=value===parts[i++].join('');
    return unchanged?old:documentTextXml(value);
  });
}
function documentRuns(paragraph) {
  return xmlParagraphMatches(paragraph,'w:r','w').map(run=>{
    const text=paragraphText('<w:p>'+run[0]+'</w:p>');
    const props=xmlMatches(run[0],'w:rPr')[0]?.[0]||'';
    const style={};
    const val=name=>xmlMatches(props,name)[0]?.node.attributes['w:val'];
    for(const [key,tag] of [['bold','w:b'],['italic','w:i'],['underline','w:u']]) {
      if(xmlMatches(props,tag).length)style[key]=!['0','false','off','none'].includes(val(tag));
    }
    const size=Number(val('w:sz'))/2;
    if(Number.isFinite(size)&&size>=8&&size<=96)style.fontSize=size;
    const color=val('w:color');if(/^[a-f0-9]{6}$/i.test(color||''))style.color=color;
    return {text,style};
  }).filter(run=>run.text);
}
module.exports={replaceDocumentText,protectionReason,documentRuns,paragraphText,documentTextXml};
