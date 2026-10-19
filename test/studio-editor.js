'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {_internals,OfficeArtifactService}=require('../services/officeArtifactService');
const {StudioEditorService,validateEdit,officeModel}=require('../services/studioEditorService');
const {CreativeStudioService}=require('../services/creativeStudioService');
const {MemoryCreativeStudioRepository}=require('../services/creativeStudioRepository');
const {ToolRegistry}=require('../services/toolRegistry');
const {AgentService}=require('../services/agentService');
const {ActionLedgerRepository}=require('../services/actionLedgerRepository');
const {AgentFunctionCallingService}=require('../services/agentFunctionCallingService');
const {registerCreativeStudioTools}=require('../services/creativeStudioTools');
(async()=>{
  const user={sub:randomUUID(),roles:['user'],permissions:['chat']},other={...user,sub:randomUUID()},store=new Map();let exports=0;
  const files={bucket:'test',ensureConfigured(){},async upload(owner,name,contentType,body){const file={id:randomUUID(),name,contentType,size:body.length};store.set(file.id,{...file,owner,body});return file;},async findObject(owner,id){const file=store.get(id);if(!file||file.owner!==owner)throw Error('file_not_found');const {body,owner:unused,...meta}=file;return meta;},async readOwned(owner,id){return {...await this.findObject(owner,id),body:store.get(id).body};},async download(){exports++;throw Error('quota_exceeded:downloadBytes');}};
  const office=new OfficeArtifactService({files}),studio=new CreativeStudioService({files,office,repository:new MemoryCreativeStudioRepository(),resolveUser:async u=>u}),editor=new StudioEditorService({files});await studio.init();
  const fixtures=[
    ['spreadsheet','data.xlsx',_internals.spreadsheetBuffer({title:'ตาราง',sheets:[{name:'เดือน',rows:[['เดือน','ยอด'],['มกราคม',100]]},{name:'อื่น',rows:[['ค่า'],[10]]}]})],
    ['document','doc.docx',_internals.documentBuffer({title:'รายงาน',sections:[{heading:'หัวข้อ',paragraphs:['เนื้อหาเดิม'],rows:[['ชื่อ','ค่า'],['A',20]]}]},[])],
    ['presentation','deck.pptx',_internals.presentationBuffer({title:'นำเสนอ',slides:[{title:'หน้าแรก',bullets:['รายละเอียด']},{title:'หน้าสอง',bullets:['เก็บไว้']}]},[])]
  ];
  for(const [pluginId,name,bytes]of fixtures){
    const file=await files.upload(user.sub,name,'application/octet-stream',bytes),data=await editor.read(user,file.id);
    assert.equal(data.pluginId,pluginId);assert.match(data.revision,/^[a-f0-9]{64}$/);assert(!JSON.stringify(data).includes('word/document.xml'));
    await assert.rejects(editor.read(other,file.id),/file_not_found/);
    const operations=pluginId==='spreadsheet'?[{type:'set_cell',sheet:0,cell:'B2',value:500},{type:'set_cell',sheet:0,cell:'D10',value:'=HYPERLINK("unsafe")'}]:[{type:'set_text',index:0,value:'ชื่อใหม่ <script>alert(1)</script>'},...(pluginId==='document'?[{type:'append_paragraph',value:'ย่อหน้าใหม่'}]:[])];
    const request={user,pluginId,sourceFileIds:[file.id],input:{prompt:'แก้ไข',edit:{fileId:file.id,revision:data.revision,operations}},confirmed:true,idempotencyKey:'manual:'+randomUUID()};
    const saved=await studio.start(request);assert.equal(saved.job.status,'completed',saved.job.error);assert.equal(saved.job.files.length,1);assert.deepEqual((await studio.start(request)).job.files,saved.job.files,'retry creates no duplicate');
    const copy=await editor.read(user,saved.job.files[0].id);assert(store.get(file.id).body.equals(bytes),'original bytes preserved');
    const before=_internals.unzip(bytes),after=_internals.unzip(store.get(copy.file.id).body);
    for(const path of Object.keys(before)){if(pluginId==='spreadsheet'&&path==='xl/worksheets/sheet1.xml'||pluginId==='document'&&path==='word/document.xml'||pluginId==='presentation'&&path==='ppt/slides/slide1.xml')continue;assert(before[path].equals(after[path]),'preserve '+path);}
    if(pluginId==='spreadsheet'){assert.equal(copy.sheets[0].cells.find(c=>c.cell==='B2').value,500);assert.equal(copy.sheets[0].cells.find(c=>c.cell==='D10').value,'=HYPERLINK("unsafe")');assert(!after['xl/worksheets/sheet1.xml'].toString().includes('<f>'));}
    else {assert.equal(copy.blocks[0].text,'ชื่อใหม่ <script>alert(1)</script>');if(pluginId==='document')assert.equal(copy.blocks.at(-1).text,'ย่อหน้าใหม่');}
    await assert.rejects(editor.apply({user,pluginId,input:{edit:{fileId:file.id,revision:'0'.repeat(64),operations}}}),/editor_source_changed/);
  }
  const entries=_internals.unzip(fixtures[0][2]);entries['xl/worksheets/sheet1.xml']=Buffer.from(entries['xl/worksheets/sheet1.xml'].toString().replace('<v>100</v>','<f>SUM(B3:B5)</f><v>100</v>'));
  const formula=await files.upload(user.sub,'formulas.xlsx','application/octet-stream',_internals.zip(entries)),data=await editor.read(user,formula.id);
  assert(data.sheets[0].cells.find(c=>c.cell==='B2').formula);
  await assert.rejects(editor.apply({user,pluginId:'spreadsheet',input:{edit:{fileId:formula.id,revision:data.revision,operations:[{type:'set_cell',sheet:0,cell:'B2',value:2}]}}}),/editor_formula_cell_readonly/);
  const malformed={fileId:formula.id,revision:data.revision,operations:[{type:'set_cell',sheet:0,cell:'B2',value:2,url:'https://example.com'}]};assert.throws(()=>validateEdit(malformed),/invalid_editor_operation/);
  const malicious={...entries,'custom.xml':Buffer.from('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a/>')};assert.throws(()=>officeModel(malicious,'spreadsheet'),/invalid_office_source/);
  // Real ffmpeg transformation; no paid provider and no export allowance needed.
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2e8AAAAASUVORK5CYII=','base64'),image=await files.upload(user.sub,'picture.png','image/png',png),imageData=await editor.read(user,image.id);
  const rotated=await studio.start({user,pluginId:'image',sourceFileIds:[image.id],input:{prompt:'rotate',edit:{fileId:image.id,revision:imageData.revision,operations:[{type:'rotate',degrees:90}]}},confirmed:true,idempotencyKey:'image-edit-001'});assert.equal(rotated.job.status,'completed',rotated.job.error);assert.equal(rotated.job.files[0].contentType,'image/png');assert.equal(exports,0);
  // Voice and typed chat share the immutable approval ledger and replay protection.
  const registry=new ToolRegistry(),ledger=new ActionLedgerRepository({allowMemory:true});await ledger.init();registerCreativeStudioTools(registry,{studio});
  const agent=new AgentService({tools:registry,ledger}),functions=new AgentFunctionCallingService({agentService:agent});
  const read=await functions.execute({user,call:{id:'read',name:'panthorium_studio_editor',args:{fileId:formula.id,open:true}},requestId:'read-editor'});assert.equal(read.output.openEditor,true);
  const args={fileId:formula.id,revision:data.revision,pluginId:'spreadsheet',operations:[{type:'set_cell',sheet:0,cell:'B3',numericValue:900}]};
  const call={id:'voice-edit',name:'panthorium_studio_edit',args},proposed=await functions.execute({user,call,requestId:'voice-editor',source:'gemini-live',confirmed:true});assert.equal(proposed.requiresConfirmation,true);
  const before=store.size;assert.equal((await agent.confirmAction({user:other,actionId:proposed.actionId,approvalHash:proposed.confirmation.approvalHash})).ok,false);assert.equal(store.size,before);
  const result=await agent.confirmAction({user,actionId:proposed.actionId,approvalHash:proposed.confirmation.approvalHash});assert.equal(result.output.job.status,'completed');assert.equal(store.size,before+1);
  await agent.confirmAction({user,actionId:proposed.actionId,approvalHash:proposed.confirmation.approvalHash});assert.equal(store.size,before+1);
  for(const surface of ['sentinel-chat','gemini-live']){assert(functions.declarationsFor(user,{surface}).some(t=>t.name==='panthorium_studio_edit'));assert(!functions.declarationsFor({...user,roles:['guest']},{surface}).some(t=>t.name==='panthorium_studio_edit'));}
  console.log('PASS studio editor: native Office preservation, exact cells/text, escaping, formula protection, revision/ownership checks, Free image edits, voice approval and replay');
})().catch(e=>{console.error(e);process.exitCode=1;});
