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
  const dispatch=(who,name,args)=>functions.execute({user:who,call:{id:'voice-'+(++sequence),name,args},requestId:'advanced-voice-'+sequence,source:'gemini-live',confirmed:true});
  const read=async(who,fileId)=>dispatch(who,'panthorium_studio_editor',{fileId,open:false});
  const fixtures=[
    {pluginId:'document',name:'รายงาน.docx',bytes:_internals.documentBuffer({title:'รายงาน',sections:[{paragraphs:['ต้นฉบับต้องไม่เปลี่ยน']}]},[]),operations:[
      {type:'set_page_text',part:'header',value:'รายงานยอดขายไทย <ตรวจแล้ว>'},
      {type:'set_page_text',part:'footer',value:'ฉบับตรวจสอบ & อนุมัติ'},
      {type:'insert_complex_table',richRows:[[{text:'สรุปยอด',colSpan:2,rowSpan:1}],[{text:'ภาคกลาง',colSpan:1,rowSpan:2},{text:'100',colSpan:1,rowSpan:1}],[{text:'200',colSpan:1,rowSpan:1}]]}
    ]},
    {pluginId:'spreadsheet',name:'ยอดขาย.xlsx',bytes:_internals.spreadsheetBuffer({title:'ยอดขาย',sheets:[{name:'ไทย',rows:[['รายการ','ยอด','ฐาน'],['กรุงเทพ',10,5],['เชียงใหม่',20,7]]}]}),operations:[
      // The chart deliberately precedes edits. Its final cache must not use 10/20.
      {type:'insert_chart',sheet:0,range:'A2:B3',title:'ยอดหลังแก้ไข'},
      {type:'set_cell',sheet:0,cell:'C2',numericValue:100},
      {type:'set_cell',sheet:0,cell:'C3',numericValue:200},
      {type:'set_formula',sheet:0,cell:'B2',value:'=SUMIF(A2:A3,"กรุงเทพ",C2:C3)'},
      {type:'set_formula',sheet:0,cell:'B3',value:'=SUMIFS(C2:C3,A2:A3,"เชียงใหม่")'}
    ]}
  ];
  for(const fixture of fixtures){
    const original=await files.upload(user.sub,fixture.name,'application/octet-stream',fixture.bytes),opened=await read(user,original.id);
    assert.equal(opened.ok,true);assert.equal(opened.output.pluginId,fixture.pluginId);assert.match(opened.output.revision,/^[a-f0-9]{64}$/);
    const capability=opened.output.capabilities;
    assert.equal(capability.saveMode,'new_owned_copy');assert.equal(capability.requiresUserApproval,true);assert.equal(capability.requiresExactRevision,true);
    if(fixture.pluginId==='document'){
      assert.equal(opened.output.pageText.editable,true);assert(capability.operations.includes('set_page_text'));assert(capability.operations.includes('insert_complex_table'));
      assert.deepEqual(capability.protectedBlockIndexes,[]);assert.equal(capability.limits.maxTableColumns,10);
    }else{
      assert(capability.operations.includes('insert_chart'));assert(capability.operations.includes('set_formula'));assert(capability.formulaFunctions.includes('SUMIFS'));
      assert.deepEqual(capability.chartAvailableSheets,[0]);assert.equal(capability.limits.maxChartRows,100);assert.equal(opened.output.sheets[0].hasDrawing,false);
    }
    const deniedRead=await read(other,original.id);assert.equal(deniedRead.ok,false);assert(!JSON.stringify(deniedRead).includes('ต้นฉบับต้องไม่เปลี่ยน'));
    const before=store.size,args={fileId:original.id,revision:opened.output.revision,pluginId:fixture.pluginId,operations:fixture.operations};
    const proposed=await dispatch(user,'panthorium_studio_edit',args);
    assert.equal(proposed.requiresConfirmation,true,'model confirmed:true cannot approve an operation');assert(proposed.actionId);assert.equal(store.size,before,'proposal must not save');
    const denied=await agent.confirmAction({user:other,actionId:proposed.actionId,approvalHash:proposed.confirmation.approvalHash});assert.equal(denied.ok,false);assert.equal(store.size,before);
    const wrongHash=await agent.confirmAction({user,actionId:proposed.actionId,approvalHash:'0'.repeat(64)});assert.equal(wrongHash.ok,false);assert.equal(store.size,before,'mismatched approval must not save');
    const saved=await agent.confirmAction({user,actionId:proposed.actionId,approvalHash:proposed.confirmation.approvalHash});
    assert.equal(saved.ok,true);assert.equal(saved.output.job.status,'completed',saved.output.job.error);assert.equal(saved.output.job.files.length,1);assert.equal(store.size,before+1);
    const copy=saved.output.job.files[0];assert.notEqual(copy.id,original.id);
    await agent.confirmAction({user,actionId:proposed.actionId,approvalHash:proposed.confirmation.approvalHash});assert.equal(store.size,before+1,'replayed approval creates no duplicate');
    assert(store.get(original.id).body.equals(fixture.bytes),'source remains byte-for-byte unchanged');
    const reopened=await read(user,copy.id);assert.equal(reopened.ok,true);assert.equal((await read(other,copy.id)).ok,false);
    const model=reopened.output,entries=_internals.unzip(store.get(copy.id).body);
    if(fixture.pluginId==='document'){
      assert.equal(model.pageText.header,fixture.operations[0].value);assert.equal(model.pageText.footer,fixture.operations[1].value);
      assert.equal(model.tables.length,1);assert.equal(model.tables[0].supported,true);assert.equal(model.tables[0].rows[0][0].colSpan,2);assert.equal(model.tables[0].rows[1][0].rowSpan,2);
      assert(model.blocks.some(b=>b.text==='200'));assert(model.blocks.some(b=>b.text==='ต้นฉบับต้องไม่เปลี่ยน'));
    }else{
      assert.deepEqual(model.capabilities.chartAvailableSheets,[]);assert.equal(model.sheets[0].hasDrawing,true);
      assert.equal(model.sheets[0].cells.find(c=>c.cell==='B2').value,100);assert.equal(model.sheets[0].cells.find(c=>c.cell==='B3').value,200);
      assert.equal(model.sheets[0].cells.find(c=>c.cell==='B2').calculated,100);
      const chart=entries['xl/charts/panthoriumChart1.xml'].toString(),cache=_internals.xmlMatches(chart,'c:numCache')[0][0];
      assert(cache.includes('<c:v>100</c:v>'));assert(cache.includes('<c:v>200</c:v>'));assert(!cache.includes('<c:v>10</c:v>'));assert(!cache.includes('<c:v>20</c:v>'));
      assert(chart.includes('ยอดหลังแก้ไข'));assert(entries['xl/drawings/panthoriumDrawing1.xml']);
    }
    // Even approving an independently proposed foreign-file edit cannot bypass ownership.
    const foreignProposal=await dispatch(other,'panthorium_studio_edit',args);
    if(foreignProposal.requiresConfirmation){const foreign=await agent.confirmAction({user:other,actionId:foreignProposal.actionId,approvalHash:foreignProposal.confirmation.approvalHash});assert(foreign.ok===false||foreign.output?.job?.status!=='completed');}
    else assert.equal(foreignProposal.ok,false);
    assert.equal(store.size,before+1);assert(store.get(original.id).body.equals(fixture.bytes));
  }
  for(const surface of ['gemini-live','sentinel-chat']){
    assert(functions.declarationsFor(user,{surface}).some(t=>t.name==='panthorium_studio_edit'));
    assert(!functions.declarationsFor({...user,roles:['guest']},{surface}).some(t=>t.name==='panthorium_studio_edit'));
  }
  console.log('PASS advanced Office voice execution: real tool dispatch, immutable approval, ownership, replay, unchanged sources, DOCX header/footer/merged tables, XLSX formulas/final chart caches and reopen; live speech recognition not tested');
})().catch(e=>{console.error(e);process.exitCode=1;});
