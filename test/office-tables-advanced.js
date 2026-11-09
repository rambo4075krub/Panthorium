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
 '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>outer</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl>',
 '<w:tbl><w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr><w:tc><w:p><w:r><w:t>offset</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
]){
 const unsafe={...entries,'word/document.xml':Buffer.from(_internals.xmlReplace(xml,'w:tbl',replacement,{first:true}))};
 const before=Buffer.from(unsafe['word/document.xml']);const read=tables.enrich(unsafe,officeModel(unsafe,'document'));
 assert.equal(read.tables[0].supported,false);assert(read.blocks.some(b=>b.table?.unsupported));assert(before.equals(unsafe['word/document.xml']));
}
console.log('PASS advanced Office tables: bounded spans, occupancy validation, native vertical/horizontal merges, metadata, round trip and unsupported geometry protection');
