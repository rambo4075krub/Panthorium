'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {StudioEditorService}=require('../services/studioEditorService');
const {_internals}=require('../services/officeArtifactService');
(async()=>{
  const user={sub:randomUUID()},other={sub:randomUUID()},store=new Map();
  const files={async upload(owner,name,contentType,body){const f={id:randomUUID(),name,contentType,size:body.length};store.set(f.id,{...f,owner,body:Buffer.from(body)});return f;},async readOwned(owner,id){const f=store.get(id);if(!f||f.owner!==owner)throw Error('file_not_found');return {...f,body:Buffer.from(f.body)};}};
  const editor=new StudioEditorService({files});
  const bytes=_internals.documentBuffer({title:'รายงาน',sections:[{paragraphs:['ลบข้อความนี้ทั้งหมด','ย่อหน้าที่ต้องเก็บไว้']}]},[]);
  const source=await files.upload(user.sub,'revisions.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes);
  const original=await editor.read(user,source.id),index=original.blocks.find(b=>b.text==='ลบข้อความนี้ทั้งหมด').index;
  async function save(file,read,operations,principal=user){const result=await editor.apply({user:principal,pluginId:'document',input:{edit:{fileId:file.id,revision:read.revision,operations}}});return {file:result.files[0],read:await editor.read(principal,result.files[0].id)};}
  const tracked=await save(source,original,[{type:'track_text',index,value:''}]);
  assert.notEqual(tracked.file.id,source.id);assert(store.get(source.id).body.equals(bytes));
  const deletion=tracked.read.blocks.find(b=>b.revisions?.some(r=>r.type==='delete'&&r.text==='ลบข้อความนี้ทั้งหมด'));
  assert(deletion,'deletion-only paragraphs must survive save/reopen');assert.equal(deletion.text,'');assert.equal(deletion.canTrackText,false);assert.equal(deletion.revisions.length,1);
  const revisionId=deletion.revisions[0].revisionId;assert.equal(deletion.revisions[0].supported,true);
  const count=store.size,trackedBytes=Buffer.from(store.get(tracked.file.id).body);
  await assert.rejects(editor.read(other,tracked.file.id),/file_not_found/);
  await assert.rejects(save(tracked.file,tracked.read,[{type:'accept_revision',index:deletion.index,revisionId}],other),/file_not_found/);
  await assert.rejects(save(tracked.file,{...tracked.read,revision:'0'.repeat(64)},[{type:'accept_revision',index:deletion.index,revisionId}]),/editor_source_changed/);
  await assert.rejects(save(tracked.file,tracked.read,[{type:'format_text',index:deletion.index,style:{bold:true}}]),/editor_revision_pending/);
  await assert.rejects(save(tracked.file,tracked.read,[{type:'set_text',index:deletion.index,value:'overwrite'}]),/editor_rich_text_protected/);
  await assert.rejects(save(tracked.file,tracked.read,[{type:'accept_revision',index:deletion.index,revisionId:'999999'}]),/editor_revision_not_found/);
  const unrelated=tracked.read.blocks.find(b=>b.text==='ย่อหน้าที่ต้องเก็บไว้');
  await assert.rejects(save(tracked.file,tracked.read,[{type:'accept_revision',index:unrelated.index,revisionId}]),/editor_revision_not_found/);
  assert.equal(store.size,count,'failed changes create no file');assert(store.get(tracked.file.id).body.equals(trackedBytes));
  const accepted=await save(tracked.file,tracked.read,[{type:'accept_revision',index:deletion.index,revisionId}]);
  assert.equal(accepted.read.revisions.length,0);assert(!accepted.read.blocks.some(b=>b.text==='ลบข้อความนี้ทั้งหมด'));assert(accepted.read.blocks.some(b=>b.text==='ย่อหน้าที่ต้องเก็บไว้'));
  const rejected=await save(tracked.file,tracked.read,[{type:'reject_revision',index:deletion.index,revisionId}]);
  assert.equal(rejected.read.revisions.length,0);assert(rejected.read.blocks.some(b=>b.text==='ลบข้อความนี้ทั้งหมด'));assert(rejected.read.blocks.some(b=>b.text==='ย่อหน้าที่ต้องเก็บไว้'));
  assert(store.get(tracked.file.id).body.equals(trackedBytes),'decisions save copies and preserve pending source');assert(store.get(source.id).body.equals(bytes));
  for(const target of [tracked,accepted,rejected]){
    const native=_internals.unzip(store.get(target.file.id).body);_internals.validateOfficeXmlEntries(native);
    assert.deepEqual(_internals.unzip(_internals.zip(native)),native,'native archive roundtrip');
    const originalEntries=_internals.unzip(bytes);for(const path of Object.keys(originalEntries))if(path!=='word/document.xml')assert(native[path].equals(originalEntries[path]),'retain '+path);
  }
  // Ordinary replacements expose separate insertion/deletion IDs; each exact
  // returned ID is approved, never a paragraph index masquerading as a revision.
  const replacement=await save(source,original,[{type:'track_text',index,value:'แทนที่ที่ตรวจสอบแล้ว'}]);
  const changed=replacement.read.blocks.find(b=>b.revisions?.length);assert(changed.revisions.some(r=>r.type==='insert'));assert(changed.revisions.some(r=>r.type==='delete'));
  const final=await save(replacement.file,replacement.read,changed.revisions.map(r=>({type:'accept_revision',index:changed.index,revisionId:r.revisionId})));
  assert(final.read.blocks.some(b=>b.text==='แทนที่ที่ตรวจสอบแล้ว'));assert.equal(final.read.revisions.length,0);
  console.log('PASS StudioEditor native revision copies: deletion-only read, exact accept/reject, pending-format denial, ownership, source revision safety, unchanged originals/parts and save/reopen');
})().catch(e=>{console.error(e);process.exitCode=1;});
