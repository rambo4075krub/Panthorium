'use strict';
// Deterministic Gemini Live tool dispatch and approval integration, not a test
// of microphone capture, Thai speech recognition or a live model provider.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {_internals,OfficeArtifactService}=require('../services/officeArtifactService');
const {CreativeStudioService}=require('../services/creativeStudioService');
const {MemoryCreativeStudioRepository}=require('../services/creativeStudioRepository');
const {ToolRegistry}=require('../services/toolRegistry');
const {AgentService}=require('../services/agentService');
const {ActionLedgerRepository}=require('../services/actionLedgerRepository');
const {AgentFunctionCallingService}=require('../services/agentFunctionCallingService');
const {registerCreativeStudioTools}=require('../services/creativeStudioTools');
(async()=>{
  const user={sub:randomUUID(),roles:['user'],permissions:['chat']},other={...user,sub:randomUUID()},store=new Map();
  const files={bucket:'test',ensureConfigured(){},async upload(owner,name,contentType,body){const f={id:randomUUID(),name,contentType,size:body.length};store.set(f.id,{...f,owner,body:Buffer.from(body)});return f;},async findObject(owner,id){const f=store.get(id);if(!f||f.owner!==owner)throw Error('file_not_found');const {owner:unused,body,...meta}=f;return meta;},async readOwned(owner,id){return {...await this.findObject(owner,id),body:Buffer.from(store.get(id).body)};},async download(){throw Error('unexpected_download');}};
  const office=new OfficeArtifactService({files}),studio=new CreativeStudioService({files,office,repository:new MemoryCreativeStudioRepository(),resolveUser:async u=>u});await studio.init();
  const registry=new ToolRegistry(),ledger=new ActionLedgerRepository({allowMemory:true});await ledger.init();registerCreativeStudioTools(registry,{studio});
  const agent=new AgentService({tools:registry,ledger}),functions=new AgentFunctionCallingService({agentService:agent});
  let sequence=0;
  const dispatch=(who,name,args)=>functions.execute({user:who,call:{id:'voice-'+(++sequence),name,args},requestId:'review-voice-'+sequence,source:'gemini-live',confirmed:true});
  const read=async(who,fileId)=>dispatch(who,'panthorium_studio_editor',{fileId,open:false});
  async function open(file){const result=await read(user,file.id);assert.equal(result.ok,true,JSON.stringify(result));return result.output;}
  async function edit(file,snapshot,operations,{expectError=false}={}){
    const before=store.size,source=Buffer.from(store.get(file.id).body),args={fileId:file.id,revision:snapshot.revision,pluginId:snapshot.pluginId,operations};
    const proposed=await dispatch(user,'panthorium_studio_edit',args);
    assert.equal(proposed.requiresConfirmation,true,JSON.stringify(proposed));assert.equal(store.size,before,'confirmed:true cannot approve');
    assert.equal((await agent.confirmAction({user:other,actionId:proposed.actionId,approvalHash:proposed.confirmation.approvalHash})).ok,false);
    assert.equal((await agent.confirmAction({user,actionId:proposed.actionId,approvalHash:'0'.repeat(64)})).ok,false);assert.equal(store.size,before);
    const result=await agent.confirmAction({user,actionId:proposed.actionId,approvalHash:proposed.confirmation.approvalHash});
    if(expectError){assert(result.ok===false||result.output?.job?.status==='failed',JSON.stringify(result));assert.equal(store.size,before);assert(store.get(file.id).body.equals(source));return result;}
    assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.output.job.status,'completed',JSON.stringify(result));assert.equal(store.size,before+1);
    const copy=result.output.job.files[0];assert.notEqual(copy.id,file.id);assert.equal((await read(other,copy.id)).ok,false);
    await agent.confirmAction({user,actionId:proposed.actionId,approvalHash:proposed.confirmation.approvalHash});assert.equal(store.size,before+1,'replay creates no duplicate');assert(store.get(file.id).body.equals(source));
    return {file:copy,snapshot:await open(copy)};
  }
  const docBytes=_internals.documentBuffer({title:'รายงาน',sections:[{paragraphs:['ต้นฉบับข้อความ'],rows:[['เซลล์เป้าหมาย','เซลล์เป้าหมาย']]},{paragraphs:['หลังตาราง']}]},[]);
  const doc=await files.upload(user.sub,'review.docx','application/octet-stream',docBytes),docModel=await open(doc),target=docModel.blocks.find(b=>b.text==='ต้นฉบับข้อความ');
  assert(docModel.capabilities.trackableBlockIndexes.includes(target.index));assert(docModel.capabilities.unsupported.includes('tracked_formatting_or_move_revisions'));assert(docModel.capabilities.unsupported.includes('full_pagination'));
  const tracked=await edit(doc,docModel,[{type:'track_text',index:target.index,value:'ข้อความที่เสนอใหม่'}]);
  const block=tracked.snapshot.blocks.find(b=>b.revisions?.length);assert(block);assert.equal(block.canTrackText,false);assert(!tracked.snapshot.capabilities.trackableBlockIndexes.includes(block.index));
  assert(block.revisions.every(r=>r.supported));assert(block.revisions.some(r=>r.type==='insert'));assert(block.revisions.some(r=>r.type==='delete'));
  assert.deepEqual(tracked.snapshot.capabilities.reviewableRevisions,block.revisions.map(r=>({index:block.index,revisionId:r.revisionId})));
  const accepted=await edit(tracked.file,tracked.snapshot,block.revisions.map(r=>({type:'accept_revision',index:block.index,revisionId:r.revisionId})));
  assert.equal(accepted.snapshot.revisions.length,0);assert(accepted.snapshot.blocks.some(b=>b.text==='ข้อความที่เสนอใหม่'));
  const rejected=await edit(tracked.file,tracked.snapshot,block.revisions.map(r=>({type:'reject_revision',index:block.index,revisionId:r.revisionId})));
  assert.equal(rejected.snapshot.revisions.length,0);assert(rejected.snapshot.blocks.some(b=>b.text==='ต้นฉบับข้อความ'));
  await edit(tracked.file,tracked.snapshot,[{type:'accept_revision',index:block.index,revisionId:'999999'}],{expectError:true});
  await edit(tracked.file,tracked.snapshot,[{type:'format_text',index:block.index,style:{bold:true}}],{expectError:true});

  // Two identical labels: only the exact returned second-cell index is targeted.
  const cells=docModel.blocks.filter(b=>b.text==='เซลล์เป้าหมาย');assert.equal(cells.length,2);
  const cell=cells.find(b=>b.table.column===1),after=docModel.blocks.find(b=>b.text==='หลังตาราง');assert(cell&&after);
  const nested=await edit(doc,docModel,[{type:'insert_nested_table',index:cell.index,richRows:[[{text:'ภายในเซลล์ขวา',colSpan:2,rowSpan:1}],[{text:'รายการ',colSpan:1,rowSpan:1},{text:'100',colSpan:1,rowSpan:1}]]},{type:'set_text',index:after.index,value:'หลังตารางยังแก้ถูกย่อหน้า'}]);
  const inner=nested.snapshot.tables.find(t=>t.depth===2);assert(inner);assert.equal(inner.parentTable,cell.table.index);assert.deepEqual(inner.parentCell,{row:cell.table.row,column:1});assert.equal(inner.supported,true);
  const outer=nested.snapshot.tables[inner.parentTable];assert.deepEqual(outer.rows[0][0].childTables,[]);assert.deepEqual(outer.rows[0][1].childTables,[inner.index]);
  assert.equal(nested.snapshot.blocks.filter(b=>b.text==='เซลล์เป้าหมาย').length,2);assert(nested.snapshot.blocks.some(b=>b.text==='หลังตารางยังแก้ถูกย่อหน้า'));
  assert.equal(nested.snapshot.capabilities.limits.maxTableDepth,3);assert(nested.snapshot.capabilities.unsupported.includes('nested_tables_beyond_depth_3'));
  await edit(doc,docModel,[{type:'insert_nested_table',index:target.index,richRows:[[{text:'ผิดเป้าหมาย',colSpan:1,rowSpan:1}]]}],{expectError:true});

  // Native pivot source starts at B: relative field indices must not be treated
  // as absolute worksheet columns. Headers included; grouping and values explicit.
  const xlsxBytes=_internals.spreadsheetBuffer({title:'ยอดขาย',sheets:[{name:'ต้นทาง',rows:[['ID','กลุ่ม','จำนวน'],[1,'ไทย',10],[2,'ไทย',20],[3,'อื่น',5]]}]}),xlsx=await files.upload(user.sub,'pivot.xlsx','application/octet-stream',xlsxBytes),sheet=await open(xlsx);
  assert(sheet.capabilities.operations.includes('insert_pivot'));assert(sheet.capabilities.unsupported.includes('multi_axis_or_calculated_pivot_fields'));assert.deepEqual(sheet.capabilities.pivotSourceSheets,[0]);
  const pivot=await edit(xlsx,sheet,[{type:'insert_pivot',sheet:0,range:'B1:C4',groupColumn:0,valueColumn:1,aggregation:'sum',targetSheetName:'สรุป'},{type:'set_cell',sheet:0,cell:'C2',numericValue:15}]);
  const summary=pivot.snapshot.sheets.find(s=>s.name==='สรุป');assert(summary);assert.equal(summary.readonly,true);
  const cellValue=(s,address)=>s.cells.find(c=>c.cell===address)?.value;
  assert.equal(cellValue(summary,'A2'),'ไทย');assert.equal(cellValue(summary,'B2'),35);assert.equal(cellValue(summary,'B4'),40);
  assert.deepEqual(pivot.snapshot.capabilities.editableSheets,[0]);assert.deepEqual(pivot.snapshot.capabilities.pivotSourceSheets,[0]);
  const packageEntries=_internals.unzip(store.get(pivot.file.id).body);
  assert(packageEntries['xl/pivotTables/panthoriumPivot1.xml']);assert(packageEntries['xl/pivotCache/panthoriumCache1.xml']);assert(packageEntries['xl/pivotCache/panthoriumRecords1.xml']);
  assert(packageEntries['xl/pivotCache/panthoriumCache1.xml'].toString().includes('ref="B1:C4"'));
  const refreshed=await edit(pivot.file,pivot.snapshot,[{type:'set_cell',sheet:0,cell:'C3',numericValue:50}]),newSummary=refreshed.snapshot.sheets.find(s=>s.name==='สรุป');
  assert.equal(cellValue(newSummary,'B2'),65);assert.equal(cellValue(newSummary,'B4'),70);
  const updatedEntries=_internals.unzip(store.get(refreshed.file.id).body);assert(updatedEntries['xl/pivotCache/panthoriumCache1.xml'].toString().includes('<n v="50"/>'));
  await edit(pivot.file,pivot.snapshot,[{type:'set_cell',sheet:1,cell:'B2',numericValue:999}],{expectError:true});

  // Imported pivot capability disclosure must not advertise unsupported mutation.
  const imported=_internals.unzip(xlsxBytes);imported['custom/importedPivot.xml']=Buffer.from('<pivotTableDefinition/>');
  imported['[Content_Types].xml']=Buffer.from(imported['[Content_Types].xml'].toString().replace('</Types>','<Override PartName="/custom/importedPivot.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/></Types>'));
  const foreign=await files.upload(user.sub,'imported.xlsx','application/octet-stream',_internals.zip(imported)),foreignModel=await open(foreign);
  for(const op of ['set_cell','set_formula','format_cell','insert_pivot'])assert(!foreignModel.capabilities.operations.includes(op));assert.deepEqual(foreignModel.capabilities.editableSheets,[]);assert.deepEqual(foreignModel.capabilities.pivotSourceSheets,[]);
  await edit(foreign,foreignModel,[{type:'set_cell',sheet:0,cell:'C2',numericValue:999}],{expectError:true});
  assert(store.get(doc.id).body.equals(docBytes));assert(store.get(xlsx.id).body.equals(xlsxBytes));assert.equal((await read(other,doc.id)).ok,false);
  for(const surface of ['gemini-live','sentinel-chat']){assert(functions.declarationsFor(user,{surface}).some(t=>t.name==='panthorium_studio_edit'));assert(!functions.declarationsFor({...user,roles:['guest']},{surface}).some(t=>t.name==='panthorium_studio_edit'));}
  console.log('PASS Office review voice execution: real dispatch/approval/replay, tracked revisions and decisions, exact nested table target, native pivot final values/refresh, read-only/imported safeguards and bounded capabilities; not live speech recognition');
})().catch(e=>{console.error(e);process.exitCode=1;});
