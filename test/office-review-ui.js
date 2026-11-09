'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const {_internals:i}=require('../services/officeArtifactService');
const {officeModel,patchOffice}=require('../services/studioEditorService');
const dom=new JSDOM('<body><main data-studio-editor></main></body>',{runScripts:'outside-only'}),w=dom.window;
for(const f of ['office-suite-core.js','office-suite-ui.js'])w.eval(fs.readFileSync(require.resolve('../'+f),'utf8'));
const body=w.document.querySelector('main'),v={body,ops:[],sheet:0,page:0,data:{pluginId:'document',blocks:[]}};
const el=(tag,text,attrs={})=>{const n=w.document.createElement(tag);if(text!=null)n.textContent=text;for(const [k,value]of Object.entries(attrs))n.setAttribute(k,value);return n;};
const button=(text,fn,attrs={})=>{const n=el('button',text,attrs);n.onclick=fn;return n;};let report='';
const render=()=>{body.textContent='';assert(w.PanthoriumOfficeSuite.render({v,el,button,change:(v,op)=>v.ops.push(op),rerender:render,report:(v,s)=>{report=s;},scheduleDraft:()=>{}}));};
const load=(kind,entries)=>{v.data={pluginId:kind,...officeModel(entries,kind)};v.ops=[];v.selected=null;v.sheet=0;v.page=0;v.cell=null;report='';render();};
const findButton=t=>[...body.querySelectorAll('button')].find(b=>b.textContent===t);
const click=t=>{const b=findButton(t);assert(b,'button '+t);b.click();return b;};
const input=label=>{const n=body.querySelector('[aria-label="'+label+'"]');assert(n,label);return n;};
const submit=form=>form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
const cell=(text,colSpan=1,rowSpan=1)=>({text,colSpan,rowSpan});
const document=()=>i.unzip(i.documentBuffer({title:'รายงาน',sections:[{paragraphs:['เนื้อหาเดิม']}]},[]));
// Native nested geometry renders once, under the actual outer cell.
const nested=document();patchOffice(nested,'document',[{type:'insert_complex_table',rows:[[cell('outer',2)],[cell('left'),cell('right')]]}]);
let m=officeModel(nested,'document');const outer=m.blocks.find(b=>b.text==='outer');
patchOffice(nested,'document',[{type:'insert_nested_table',index:outer.index,rows:[[cell('inner',1,2),cell('other')],[cell('last')]]}]);
m=officeModel(nested,'document');const inner=m.blocks.find(b=>b.text==='inner');
patchOffice(nested,'document',[{type:'insert_nested_table',index:inner.index,rows:[[cell('deep')]]}]);
load('document',nested);
assert.equal(body.querySelectorAll('.po-paper table').length,3);
assert.equal(body.querySelectorAll('.po-paper > table').length,1);
assert.equal(body.querySelectorAll('.po-paper table td table').length,2);
assert(body.querySelector('td[colspan="2"] table td[rowspan="2"] table'));
for(const b of v.data.blocks)assert.equal(body.querySelectorAll('[data-text-index="'+b.index+'"]').length,1,'no duplicated native block '+b.text);
const deep=v.data.blocks.find(b=>b.text==='deep');v.selected=deep.index;render();let prompts=0;w.prompt=()=>{prompts++;return 'too deep';};click('＋ ตารางซ้อนในเซลล์ที่เลือก');assert.equal(prompts,0);assert.equal(v.ops.length,0);assert(report.includes('3 ชั้น'));
v.selected=outer.index;render();w.prompt=()=>null;click('＋ ตารางซ้อนในเซลล์ที่เลือก');assert.equal(v.ops.length,0);
w.prompt=()=> 'a\tb\nc';click('＋ ตารางซ้อนในเซลล์ที่เลือก');assert.equal(v.ops.length,0,'ragged nested input rejected');
w.prompt=()=> 'new\tchild';click('＋ ตารางซ้อนในเซลล์ที่เลือก');assert.equal(v.ops[0].type,'insert_nested_table');assert.equal(v.ops[0].index,outer.index);assert(body.textContent.includes('ตารางซ้อนในข้อความ'));
// Track prompt cancel and unchanged are no-ops; pending track is protected.
const doc=document();load('document',doc);const selected=v.selected;
w.prompt=()=>null;click('แก้ข้อความแบบติดตาม');assert.equal(v.ops.length,0);
w.prompt=()=>v.data.blocks.find(b=>b.index===selected).text;click('แก้ข้อความแบบติดตาม');assert.equal(v.ops.length,0);
w.prompt=()=> 'ฉบับแก้ไข';const track=click('แก้ข้อความแบบติดตาม');assert.equal(v.ops.length,1);assert.equal(v.ops[0].type,'track_text');assert.equal(v.ops[0].value,'ฉบับแก้ไข');
assert.equal(body.querySelector('[data-text-index="'+selected+'"]').getAttribute('contenteditable'),'false');assert(body.textContent.includes('รหัสการแก้ไขจริง'));
track.click();assert.equal(v.ops.length,1,'stale repeated track button does not add another operation');click('ตัวหนา');assert.equal(v.ops.length,1,'pending revisions block formatting');
// Reopen actual revisions, queue decisions once, never guess IDs for pending text.
patchOffice(doc,'document',JSON.parse(JSON.stringify(v.ops)));load('document',doc);assert(body.querySelector('[aria-label="ตรวจการแก้ไขเอกสาร"]'));
const changes=v.data.revisions;assert(changes.length>=2);const accept=findButton('ยอมรับ #'+changes[0].revisionId);accept.click();accept.click();assert.equal(v.ops.length,1);
assert.equal(v.ops[0].revisionId,changes[0].revisionId);assert(!findButton('ปฏิเสธ #'+changes[0].revisionId),'opposite decision hidden while pending');
click('ปฏิเสธ #'+changes[1].revisionId);assert.equal(v.ops.length,2);assert.equal(v.ops[1].type,'reject_revision');
click('ยอมรับทั้งหมดที่รองรับ');const decided=v.ops.length;click('ยอมรับทั้งหมดที่รองรับ');click('ปฏิเสธทั้งหมดที่รองรับ');assert.equal(v.ops.length,decided,'bulk decisions do not duplicate queued IDs');
// Empty current text still has visible deletion review controls after reopening.
const deletion=document();const deletionIndex=officeModel(deletion,'document').blocks.find(b=>b.text==='เนื้อหาเดิม').index;
patchOffice(deletion,'document',[{type:'track_text',index:deletionIndex,value:''}]);load('document',deletion);
const deleted=v.data.blocks.find(b=>b.revisions?.some(r=>r.type==='delete'));assert(deleted);assert.equal(deleted.text,'');assert(findButton('ปฏิเสธ #'+deleted.revisions[0].revisionId));
// Native pivot form validates range/columns/names and guards existing/pending names.
const book=i.unzip(i.spreadsheetBuffer({title:'ยอด',sheets:[{name:'Source',rows:[['Group','Value'],['A',10],['B',20]]}]}));load('spreadsheet',book);
const fields={range:'ช่วงข้อมูล Pivot รวมหัวตาราง',group:'คอลัมน์จัดกลุ่มในช่วง (เริ่ม 1)',value:'คอลัมน์ค่าในช่วง (เริ่ม 1)',name:'ชื่อชีตผล Pivot'};
function pivot(values={}){for(const [key,value]of Object.entries({range:'A1:B3',group:'1',value:'2',name:'Summary',...values}))input(fields[key]).value=value;submit(input(fields.range).closest('form'));}
for(const invalid of [{range:'A1:A3'},{range:'A3:B1'},{range:'A1:AO3'},{group:'2',value:'2'},{group:'1.5'},{value:'3'},{name:'bad/name'},{name:"'bad"},{name:'source'}]){pivot(invalid);assert.equal(v.ops.length,0,'invalid pivot '+JSON.stringify(invalid));}
pivot();assert.equal(v.ops.length,1);assert.deepEqual(JSON.parse(JSON.stringify(v.ops[0])),{type:'insert_pivot',sheet:0,range:'A1:B3',groupColumn:0,valueColumn:1,aggregation:'sum',targetSheetName:'Summary'});assert(body.textContent.includes('Pivot Summary รอการบันทึก'));
pivot({name:'summary'});assert.equal(v.ops.length,1,'pending name is case insensitive');pivot({name:'Another'});assert.equal(v.ops.length,2,'distinct pending pivot accepted');
// Reopen actual output, protect both grid and all mutation entry points.
patchOffice(book,'spreadsheet',JSON.parse(JSON.stringify(v.ops)));load('spreadsheet',book);click('Summary');
assert(body.textContent.includes('ผล Pivot แบบอ่านอย่างเดียว'));
assert([...body.querySelectorAll('[data-cell]')].every(n=>n.readOnly));
assert(input('ค่าหรือสูตร').readOnly);assert(findButton('ใช้ค่า / สูตร').disabled);assert(input('รูปแบบตัวเลข').disabled);
input('ค่าหรือสูตร').value='999';submit(input('ค่าหรือสูตร').closest('form'));assert.equal(v.ops.length,0);
click('ตัวหนา');assert.equal(v.ops.length,0);pivot({name:'Derived'});assert.equal(v.ops.length,0);
const grid=body.querySelector('[data-cell="B2"]');grid.value='123';grid.dispatchEvent(new w.Event('change'));assert.equal(v.ops.length,0,'readonly handler remains safe under synthetic change');
click('Source');assert.equal(body.querySelector('[data-cell="B2"]').readOnly,false,'source stays editable');assert.equal(input('ค่าหรือสูตร').readOnly,false);assert.equal(findButton('ใช้ค่า / สูตร').disabled,false);
dom.window.close();console.log('PASS Office review UI: native nested hierarchy, revision cancel/pending/repeated decisions/delete-only review, pivot validation/names and readonly output guards');
