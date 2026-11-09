'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {_internals:i}=require('../services/officeArtifactService');
const pivot=require('../services/officePivotService');
const make=(rows=[['กลุ่ม','จำนวน','หมายเหตุ'],['ไทย & <A>',12,'one'],['ไทย & <A>',8,'two'],['B',-5,'three'],['',0,'blank']])=>i.unzip(i.spreadsheetBuffer({title:'Pivot',sheets:[{name:"ยอด 'รวม'",rows},{name:'Other',rows:[['Label','Value'],['Source',7]]}]}));
const model={sheets:[{name:"ยอด 'รวม'",file:'xl/worksheets/sheet1.xml'},{name:'Other',file:'xl/worksheets/sheet2.xml'}]};
const op={type:'insert_pivot',sheet:0,range:'A1:C5',groupColumn:0,valueColumn:1,aggregation:'sum',targetSheetName:'สรุปยอด'};
const snapshot=e=>Object.fromEntries(Object.entries(e).map(([k,v])=>[k,v.toString('base64')]));
const clone=e=>i.unzip(i.zip(e));
const worksheet=e=>e['xl/worksheets/panthoriumPivot1.xml'].toString();
const values=e=>i.xmlMatches(worksheet(e),'row').map(r=>i.xmlDirectMatches(r[0],'c').map(c=>c.node.attributes.t==='inlineStr'?i.xmlMatches(c[0],'t')[0][1]:Number(i.xmlMatches(c[0],'v')[0][1])));
const entries=make(),before=snapshot(entries);
assert.equal(pivot.validateOperation({type:'set_cell'}),false);
assert(pivot.apply(entries,'spreadsheet',op,model));
assert.deepEqual(values(entries),[['กลุ่ม','Sum of จำนวน'],['ไทย &amp; &lt;A&gt;',20],['B',-5],['(blank)',0],['Grand Total',15]]);
for(const [file,bytes]of Object.entries(before))if(!['xl/workbook.xml','xl/_rels/workbook.xml.rels','[Content_Types].xml'].includes(file))assert.equal(entries[file].toString('base64'),bytes,'preserve '+file);
for(const [file,body]of Object.entries(entries))if(/\.(xml|rels)$/.test(file)){const dom=new JSDOM(body.toString(),{contentType:'application/xml'});assert(dom.window.document.documentElement,file);dom.window.close();}
assert(entries['xl/pivotCache/panthoriumCache1.xml'].toString().includes('sheet="ยอด &apos;รวม&apos;"'));
assert.equal(i.xmlMatches(entries['xl/pivotCache/panthoriumRecords1.xml'].toString(),'r').length,4);
assert.equal(i.xmlMatches(entries['xl/pivotCache/panthoriumCache1.xml'].toString(),'cacheField').length,3);
assert(entries['xl/pivotTables/panthoriumPivot1.xml'].toString().includes('subtotal="sum"'));
assert.equal(pivot.describe(entries).outputs[0].sourceSheetName,"ยอด 'รวม'");
assert.equal(pivot.describe(entries).importedPivotCount,0);
assert.throws(()=>pivot.assertCellEditable(entries,'xl/worksheets/panthoriumPivot1.xml','C50'),/editor_pivot_result_readonly/);
assert.doesNotThrow(()=>pivot.assertCellEditable(entries,'xl/worksheets/sheet1.xml','B2'));
assert.throws(()=>pivot.apply(entries,'spreadsheet',op,model),/editor_pivot_sheet_exists/);
assert.throws(()=>pivot.apply(entries,'spreadsheet',{...op,targetSheetName:'Other'},model),/editor_pivot_sheet_exists/);
assert.throws(()=>pivot.apply(entries,'spreadsheet',{...op,targetSheetName:'OTHER'},model),/editor_pivot_sheet_exists/);
assert.throws(()=>pivot.apply(entries,'spreadsheet',{...op,sheet:0,targetSheetName:'Again'},{sheets:[{name:'สรุปยอด',file:'xl/worksheets/panthoriumPivot1.xml'}]}),/editor_pivot_derived_source_unsupported/);

