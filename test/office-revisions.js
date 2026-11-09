'use strict';
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {_internals:i}=require('../services/officeArtifactService');
const revisions=require('../services/officeRevisionService');
const {documentRuns}=require('../services/officeRichText');
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p='<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>ab</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>CD</w:t></w:r></w:p>';
function fixture(paragraph=p){return {'word/document.xml':Buffer.from(`<w:document xmlns:w="${W}"><w:body>${paragraph}<w:p><w:r><w:t>Untouched</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`),'word/styles.xml':Buffer.from(`<w:styles xmlns:w="${W}"/>`),'[Content_Types].xml':Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')};}
function model(entries){const xml=entries['word/document.xml'].toString();return revisions.enrich(entries,{blocks:i.xmlMatches(xml,'w:p',true).map((m,ordinal)=>({index:ordinal,ordinal,file:'word/document.xml',text:i.xmlMatches(m[0],'w:t',true).map(t=>t[1]).join('')}))});}
function apply(entries,op,current=model(entries)){return revisions.apply(entries,'document',op,current);}
function body(entries){return entries['word/document.xml'].toString();}
function verify(entries){i.validateOfficeXmlEntries(entries);const dom=new JSDOM(body(entries),{contentType:'application/xml'});assert(dom.window.document.documentElement);dom.window.close();}
function decideAll(entries,type){const current=model(entries);for(const r of current.blocks[0].revisions)apply(entries,{type,index:0,revisionId:r.revisionId},current);}
assert.equal(revisions.validateOperation({type:'set_text'}),false);
const numericEntities=revisions.paragraphRevisions('<w:p><w:ins w:id="1"><w:r><w:t>&#999999999;&#x110000;&#128512;&amp;</w:t></w:r></w:ins></w:p>');
assert.equal(numericEntities[0].text,'😀&','out-of-range numeric entities never throw RangeError');

const entries=fixture(),before=Object.fromEntries(Object.entries(entries).map(([k,v])=>[k,Buffer.from(v)]));
assert.equal(model(entries).blocks[0].canTrackText,true);
assert(apply(entries,{type:'track_text',index:0,value:'aXYD'}));verify(entries);
const data=model(entries),changes=data.blocks[0].revisions;
assert.equal(data.blocks[0].text,'aXYD');assert.equal(data.blocks[0].canTrackText,false);
assert.deepEqual(changes.map(r=>[r.type,r.text]),[['delete','b'],['insert','XY'],['delete','C']]);
assert.deepEqual(changes.map(r=>r.revisionId),['1','2','3']);assert(changes.every(r=>r.author==='Panthorium'&&r.supported));
assert(changes.every(r=>data.revisions.some(x=>x.revisionId===r.revisionId&&x.index===0)));
assert(body(entries).includes('<w:pPr><w:jc w:val="center"/></w:pPr>'));assert(body(entries).includes('<w:t>Untouched</w:t>'));
for(const name of ['word/styles.xml','[Content_Types].xml'])assert(entries[name].equals(before[name]));
const accepted=i.unzip(i.zip(entries));decideAll(accepted,'accept_revision');verify(accepted);assert.equal(model(accepted).blocks[0].text,'aXYD');assert.equal(model(accepted).revisions.length,0);
const acceptedRuns=documentRuns(i.xmlMatches(body(accepted),'w:p',true)[0][0]);assert(acceptedRuns.some(r=>r.text==='XY'&&r.style.bold));assert(acceptedRuns.some(r=>r.text==='D'&&r.style.italic));
const rejected=i.unzip(i.zip(entries));decideAll(rejected,'reject_revision');verify(rejected);assert.equal(model(rejected).blocks[0].text,'abCD');assert.equal(model(rejected).revisions.length,0);
assert(documentRuns(i.xmlMatches(body(rejected),'w:p',true)[0][0]).filter(r=>r.style.italic).map(r=>r.text).join('')==='CD');
assert.throws(()=>apply(entries,{type:'track_text',index:0,value:'again'}),/editor_revision_unsupported/,'resolve prior revisions before another tracked edit');
assert.throws(()=>apply(entries,{type:'accept_revision',index:1,revisionId:'1'}),/editor_revision_not_found/,'revision IDs are not paragraph indexes');
assert.throws(()=>apply(entries,{type:'accept_revision',index:0,revisionId:'999'}),/editor_revision_not_found/);
// An ID created earlier in a batch was not read by the user and cannot be guessed.
const guessed=fixture(),snapshot=model(guessed);apply(guessed,{type:'track_text',index:0,value:'new'},snapshot);assert.throws(()=>apply(guessed,{type:'accept_revision',index:0,revisionId:'1'},snapshot),/editor_revision_not_found/);
const noChange=fixture();apply(noChange,{type:'track_text',index:0,value:'abCD'});assert(noChange['word/document.xml'].equals(before['word/document.xml']));
for(const desired of ['','abCDmore','ก่อนabCD','a😀CD','abnewCD']){
  const e=fixture();apply(e,{type:'track_text',index:0,value:desired});assert.equal(model(e).blocks[0].text,desired);verify(e);
  const a=i.unzip(i.zip(e)),r=i.unzip(i.zip(e));decideAll(a,'accept_revision');decideAll(r,'reject_revision');assert.equal(model(a).blocks[0].text,desired);assert.equal(model(r).blocks[0].text,'abCD');
}
// High-water mark survives decisions during one save; IDs cannot target new edits accidentally.
const repeated=fixture();apply(repeated,{type:'track_text',index:0,value:'aXYD'});decideAll(repeated,'accept_revision');apply(repeated,{type:'track_text',index:0,value:'aZZD'});assert(model(repeated).revisions.every(r=>Number(r.revisionId)>3));
// Existing IDs in another Word part also reserve IDs.
const prior=fixture();prior['word/header1.xml']=Buffer.from(`<w:hdr xmlns:w="${W}"><w:p><w:ins w:id="20" w:author="External"><w:r><w:t>kept</w:t></w:r></w:ins></w:p></w:hdr>`);apply(prior,{type:'track_text',index:0,value:'aXYD'});assert.equal(model(prior).revisions[0].revisionId,'21');
// Imported plain deletions can be rejected, preserving their run formatting.
const imported=fixture('<w:p><w:del w:id="7" w:author="Imported"><w:r><w:rPr><w:b/></w:rPr><w:delText>old &amp; safe</w:delText></w:r></w:del></w:p>');
assert.equal(model(imported).blocks[0].text,'');assert.equal(model(imported).revisions[0].text,'old & safe');apply(imported,{type:'reject_revision',index:0,revisionId:'7'});assert.equal(model(imported).blocks[0].text,'old &amp; safe');assert(!body(imported).includes('delText'));verify(imported);
const emptyDel=fixture('<w:p><w:del w:id="7"><w:r><w:delText/></w:r></w:del></w:p>');apply(emptyDel,{type:'reject_revision',index:0,revisionId:'7'});assert(!body(emptyDel).includes('delText'));verify(emptyDel);
for(const markup of [
  '<w:p><w:hyperlink><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>',
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:t>field</w:t></w:r></w:p>',
  '<w:p><w:moveFrom w:id="4"><w:r><w:t>move</w:t></w:r></w:moveFrom></w:p>',
  '<w:p><w:r><w:tab/><w:t>tab</w:t></w:r></w:p>',
  '<w:p><w:r><w:t><![CDATA[text]]></w:t></w:r></w:p>',
  '<w:p><w:bookmarkStart w:id="4"/><w:r><w:t>bookmark</w:t></w:r></w:p>'
]){const e=fixture(markup),saved=body(e);assert.equal(model(e).blocks[0].canTrackText,false);assert.throws(()=>apply(e,{type:'track_text',index:0,value:'new'}),/editor_revision_unsupported/);assert.equal(body(e),saved);}
for(const markup of [
  '<w:p><w:ins w:id="1"><w:del w:id="2"><w:r><w:delText>nested</w:delText></w:r></w:del></w:ins></w:p>',
  '<w:p><w:ins w:id="1"><w:hyperlink><w:r><w:t>link</w:t></w:r></w:hyperlink></w:ins></w:p>',
  '<w:p><w:ins w:id="1"><w:r><w:t>a</w:t></w:r></w:ins><w:ins w:id="1"><w:r><w:t>b</w:t></w:r></w:ins></w:p>'
]){const e=fixture(markup),m=model(e);assert(m.revisions.every(r=>!r.supported));assert.throws(()=>apply(e,{type:'accept_revision',index:0,revisionId:'1'}),/editor_revision_not_found|editor_revision_unsupported/);}
for(const op of [{type:'track_text',index:0,value:'x',author:'Fake'},{type:'track_text',index:0,value:'x',date:'2000-01-01'},{type:'track_text',index:0,value:'\x00'},{type:'track_text',index:-1,value:'x'},{type:'accept_revision',index:0,revisionId:1},{type:'accept_revision',index:0,revisionId:'01'},{type:'reject_revision',index:0,revisionId:'2147483648'}])assert.throws(()=>revisions.validateOperation(op),/invalid_editor_revision/);
assert.throws(()=>revisions.apply(fixture(),'spreadsheet',{type:'track_text',index:0,value:'x'},{}),/editor_operation_type_mismatch/);
console.log('PASS native DOCX revisions: formatted tracked text, exact IDs, trusted author, accepted/deleted text, accept/reject, no-op/repeated edits, immutable other parts, roundtrip and unsafe revision protection');
