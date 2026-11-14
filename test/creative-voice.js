'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const express=require('express');
const catalog=require('../creative-voice-catalog');
const {AuthService}=require('../services/authService');
const {ToolRegistry}=require('../services/toolRegistry');
const {AgentService}=require('../services/agentService');
const {AgentFunctionCallingService}=require('../services/agentFunctionCallingService');
const {registerCreativeStudioTools}=require('../services/creativeStudioTools');
const {createApiRouter}=require('../routes/api');
(async()=>{
 const examples=[['ช่วยเปิดตารางหน่อยครับ',{action:'open',kind:'spreadsheet'}],['เพิ่มข้อความ สวัสดีครับ',{action:'text',text:'สวัสดีครับ'}],['ใส่สูตร B3 เป็น =SUM(B1:B2)',{action:'set_formula',cell:'B3',text:'=SUM(B1:B2)'}],['เปลี่ยน เอหนึ่ง เป็น 500',{action:'set_cell',cell:'A1',text:'500'}],['เลือกเซลล์ เอ ๑',{action:'select_cell',cell:'A1'}],['ระดับเสียง ห้าสิบ เปอร์เซ็นต์',{action:'volume',value:50}],['เลื่อนไป สอง วินาที',{action:'seek',value:2}],['เพิ่มสไลด์ สรุปงาน',{action:'add_slide',text:'สรุปงาน'}],['สร้างเอกสารใหม่',{action:'new',kind:'document'}]];
 for(const [text,expected] of examples){assert.deepEqual(catalog.parse(text),expected,text);assert.deepEqual(catalog.fromAction(catalog.toAction(text)),expected);}
 for(const [text,expected] of [
  ['บันทึกภาพ',{action:'save'}],['เปิดไฟล์ที่เลือก',{action:'open_selected'}],['เปิดในพื้นที่ทำงาน',{action:'open_selected'}],
  ['เปิดเลเยอร์',{action:'panel',value:true}],['ปิดเลเยอร์',{action:'panel',value:false}],['ซูมพอดี',{action:'fit'}],
  ['ย้ายเลเยอร์ไปทางขวา ห้าสิบ พิกเซล',{action:'move_layer',direction:'ขวา',value:50}],
  ['ปรับความกว้าง 300 พิกเซล',{action:'layer_size',dimension:'width',value:300}],
  ['เปลี่ยนสีเป็น แดง',{action:'layer_color',value:'#ff0000'}],['สีข้อความ #Ab12CD',{action:'layer_color',value:'#ab12cd'}],
  ['เลื่อนเลเยอร์ลง',{action:'layer_order',value:'down'}],['ซ่อนเลเยอร์ที่เลือก',{action:'layer_visibility',value:false}],
  ['ครอปภาพ ซ้าย 10 บน 20 กว้าง 300 สูง 200',{action:'crop_image',x:10,y:20,width:300,height:200}],
  ['เพิ่มรูปร่าง',{action:'image_tool',value:'rect'}],['เลือกเครื่องมือข้อความ',{action:'image_tool',value:'text'}],['ปิดตัวอย่างคำสั่งเสียง',{action:'help_close'}]
 ]){assert.deepEqual(catalog.parse(text),expected,text);assert.deepEqual(catalog.fromAction(catalog.toAction(text)),expected);}
 for(const text of ['ครอปภาพ ซ้าย 0 บน 0 กว้าง 15 สูง 200','ครอปภาพ ซ้าย 0.5 บน 0 กว้าง 300 สูง 200','ปรับความกว้าง 5000 พิกเซล','ย้ายเลเยอร์ไปทางขวา 5000 พิกเซล','เปลี่ยนสีเป็น url(javascript:alert(1))','สี toString','สี constructor'])assert(catalog.parse(text)?.error,text);
 for(const text of ['อย่าบันทึกภาพ','ไม่ต้องเปิดเลเยอร์','ห้ามเปลี่ยนสีเป็น แดง'])assert.equal(catalog.parse(text).error,'voice_command_negated');
 assert.equal(catalog.needsConfirmation(catalog.parse('บันทึกภาพ')),true);
 for(const text of ['อย่าแบ่งคลิป','ห้ามลบเลเยอร์','ไม่ต้องบันทึก'])assert.equal(catalog.parse(text).error,'voice_command_negated');
 for(const text of ['ความเร็ว 99 เท่า','เปลี่ยน ZZ9999 เป็น 1','เลือกเซลล์ A0'])assert(catalog.parse(text).error);
 for(const text of ['เปิดเอกสารแล้วลบทุกไฟล์','บันทึกทำยังไง','สวัสดี','document.querySelector("button").click()'])assert.equal(catalog.parse(text),null,text);
 assert.equal(catalog.fromAction('studio_command:%ZZ'),null);assert.equal(catalog.parse('x'.repeat(4001)),null);
 assert.equal(catalog.parse('เพิ่มข้อความ ไม่ต้องลบไฟล์').text,'ไม่ต้องลบไฟล์');
 const user={id:randomUUID(),sub:null,roles:['user'],permissions:['chat']};user.sub=user.id;
 const guest={...user,id:randomUUID(),sub:'guest:test',roles:['guest']},denied={...user,id:randomUUID(),sub:randomUUID(),permissions:[]};
 const audit={record(){}},auth=new AuthService({config:{jwtSecret:'creative-voice-test-secret-only',accessTokenTtl:'1h'},audit});
 const registry=new ToolRegistry();registerCreativeStudioTools(registry,{studio:{}});
 const agent=new AgentService({tools:registry,audit}),functions=new AgentFunctionCallingService({agentService:agent});
 for(const surface of ['sentinel-chat','gemini-live']){
  assert(functions.declarationsFor(user,{surface}).some(t=>t.name==='panthorium_studio_command'));
  for(const actor of [guest,denied])assert(!functions.declarationsFor(actor,{surface}).some(t=>t.name==='panthorium_studio_command'));
 }
 const result=await functions.execute({user,source:'gemini-live',call:{id:'voice-1',name:'panthorium_studio_command',args:{command:'เพิ่มข้อความ งานของฉัน'}}});
 assert.equal(result.ok,true);assert.equal(result.output.completed,false);assert.equal(result.output.uiPending,true);
 assert.deepEqual(catalog.fromAction(result.output.uiAction),{action:'text',text:'งานของฉัน'});
 for(const command of ['ยืนยัน','ยกเลิก','อย่าแบ่งคลิป','ลบทุกไฟล์'])assert.equal((await functions.execute({user,source:'gemini-live',call:{id:randomUUID(),name:'panthorium_studio_command',args:{command}}})).ok,false,'the model cannot approve its own proposed save');
 const app=express();app.use(express.json());app.use('/api',createApiRouter({},auth,audit,{},agent,{}, {},{}, {},{},functions));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const post=(actor,command)=>fetch('http://127.0.0.1:'+server.address().port+'/api/sentinel/command',{method:'POST',headers:{'Content-Type':'application/json',...(actor?{Authorization:'Bearer '+auth.signAccessToken(actor)}:{})},body:JSON.stringify({command})});
  assert.equal((await post(null,'แบ่งคลิป')).status,401);
  for(const actor of [guest,denied])assert.equal((await post(actor,'แบ่งคลิป')).status,403);
  for(const command of ['เพิ่มข้อความ สวัสดี','แบ่งคลิป','เปลี่ยน B2 เป็น 500','เพิ่มสไลด์ สรุปงาน','บันทึก']){const r=await post(user,command);assert.equal(r.status,200);const data=await r.json();assert.equal(data.completed,false);assert.equal(data.results[0].toolId,'studio.command');assert.deepEqual(catalog.fromAction(data.results[0].output.uiAction),catalog.parse(command));}
  assert.equal((await post(user,'ไม่ต้องบันทึก')).status,422);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 console.log('PASS creative voice: Thai phrases/numbers, literal dictation, general chat accounts, guest/permission denial, model self-approval rejected and real authenticated command routing');
})().catch(e=>{console.error(e);process.exitCode=1;});
