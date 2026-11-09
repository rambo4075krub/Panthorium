'use strict';
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { _internals:i } = require('../services/officeArtifactService');
const charts = require('../services/officeChartService');
const make = () => i.unzip(i.spreadsheetBuffer({title:'กราฟ',sheets:[
  {name:"ยอด 'รวม' & <ไทย>",rows:[['รายการ','ยอด'],['ก & <ข>',12],['ค',-5],['ง',0]]},
  {name:'Other',rows:[['ยอดอ้างอิง',7]]}
]}));
const model = {sheets:[{name:"ยอด 'รวม' & <ไทย>",file:'xl/worksheets/sheet1.xml',cells:[]},{name:'Other',file:'xl/worksheets/sheet2.xml',cells:[]}]};
const op = {type:'insert_chart',sheet:0,range:'A2:B4',title:'ยอดขาย <ไทย> & "รวม"'};
const snapshot = e => Object.fromEntries(Object.entries(e).map(([k,v])=>[k,v.toString('base64')]));
const entries = make(), before = snapshot(entries);
assert.equal(charts.validateOperation({type:'set_cell'}),false);
assert.equal(charts.apply(entries,'spreadsheet',op,model),true);
const chartFile = 'xl/charts/panthoriumChart1.xml';
let chart = entries[chartFile].toString();
assert(chart.includes('ยอดขาย &lt;ไทย&gt; &amp; &quot;รวม&quot;'));
assert(chart.includes('ก &amp; &lt;ข&gt;'));
assert(chart.includes('<c:v>-5</c:v>'));
assert(chart.includes('<c:v>0</c:v>'));
assert(chart.includes('&apos;ยอด &apos;&apos;รวม&apos;&apos; &amp; &lt;ไทย&gt;&apos;!$A$2:$A$4'));
assert(chart.includes('urn:panthorium:chart'));
for(const [file,bytes] of Object.entries(before))if(!['[Content_Types].xml','xl/worksheets/sheet1.xml'].includes(file))assert.equal(entries[file].toString('base64'),bytes,'preserve '+file);
assert(entries['xl/worksheets/_rels/sheet1.xml.rels'].toString().includes('Target="../drawings/panthoriumDrawing1.xml"'));
assert(entries['xl/drawings/_rels/panthoriumDrawing1.xml.rels'].toString().includes('Target="../charts/panthoriumChart1.xml"'));
for(const [file,body] of Object.entries(entries))if(/\.(xml|rels)$/.test(file)){const dom=new JSDOM(body.toString(),{contentType:'application/xml'});assert(dom.window.document.documentElement,file);dom.window.close();}
const saved = snapshot(entries);
assert.throws(()=>charts.apply(entries,'spreadsheet',op,model),/editor_chart_existing_drawing/);
assert.deepEqual(snapshot(entries),saved,'failed insert never changes a package');
charts.apply(entries,'spreadsheet',{...op,sheet:1,range:'A1:B1'},model);
assert(entries['xl/charts/panthoriumChart2.xml']);

// Current entries, not the snapshot model or stale formula cache, feed the chart.
const formulas=make();
formulas['xl/worksheets/sheet1.xml']=Buffer.from(formulas['xl/worksheets/sheet1.xml'].toString().replace('<v>12</v>','<f>Other!B1*3</f><v>99999</v>'));
charts.apply(formulas,'spreadsheet',op,model);
assert(formulas[chartFile].toString().includes('<c:v>21</c:v>'));
assert(!formulas[chartFile].toString().includes('99999'));
formulas['xl/worksheets/sheet2.xml']=Buffer.from(formulas['xl/worksheets/sheet2.xml'].toString().replace('<v>7</v>','<v>8</v>'));
charts.refresh(formulas,model);
assert(formulas[chartFile].toString().includes('<c:v>24</c:v>'));
assert(!formulas[chartFile].toString().includes('<c:v>21</c:v>'));
formulas['xl/worksheets/sheet1.xml']=Buffer.from(formulas['xl/worksheets/sheet1.xml'].toString().replace('Other!B1*3','1/0'));
charts.refresh(formulas,model);
assert(!formulas[chartFile].toString().includes('<c:v>24</c:v>'),'formula errors clear old caches');
const cachedNum=i.xmlMatches(formulas[chartFile].toString(),'c:numCache')[0][0];
assert(!cachedNum.includes('idx="0"'),'formula error is a gap');
assert(cachedNum.includes('idx="1"'),'remaining negative values remain');
// Imported charts with similar names but no marker are not rewritten.
const imported=make(); imported[chartFile]=Buffer.from('<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart/></c:chartSpace>');
const original=Buffer.from(imported[chartFile]);charts.refresh(imported,model);assert(imported[chartFile].equals(original));