// Source edits update visible summary, cache records and native pivot structures.
entries['xl/worksheets/sheet1.xml']=Buffer.from(entries['xl/worksheets/sheet1.xml'].toString().replace('<v>12</v>','<v>20</v>'));
pivot.refresh(entries);assert.equal(values(entries)[1][1],28);assert.equal(values(entries).at(-1)[1],23);
const cache=i.xmlMatches(entries['xl/pivotCache/panthoriumCache1.xml'].toString(),'sharedItems')[1][0];assert(cache.includes('<n v="20"/>'));assert(!cache.includes('<n v="12"/>'));
pivot.apply(entries,'spreadsheet',{...op,aggregation:'average',targetSheetName:'Average'},model);
assert(entries['xl/worksheets/panthoriumPivot2.xml'].toString().includes('<v>14</v>'));
assert(entries['xl/worksheets/panthoriumPivot2.xml'].toString().includes('<v>5.75</v>'),'grand average is weighted over records, not group averages');
pivot.refresh(entries);assert.equal(pivot.describe(entries).outputs.length,2);

const counted=make([['Group','Value'],['a','text'],['a',''],['a',false],['b',3]]);
pivot.apply(counted,'spreadsheet',{...op,range:'A1:B5',aggregation:'count'},model);
assert.deepEqual(values(counted),[['Group','Count of Value'],['a',2],['b',1],['Grand Total',3]]);

// Source formulas use current dependency values, never stale cached values.
const formula=make();formula['xl/worksheets/sheet1.xml']=Buffer.from(formula['xl/worksheets/sheet1.xml'].toString().replace('<v>12</v>','<f>Other!B2*3</f><v>99999</v>'));
pivot.apply(formula,'spreadsheet',op,model);assert.equal(values(formula)[1][1],29);
formula['xl/worksheets/sheet2.xml']=Buffer.from(formula['xl/worksheets/sheet2.xml'].toString().replace('<v>7</v>','<v>8</v>'));
pivot.refresh(formula);assert.equal(values(formula)[1][1],32);
formula['xl/worksheets/sheet1.xml']=Buffer.from(formula['xl/worksheets/sheet1.xml'].toString().replace('Other!B2*3',"'สรุปยอด'!B2"));
const invalidBefore=snapshot(formula);assert.throws(()=>pivot.refresh(formula),/editor_pivot_derived_dependency_unsupported/);assert.deepEqual(snapshot(formula),invalidBefore);
const indirect=make();indirect['xl/worksheets/sheet1.xml']=Buffer.from(indirect['xl/worksheets/sheet1.xml'].toString().replace('<v>12</v>','<f>Other!B2</f><v>12</v>'));indirect['xl/worksheets/sheet2.xml']=Buffer.from(indirect['xl/worksheets/sheet2.xml'].toString().replace('<v>7</v>',"<f>IFERROR('สรุปยอด'!B2,1)</f><v>7</v>"));
assert.throws(()=>pivot.apply(indirect,'spreadsheet',op,model),/editor_pivot_derived_dependency_unsupported/);
const cycle=make();cycle['xl/worksheets/sheet1.xml']=Buffer.from(cycle['xl/worksheets/sheet1.xml'].toString().replace('<v>12</v>','<f>B2+1</f><v>12</v>'));assert.throws(()=>pivot.apply(cycle,'spreadsheet',op,model),/editor_pivot_formula_cycle/);
const formulaError=make();formulaError['xl/worksheets/sheet1.xml']=Buffer.from(formulaError['xl/worksheets/sheet1.xml'].toString().replace('<v>12</v>','<f>1/0</f><v>12</v>'));assert.throws(()=>pivot.apply(formulaError,'spreadsheet',op,model),/editor_pivot_formula_error/);
const unsupported=make();unsupported['xl/worksheets/sheet1.xml']=Buffer.from(unsupported['xl/worksheets/sheet1.xml'].toString().replace('<v>12</v>','<f>WEBSERVICE(&quot;https://evil.test&quot;)</f><v>12</v>'));assert.throws(()=>pivot.apply(unsupported,'spreadsheet',op,model),/editor_pivot_formula_error/);

