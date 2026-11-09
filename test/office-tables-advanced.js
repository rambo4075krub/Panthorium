'use strict';
const assert=require('node:assert/strict');
const tables=require('../services/officeTableService');
const {_internals}=require('../services/officeArtifactService');
const {officeModel}=require('../services/studioEditorService');
const cell=(text,colSpan=1,rowSpan=1)=>({text,colSpan,rowSpan});
const rows=[[cell('หัวข้อ',2),cell('ยอด',1,3)],[cell('ไทย'),cell('<&>')],[cell('รวม',2)]];
const op={type:'insert_complex_table',rows};
assert.equal(tables.validateOperation(op),true);
assert.equal(tables.validateOperation({type:'append_paragraph'}),false);
const layout=tables.layout(rows);assert.equal(layout.width,3);assert.equal(layout.grid[2][2],layout.grid[0][2]);
const entries=_internals.unzip(_internals.documentBuffer({title:'รายงาน',sections:[{paragraphs:['ต้นฉบับ']}]},[]));
const original=Object.fromEntries(Object.entries(entries).map(([k,v])=>[k,Buffer.from(v)]));
assert.equal(tables.apply(entries,op),true);
const xml=entries['word/document.xml'].toString();
assert(xml.includes('<w:gridSpan w:val="2"/>'));
assert.equal((xml.match(/<w:vMerge w:val="restart"\/>/g)||[]).length,1);
assert.equal((xml.match(/<w:vMerge\/>/g)||[]).length,2);
assert(xml.includes('&lt;&amp;&gt;'));
assert(xml.indexOf('</w:tbl>')<xml.lastIndexOf('<w:sectPr'));
for(const [name,body]of Object.entries(original))if(name!=='word/document.xml')assert(body.equals(entries[name]),'preserve '+name);
const reopen=_internals.unzip(_internals.zip(entries));_internals.validateOfficeXmlEntries(reopen);
const model=tables.enrich(reopen,officeModel(reopen,'document'));
assert.equal(model.tables.length,1);assert.equal(model.tables[0].supported,true);assert.equal(model.tables[0].columns,3);
assert.deepEqual(model.tables[0].rows.map(r=>r.map(c=>[c.column,c.colSpan,c.rowSpan])),[[[0,2,1],[2,1,3]],[[0,1,1],[1,1,1]],[[0,2,1]]]);
assert.equal(model.blocks.find(b=>b.text==='ยอด').table.rowSpan,3);
assert.equal(model.blocks.find(b=>b.text==='รวม').table.colSpan,2);
const bytesBefore=Buffer.from(reopen['word/document.xml']);tables.enrich(reopen,model);assert(bytesBefore.equals(reopen['word/document.xml']),'inspection never changes imported bytes');
assert.equal(tables.layout([[cell('ทั้งตาราง',2,2)],[]]).width,2,'fully merged continuation rows allowed');
for(const bad of [[],[[]],[[cell('a',0)]],[[cell('a',1.5)]],[[cell('a',11)]],[[cell('a',1,2)]],[[cell('a'),cell('b')],[cell('c')]],[[cell('a'),cell('b',1,2)],[cell('overlap',2)]],[[cell('a')],[cell('overflow'),cell('b')]],[[{text:'bad',colSpan:1,rowSpan:1,html:'x'}]],[[cell('x'.repeat(501))]],Array.from({length:31},()=>[cell('x')])])assert.throws(()=>tables.validateOperation({type:'insert_complex_table',rows:bad}),/invalid_editor_table/);
assert.throws(()=>tables.validateOperation({...op,extra:true}),/invalid_editor_table/);
for(const replacement of [
 '<w:tbl><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p><w:r><w:t>orphan</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
 '<w:tbl><w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr><w:tc><w:p><w:r><w:t>offset</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
]){
 const unsafe={...entries,'word/document.xml':Buffer.from(_internals.xmlReplace(xml,'w:tbl',replacement,{first:true}))};
 const before=Buffer.from(unsafe['word/document.xml']);const read=tables.enrich(unsafe,officeModel(unsafe,'document'));
 assert.equal(read.tables[0].supported,false);assert(read.blocks.some(b=>b.table?.unsupported));assert(before.equals(unsafe['word/document.xml']));
}
// Bounded nesting: exact original block identity survives inserted paragraphs.
const nestedEntries=Object.fromEntries(Object.entries(entries).map(([k,v])=>[k,Buffer.from(v)]));
const batchModel=officeModel(nestedEntries,'document');
const target=batchModel.blocks.find(b=>b.text==='หัวข้อ'),later=batchModel.blocks.find(b=>b.text==='รวม');
const oldLater=later.ordinal;
const nestedOp={type:'insert_nested_table',index:target.index,rows:[[cell('ชั้นสอง',2),cell('ข้อมูล')],[cell('A'),cell('B'),cell('C')]]};
assert.equal(tables.validateOperation(nestedOp),true);
assert(tables.apply(nestedEntries,nestedOp,batchModel));
assert(later.ordinal>oldLater,'later original paragraph ordinal shifts safely');
let currentXml=nestedEntries['word/document.xml'].toString();
assert(_internals.xmlMatches(currentXml,'w:p',true)[later.ordinal][0].includes('รวม'));
assert(_internals.xmlMatches(currentXml,'w:p',true)[target.ordinal][0].includes('หัวข้อ'),'target unchanged');
// Repeated insert in same cell preserves both original target and previous child.
assert(tables.apply(nestedEntries,{...nestedOp,rows:[[cell('ตารางเพื่อน')]]},batchModel));
currentXml=nestedEntries['word/document.xml'].toString();
const originalLater=_internals.xmlMatches(currentXml,'w:p',true)[later.ordinal];
nestedEntries['word/document.xml']=Buffer.from(_internals.xmlReplaceSelected(currentXml,[originalLater],p=>p.replace('รวม','รวมแก้ไข')));
let nestedModel=officeModel(nestedEntries,'document');
assert.equal(nestedModel.tables.length,3);assert(nestedModel.tables.every(t=>t.supported));
assert.equal(nestedModel.tables[0].parentTable,null);
assert.deepEqual(nestedModel.tables[1].parentCell,{row:0,column:0});assert.equal(nestedModel.tables[1].parentTable,0);assert.equal(nestedModel.tables[1].depth,2);
const outerCell=nestedModel.tables[0].rows[0][0];
assert.deepEqual(outerCell.childTables,[1,2]);assert.equal(outerCell.blockIndices.length,1,'inner paragraphs excluded from parent cell');
assert.deepEqual(outerCell.content.map(x=>x.type),['paragraph','table','table']);
assert(nestedModel.blocks.some(b=>b.text==='รวมแก้ไข'));
assert.equal(nestedModel.blocks.find(b=>b.text==='ชั้นสอง').table.index,1);
const inner=nestedModel.blocks.find(b=>b.text==='ชั้นสอง');
tables.apply(nestedEntries,{type:'insert_nested_table',index:inner.index,rows:[[cell('ชั้นสาม')]]},nestedModel);
nestedModel=officeModel(nestedEntries,'document');
assert.equal(nestedModel.tables.find(t=>t.depth===3).parentTable,1);
const deepest=nestedModel.blocks.find(b=>b.text==='ชั้นสาม'),beforeTooDeep=Buffer.from(nestedEntries['word/document.xml']);
assert.throws(()=>tables.apply(nestedEntries,{type:'insert_nested_table',index:deepest.index,rows:[[cell('เกิน')]]},nestedModel),/editor_table_nesting_limit/);
assert(beforeTooDeep.equals(nestedEntries['word/document.xml']));
assert.throws(()=>tables.apply(nestedEntries,{type:'insert_nested_table',index:0,rows:[[cell('outside')]]},nestedModel),/editor_nested_table_target/);
for(const index of [-1,2000,1.2,'1'])assert.throws(()=>tables.validateOperation({...nestedOp,index}),/invalid_editor_table/);
assert.throws(()=>tables.validateOperation({...nestedOp,extra:true}),/invalid_editor_table/);
_internals.validateOfficeXmlEntries(_internals.unzip(_internals.zip(nestedEntries)));
for(const [name,body]of Object.entries(original))if(name!=='word/document.xml')assert(body.equals(nestedEntries[name]),'nested preserve '+name);
// The document-wide table budget applies equally to root and nested insertion.
const limited=Object.fromEntries(Object.entries(original).map(([k,v])=>[k,Buffer.from(v)]));
for(let i=0;i<100;i++)tables.apply(limited,{type:'insert_complex_table',rows:[[cell('table '+i)]]});
const limitBytes=Buffer.from(limited['word/document.xml']);
assert.equal(_internals.xmlMatches(limitBytes.toString(),'w:tbl').length,100);
assert.throws(()=>tables.apply(limited,{type:'insert_complex_table',rows:[[cell('overflow')]]}),/editor_table_limit/);
const limitModel=officeModel(limited,'document'),limitTarget=limitModel.blocks.find(b=>b.text==='table 0');
assert.throws(()=>tables.apply(limited,{type:'insert_nested_table',index:limitTarget.index,rows:[[cell('overflow')]]},limitModel),/editor_table_limit/);
assert(limitBytes.equals(limited['word/document.xml']),'budget rejection is atomic');
console.log('PASS advanced Office tables: bounded spans, occupancy validation, native vertical/horizontal merges, metadata, round trip and unsupported geometry protection');