for(const invalid of [
  {...op,range:'A1:C2'},{...op,range:'B1:A2'},{...op,range:'A2:B1'},
  {...op,range:'A1:B101'},{...op,range:'AN1:AO2'},{...op,range:'A1000:B1001'},
  {...op,range:"Other!A1:B2"},{...op,range:'a1:b2'},{...op,sheet:32},
  {...op,title:'x'.repeat(161)},{...op,title:'\u0000bad'},{...op,title:''},{...op,extra:'<xml>'}
])assert.throws(()=>charts.validateOperation(invalid),/invalid_editor_chart/);
assert(charts.validateOperation({...op,range:'A1:B100'}));
assert(charts.validateOperation({...op,range:'AM1000:AN1000'}));
assert.throws(()=>charts.apply(make(),'document',op,model),/editor_operation_type_mismatch/);
assert.throws(()=>charts.apply(make(),'spreadsheet',{...op,sheet:2},model),/editor_operation_type_mismatch/);
const invalidData=make(), invalidBefore=snapshot(invalidData);
assert.throws(()=>charts.apply(invalidData,'spreadsheet',{...op,range:'A1:B4'},model),/editor_chart_numeric_values_required/);
assert.deepEqual(snapshot(invalidData),invalidBefore);
const badFormula=make(); badFormula['xl/worksheets/sheet1.xml']=Buffer.from(badFormula['xl/worksheets/sheet1.xml'].toString().replace('<v>12</v>','<f>1/0</f><v>12</v>'));
assert.throws(()=>charts.apply(badFormula,'spreadsheet',op,model),/editor_chart_formula_error/);
// Content after drawing keeps the SpreadsheetML ordering rules.
const trailing=make();trailing['xl/worksheets/sheet1.xml']=Buffer.from(trailing['xl/worksheets/sheet1.xml'].toString().replace('</worksheet>','<extLst/></worksheet>'));
charts.apply(trailing,'spreadsheet',op,model);
assert(trailing['xl/worksheets/sheet1.xml'].toString().indexOf('<drawing ')<trailing['xl/worksheets/sheet1.xml'].toString().indexOf('<extLst'));
assert.deepEqual(snapshot(i.unzip(i.zip(entries))),snapshot(entries),'native ZIP roundtrip');
console.log('PASS native Office charts: OOXML relationships, safe escaped caches, source references, formula recalculation, stale-cache clearing, existing-drawing protection, bounds and roundtrip');
const explicitNumeric=make();explicitNumeric['xl/worksheets/sheet1.xml']=Buffer.from(i.xmlReplace(explicitNumeric['xl/worksheets/sheet1.xml'].toString(),'c',c=>i.xmlMatches(c,'v').length?c.replace('<c ','<c t="n" '):c));
const explicitModel=require('../services/studioEditorService').officeModel(explicitNumeric,'spreadsheet');assert.equal(explicitModel.sheets[0].cells.find(c=>c.cell==='B2').value,12);
charts.apply(explicitNumeric,'spreadsheet',op,model);assert(explicitNumeric[chartFile].toString().includes('<c:v>12</c:v>'));