// Imported or externally rewritten pivots are preserved, never silently refreshed.
const imported=make();imported['custom/importedPivot.xml']=Buffer.from('<pivotTableDefinition/>');imported['[Content_Types].xml']=Buffer.from(imported['[Content_Types].xml'].toString().replace('</Types>','<Override PartName="/custom/importedPivot.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/></Types>'));
const importBefore=snapshot(imported);assert.equal(pivot.describe(imported).importedPivotCount,1);assert.throws(()=>pivot.assertCellEditable(imported,'xl/worksheets/sheet1.xml','B2'),/editor_imported_pivot_edit_unsupported/);pivot.refresh(imported);assert.deepEqual(snapshot(imported),importBefore);
assert.throws(()=>pivot.apply(imported,'spreadsheet',op,model),/editor_imported_pivot_edit_unsupported/);assert.deepEqual(snapshot(imported),importBefore,'adding pivots cannot bypass imported-pivot protection');
const changed=clone(entries);changed['xl/pivotTables/panthoriumPivot1.xml']=Buffer.from(changed['xl/pivotTables/panthoriumPivot1.xml'].toString().replace('subtotal="sum"','subtotal="max"'));
assert.throws(()=>pivot.refresh(changed),/editor_pivot_modified_externally/);assert.equal(pivot.describe(changed).importedPivotCount,2);
const redirected=clone(entries);redirected['xl/pivotTables/_rels/panthoriumPivot1.xml.rels']=Buffer.from(redirected['xl/pivotTables/_rels/panthoriumPivot1.xml.rels'].toString().replace('panthoriumCache1','panthoriumCache2'));assert.throws(()=>pivot.refresh(redirected),/editor_pivot_modified_externally/);

for(const invalid of [
 {...op,range:'A1:A5'},{...op,range:'A1:AO2'},{...op,range:'A1:B1001'},{...op,range:'A1:AN1000'},{...op,range:'B5:A1'},{...op,range:'A1:B1'},
 {...op,groupColumn:'Group'},{...op,groupColumn:1},{...op,valueColumn:3},{...op,sheet:32},{...op,aggregation:'max'},
 {...op,targetSheetName:'Other/Sheet'},{...op,targetSheetName:"'bad"},{...op,targetSheetName:' '},{...op,targetSheetName:'a'.repeat(32)},{...op,extra:true}
])assert.throws(()=>pivot.validateOperation(invalid),/pivot/);
for(const [rows,error]of [
 [[['Name','name'],['x',2]],/ambiguous_headers/],[[['','V'],['x',2]],/ambiguous_headers/],[[['G','V'],['x','2']],/numeric_values_required/],
 [[['G','V'],['A',1],['a',2]],/ambiguous_group/],[[['G','V'],['A',1e308],['A',1e308]],/numeric_overflow/]
]){const e=make(rows),b=snapshot(e);assert.throws(()=>pivot.apply(e,'spreadsheet',{...op,range:`A1:B${rows.length}`},model),error);assert.deepEqual(snapshot(e),b);}
const many=make([['G','V'],...Array.from({length:999},(_,j)=>['g'+j,j])]);assert.throws(()=>pivot.apply(many,'spreadsheet',{...op,range:'A1:B1000'},model),/group_limit/);
assert.deepEqual(snapshot(i.unzip(i.zip(entries))),snapshot(entries));
if(process.env.OFFICE_PIVOT_SAMPLE_PATH)fs.writeFileSync(process.env.OFFICE_PIVOT_SAMPLE_PATH,i.zip(entries));
console.log('PASS native pivots: cache definitions/records, editable native table links, aggregates, refresh, formula dependencies, read-only derived output, imported protection, atomic errors and bounds');
(async()=>{
  const {randomUUID}=require('node:crypto'),{StudioEditorService}=require('../services/studioEditorService');
  const user={sub:randomUUID()},file={id:randomUUID(),name:'imported.xlsx',body:i.zip(imported),contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
  let uploads=0;
  const editor=new StudioEditorService({files:{async readOwned(owner,id){assert.equal(owner,user.sub);assert.equal(id,file.id);return file;},async upload(){uploads++;throw Error('must_not_upload');}}});
  const read=await editor.read(user,file.id);assert(read.sheets.every(s=>s.readonly));
  await assert.rejects(editor.apply({user,pluginId:'spreadsheet',input:{edit:{fileId:file.id,revision:read.revision,operations:[op]}}}),/editor_imported_pivot_edit_unsupported/);
  assert.equal(uploads,0);assert.deepEqual(snapshot(i.unzip(file.body)),importBefore);
  console.log('PASS direct editor API: insert_pivot cannot bypass imported-pivot readonly or create a partial file');
})().catch(e=>{console.error(e);process.exitCode=1;});
