'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const core=require('../office-suite-core');
const {StudioEditorService,validateEdit}=require('../services/studioEditorService');
const {_internals}=require('../services/officeArtifactService');
function value(formula,cells=[],sheets=[]){return core.calculate([{name:'Sheet1',cells:[...cells,{cell:'Z99',formula:true,formulaText:formula,value:0}]},...sheets])[0].cells.at(-1);}
(async()=>{
  for(const [formula,want]of [['=1+2*3',7],['=(1+2)*3',9],['=2^3^2',512],['=50%*200',100],['=ROUND(-1.25,1)',-1.3],['=IF(FALSE,1/0,SUM(1,2))',3],['=AND(1=1,NOT(FALSE))',true],['=COUNTA("x",2,"")',2],['=AVERAGE(10,20)',15],['=MAX(1,2,3)-MIN(1,2,3)',2]])assert.equal(value(formula).calculated,want,formula);
  const cells=[{cell:'A1',value:20},{cell:'A2',value:30},{cell:'B1',formula:true,formulaText:'=SUM(A1:A2)',value:0}];
  assert.equal(value('=B1+\'ยอด รวม\'!$A$1',cells,[{name:'ยอด รวม',cells:[{cell:'A1',value:7}]}]).calculated,57);
  assert.equal(value('=A1',[{cell:'A1',formula:true,formulaText:'=Z99'}]).calculated,'#CYCLE!');
  assert.equal(value('=A1:A2',cells).calculated,'#VALUE!','unsupported array result never becomes an invalid numeric cache');assert.equal(value('=A1',[{cell:'A1',cellError:'#DIV/0!',value:'#DIV/0!'}]).calculated,'#DIV/0!');
  assert.equal(value('=1/0').calculated,'#DIV/0!');assert.equal(value('=IMPORTXML("https://evil.test")').calculated,'#NAME?');assert.equal(value('=SUM(A1:Z9999)').calculated,'#LIMIT!');
  for(const bad of ['=globalThis.process.exit()','=WEBSERVICE("https://evil.test")','=A1.constructor','=SUM(1);alert(1)'])assert.throws(()=>core.parse(bad));
  const user={sub:randomUUID()},store=new Map(),files={async upload(owner,name,contentType,body){const f={id:randomUUID(),name,contentType,body:Buffer.from(body),owner};store.set(f.id,f);return {id:f.id,name,contentType};},async readOwned(owner,id){const f=store.get(id);if(!f||f.owner!==owner)throw Error('file_not_found');return f;}};
  const editor=new StudioEditorService({files});
  async function edit(kind,file,ops){const read=await editor.read(user,file.id),result=await editor.apply({user,pluginId:kind,input:{edit:{fileId:file.id,revision:read.revision,operations:ops}}});return {model:await editor.read(user,result.files[0].id),entries:_internals.unzip(store.get(result.files[0].id).body),file:result.files[0]};}
  const sheet=await files.upload(user.sub,'data.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',_internals.spreadsheetBuffer({title:'ข้อมูล',sheets:[{name:'Sheet1',rows:[['รายการ','ยอด'],['A',100],['B',200]]},{name:'สอง',rows:[[7]]}]}));
  const result=await edit('spreadsheet',sheet,[{type:'set_formula',sheet:0,cell:'B4',value:'=SUM(B2:B3)+\'สอง\'!A1'},{type:'format_cell',sheet:0,cell:'B4',style:{bold:true,color:'AA3300',numberFormat:'decimal',align:'right'}}]);
  const b4=result.model.sheets[0].cells.find(c=>c.cell==='B4');assert.equal(b4.calculated,307);assert.equal(b4.value,307);assert.equal(b4.formulaText,'=SUM(B2:B3)+\'สอง\'!A1');assert.equal(b4.style.bold,true);assert.equal(b4.style.numberFormat,'decimal');assert.equal(b4.style.color,'AA3300');assert.equal(b4.style.align,'right');
  assert(result.entries['xl/workbook.xml'].toString().includes('fullCalcOnLoad="1"'));
  const changed=await edit('spreadsheet',result.file,[{type:'set_cell',sheet:0,cell:'B2',value:150}]);assert.equal(changed.model.sheets[0].cells.find(c=>c.cell==='B4').value,357,'dependent native cache recalculated');
  const unknown=_internals.unzip(store.get(result.file.id).body);unknown['xl/worksheets/sheet1.xml']=Buffer.from(unknown['xl/worksheets/sheet1.xml'].toString().replace(/<f>[\s\S]*?<\/f>/,'<f>XLOOKUP(B2,A1:A3,B1:B3)</f>'));const external=await files.upload(user.sub,'external.xlsx','application/octet-stream',_internals.zip(unknown));const retained=await edit('spreadsheet',external,[{type:'set_cell',sheet:0,cell:'B2',value:200}]);assert(retained.entries['xl/worksheets/sheet1.xml'].toString().includes('XLOOKUP'));assert.equal(retained.model.sheets[0].cells.find(c=>c.cell==='B4').calculationError,true);assert.equal(retained.model.sheets[0].cells.find(c=>c.cell==='B4').value,'');
  const doc=await files.upload(user.sub,'doc.docx','application/octet-stream',_internals.documentBuffer({title:'หัวเรื่อง',sections:[{heading:'เนื้อหา',paragraphs:['ทดสอบ']}]},[]));
  const formatted=await edit('document',doc,[{type:'format_text',index:0,style:{bold:true,italic:true,fontSize:32,color:'AA5511',align:'center'}},{type:'insert_table',rows:[['ชื่อ','ยอด'],['A','100']]}]);
  assert.equal(formatted.model.blocks[0].style.fontSize,32);assert.equal(formatted.model.blocks[0].style.bold,true);assert.equal(formatted.model.blocks[0].style.align,'center');assert(formatted.entries['word/document.xml'].toString().includes('<w:tbl>'));assert.equal(formatted.model.blocks.at(-1).text,'100');
  const plain=await edit('document',formatted.file,[{type:'format_text',index:0,style:{bold:false,italic:false,underline:false}}]);assert.equal(plain.model.blocks[0].style.bold,false);
  const deck=await files.upload(user.sub,'deck.pptx','application/octet-stream',_internals.presentationBuffer({title:'งานนำเสนอ',slides:[{title:'หน้าหนึ่ง',bullets:['ข้อมูล']},{title:'หน้าสอง',bullets:['เก็บไว้']}]},[]));
  const slides=await edit('presentation',deck,[{type:'move_text',index:0,x:10,y:10,width:75,height:20},{type:'format_text',index:0,style:{fontSize:40,bold:true,color:'CC5500',align:'center'}},{type:'slide_background',page:1,color:'FFF4E8'},{type:'add_slide_text',page:2,value:'กล่องข้อความใหม่'}]);
  assert.equal(slides.model.pageCount,2);assert.equal(slides.model.blocks[0].geometry.x,10);assert.equal(slides.model.blocks[0].geometry.width,75);assert.equal(slides.model.blocks[0].style.fontSize,40);assert.equal(slides.model.backgrounds[0],'FFF4E8');assert(slides.model.blocks.some(b=>b.text==='กล่องข้อความใหม่'&&b.page===2));assert(!JSON.stringify(slides.model).includes('ppt/slides/'));
  const expanded=await edit('presentation',slides.file,[{type:'add_slide',value:'หน้าใหม่ของ Panthorium'},{type:'reorder_slide',page:2,toPage:1}]);assert.equal(expanded.model.pageCount,3);assert.equal(expanded.model.blocks[0].text,'หน้าสอง');assert(expanded.model.blocks.some(b=>b.text==='หน้าใหม่ของ Panthorium'&&b.page===3));
  const before=_internals.unzip(store.get(deck.id).body);for(const name of Object.keys(before))if(!['ppt/slides/slide1.xml','ppt/slides/slide2.xml'].includes(name))assert(before[name].equals(slides.entries[name]),'preserve '+name);
  const {JSDOM}=require('jsdom');for(const packageEntries of [formatted.entries,result.entries,slides.entries,expanded.entries])for(const [path,bytes]of Object.entries(packageEntries))if(/\.(xml|rels)$/.test(path)){const dom=new JSDOM(bytes.toString(),{contentType:'application/xml'});assert(dom.window.document.documentElement,path);dom.window.close();}
  const image={name:'sample.png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2e8AAAAASUVORK5CYII=','base64')};
  for(const [kind,ext,buffer]of [['document','docx',_internals.documentBuffer({title:'Pictures',sections:[{paragraphs:['Image below']}]},[image])],['presentation','pptx',_internals.presentationBuffer({title:'Pictures',slides:[{title:'Image',bullets:['Picture']}]},[image])]]){
    const file=await files.upload(user.sub,'picture.'+ext,'application/octet-stream',buffer),read=await editor.read(user,file.id);assert.equal(read.media.length,1);assert(read.media[0].dataUrl.startsWith('data:image/png;base64,'));assert(!JSON.stringify(read).includes('/media/'));
  }
  assert(formatted.model.blocks.filter(b=>b.table).length===4,'native table cell structure is exposed for editing');
  const base={fileId:doc.id,revision:'a'.repeat(64)};for(const op of [{type:'format_text',index:0,style:{color:'red;url(x)'}},{type:'format_text',index:0,style:{fontSize:9999}},{type:'move_text',index:0,x:99,y:1,width:5,height:5},{type:'insert_table',rows:[['a'],['b','c']]},{type:'set_formula',sheet:0,cell:'A1',value:'=WEBSERVICE("https://evil.test")'}])assert.throws(()=>validateEdit({...base,operations:[op]}));
  await assert.rejects(editor.read({sub:randomUUID()},doc.id),/file_not_found/);
  console.log('PASS Office suite: formula interpreter, cycles/bounds, cross-sheet recalculation and native caches, unsupported-formula preservation, native styles/tables/slide geometry, ownership and validation');
})().catch(e=>{console.error(e);process.exitCode=1;});
