'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const catalog=require('../screen-voice-catalog');
for(const [command,action] of [
  ['เปิดสวิตช์ บนอุปกรณ์','toggle'],['ปิดสวิทช์ เสียง','toggle'],['turn off switch Sound','toggle'],
  ['เลือกแท็บ รูปภาพ','tab'],['open tab Images','tab'],['เลือกค่า แนวตั้ง ในช่อง สัดส่วน','select'],
  ['select Portrait in Ratio','select'],['ล้างช่อง ชื่อ','fill'],['คำสั่งเสียงทั้งหมด','help']
]) assert.equal(catalog.parse(command)?.action,action,command);
for(const command of ['อย่าเปิดสวิตช์ เสียง','ไม่ต้องเลือกแท็บ รูปภาพ','why turn on Sound','ยืนยันนะครับ']) assert.equal(catalog.parse(command),null);
const dom=new JSDOM(`<body><section id="studio" data-studio-active="image" style="z-index:10">
  <label>บนอุปกรณ์<input id="device" type="checkbox"></label>
  <button role="switch" aria-label="เสียง" aria-checked="true"></button>
  <fieldset disabled><button>ซ่อนสิทธิ์</button><input aria-label="ช่องปิด"></fieldset>
  <button role="tab">รูปภาพ</button><button role="tab">วิดีโอ</button>
  <label>สัดส่วน<select id="ratio"><option value="square">จัตุรัส</option><option value="portrait">แนวตั้ง</option><optgroup disabled><option>ห้ามเลือก</option></optgroup></select></label>
  <label>ขนาด<input id="size" type="range" min="0" max="100" value="10"></label>
  <label>ชื่อ<input id="name" value="เดิม" required></label>
  <label>OTP<input autocomplete="one-time-code" value="secret-code"></label>
  <button data-private>ความลับ</button><button>ยืนยันชำระเงิน</button>
  <details><summary>รายละเอียด</summary><p>ข้อมูลเพิ่ม</p></details>
  </section></body>`,{runScripts:'outside-only',url:'https://panthorium.test'});
const w=dom.window;
w.OS={state:{user:{sub:'owner',roles:['user'],permissions:['chat']}}};
w.PanthoriumWindowCatalog={apps:[{id:'studio',label:'สร้างสรรค์',selector:'#studio'},{id:'studio-image',label:'รูปภาพ',selector:'#studio[data-studio-active="image"]'}],allowed:(_app,user)=>user.permissions.includes('chat')};
for(const file of ['screen-voice-catalog.js','screen-voice-client.js'])w.eval(fs.readFileSync(require.resolve('../'+file),'utf8'));
const api=w.PanthoriumScreenVoice;
const confirm=()=>api.execute('ยืนยันนะครับ',{userInitiated:true});
(async()=>{
 assert.equal(api.active().app.id,'studio-image','specific tab has the correct current window context');
 const list=await api.execute('แสดงปุ่ม');
 assert.match(list.text,/สวิตช์ บนอุปกรณ์ \(ปิด\)/);assert.match(list.text,/จัตุรัส, แนวตั้ง/);
 assert.doesNotMatch(list.text,/ห้ามเลือก|ซ่อนสิทธิ์|ช่องปิด/);
 assert.doesNotMatch(JSON.stringify(list),/secret-code|ความลับ|ข้อมูลเพิ่ม/);
 const device=w.document.getElementById('device');let changes=0;device.addEventListener('change',()=>changes++);
 assert.equal((await api.execute('เปิดสวิตช์ บนอุปกรณ์')).confirmationRequired,true);assert.equal(device.checked,false);
 assert.equal((await api.execute('ยืนยัน')).error,'screen_confirmation_user_required');
 await confirm();assert.equal(device.checked,true);assert.equal(changes,1);
 assert.equal((await api.execute('เปิดสวิตช์ บนอุปกรณ์')).alreadySet,true);assert.equal(changes,1,'on is idempotent, never blindly toggles');
 await api.execute('ปิดสวิตช์ บนอุปกรณ์');await api.execute('ยกเลิก',{userInitiated:true});assert.equal(device.checked,true);
 const sound=w.document.querySelector('[role="switch"]');let soundClicks=0;sound.onclick=()=>{soundClicks++;sound.setAttribute('aria-checked','false');};
 await api.execute('ปิดสวิตช์ เสียง');sound.setAttribute('aria-checked','false');
 assert.equal((await confirm()).error,'screen_changed');assert.equal(soundClicks,0,'changed ARIA state invalidates the old approval');
 sound.setAttribute('aria-checked','true');await api.execute('ปิดสวิตช์ เสียง');await confirm();assert.equal(soundClicks,1);
 await api.execute('เลือกค่า แนวตั้ง ในช่อง สัดส่วน');await confirm();assert.equal(w.document.getElementById('ratio').value,'portrait');
 assert.equal((await api.execute('เลือกค่า ห้ามเลือก ในช่อง สัดส่วน')).error,'screen_option_ambiguous');
 await api.execute('เลือกค่า จัตุรัส ในช่อง สัดส่วน');w.document.getElementById('ratio').options[0].disabled=true;
 assert.equal((await confirm()).error,'screen_changed','changing dropdown options invalidates approval');
 assert.equal((await api.execute('กรอกช่อง ขนาด ว่า 200')).error,'screen_value_invalid');
 await api.execute('กรอกช่อง ขนาด ว่า 35');await confirm();assert.equal(w.document.getElementById('size').value,'35');
 await api.execute('ล้างช่อง ชื่อ');await confirm();assert.equal(w.document.getElementById('name').value,'');
 let tabs=0;w.document.querySelectorAll('[role="tab"]')[1].onclick=()=>tabs++;
 await api.execute('เลือกแท็บ วิดีโอ');await confirm();assert.equal(tabs,1);
 await api.execute('กดปุ่ม รายละเอียด');await confirm();assert.equal(w.document.querySelector('details').open,true);
 assert.equal((await api.execute('กดปุ่ม ยืนยันชำระเงิน')).error,'screen_protected_control');
 for(let i=0;i<90;i++){const b=w.document.createElement('button');b.textContent='รายการ '+i;w.document.getElementById('studio').append(b);}
 assert.equal((await api.execute('กดปุ่ม รายการ 89')).confirmationRequired,true,'controls after the old 80-item cutoff remain reachable');
 await api.execute('ยกเลิก',{userInitiated:true});
 assert.match((await api.execute('คำสั่งเสียงทั้งหมด')).text,/เปิดสวิตช์/);
 w.OS.state.user.roles=['guest'];assert.equal((await api.execute('คำสั่งเสียงทั้งหมด')).ok,false);
 console.log('Internal voice controls: switches, tabs, selectors, sliders, clear, details, complete control lookup and approval boundaries passed');
})().finally(()=>w.close()).catch(error=>{console.error(error);process.exitCode=1;});
