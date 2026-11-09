'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {registerCreativeStudioTools,STUDIO_TOOL_DEFINITIONS}=require('../services/creativeStudioTools');
(async()=>{
const tools=new Map(),starts=[];registerCreativeStudioTools({register:t=>tools.set(t.id,t)},{studio:{start:async x=>{starts.push(x);return {job:{status:'completed'}};}}});
const edit=tools.get('studio.edit'),user={sub:randomUUID()},base={fileId:randomUUID(),revision:'a'.repeat(64),pluginId:'document'};
assert(edit.requiresConfirmation&&edit.mutates);
const rows=[[{text:'สรุป',colSpan:2,rowSpan:1}],[{text:'ไทย',colSpan:1,rowSpan:1},{text:'100',colSpan:1,rowSpan:1}]];
const args={...base,operations:[{type:'insert_complex_table',richRows:rows},{type:'set_page_text',part:'header',value:'รายงาน'}]};
assert.equal(edit.validateArgs(args),null);
await assert.rejects(edit.run({user,args}),/immutable_action_confirmation_required/);assert.equal(starts.length,0);
await edit.run({user,args,actionId:randomUUID()});assert.deepEqual(starts[0].input.edit.operations[0],{type:'insert_complex_table',rows});
assert(edit.validateArgs({...base,operations:[{type:'insert_complex_table',richRows:rows,rows}]}));
assert.equal(edit.validateArgs({...base,pluginId:'spreadsheet',operations:[{type:'insert_chart',sheet:0,range:'A2:B10',title:'ยอดขาย'}]}),null);
const schema=STUDIO_TOOL_DEFINITIONS.find(t=>t.toolId==='studio.edit').properties.operations.items.properties;
for(const type of ['insert_complex_table','insert_chart','set_page_text'])assert(schema.type.enum.includes(type));
console.log('PASS advanced Office voice tools: bounded operation schema, table mapping, immutable approval required');
})().catch(e=>{console.error(e);process.exitCode=1;});
