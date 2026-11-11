/* Fixed UI bindings only: speech never supplies selectors or executable code. */
(function () {
  'use strict';
  const fail = text => ({ok:false,error:'creative_command_unavailable',text});
  const ok = text => ({ok:true,text});
  function control(root, label) {return [...root.querySelectorAll('input,select,textarea')].find(n=>n.getAttribute('aria-label')===label);}
  function button(root, label) {return [...root.querySelectorAll('button')].find(n=>!n.matches('[data-layer-id],[data-clip-index]')&&!n.closest('.po-nav')&&(n.textContent.trim()===label||n.getAttribute('aria-label')===label));}
  async function click(node) {
    if(!node||node.disabled||node.closest('[inert]'))throw Error('คำสั่งนี้ยังใช้ไม่ได้ กรุณาเลือกชิ้นงานก่อน');
    await node.onclick?.({currentTarget:node,target:node,preventDefault(){}});
  }
  async function set(node, value) {
    if(!node||node.disabled||node.closest('[inert]'))throw Error('เลือกชิ้นงานที่รองรับคำสั่งนี้ก่อน');
    if(['number','range'].includes(node.type)&&(!Number.isFinite(Number(value))||(node.min!==''&&Number(value)<Number(node.min))||(node.max!==''&&Number(value)>Number(node.max))))throw Error('ค่าที่สั่งอยู่นอกขอบเขตของเครื่องมือ');
    if(node.tagName==='SELECT'&&![...node.options].some(o=>o.value===String(value)))throw Error('ค่าที่สั่งไม่อยู่ในตัวเลือกของเครื่องมือ');
    if(node.maxLength>=0&&String(value).length>node.maxLength)throw Error('ข้อความยาวเกินขอบเขตของเครื่องมือ');
    if(node.type==='checkbox')node.checked=value;else node.value=String(value);
    const event={currentTarget:node,target:node,preventDefault(){}};
    await (node.onchange||node.oninput)?.(event);
  }
  async function media(root, c, hooks) {
    if(!root?.isConnected||root.closest('[hidden]')||hooks.busy())return fail('รอเปิดไฟล์หรือบันทึกให้เสร็จก่อนสั่งงาน');
    const kind=root.dataset.mediaEditor, status=root.querySelector('.ce-message');
    status.dataset.error='false';
    try {
      if(c.action==='rename') {if(c.text.length>100)throw Error('ชื่อโปรเจกต์ยาวได้ไม่เกิน 100 ตัวอักษร');control(root,'ชื่อโปรเจกต์').value=c.text;}
      else if(c.action==='text') await hooks.text(c.text);
      else if(c.action==='undo'||c.action==='redo')await click(button(root,(c.action==='undo'?'ย้อนกลับ':'ทำซ้ำ')+(kind==='image'?'ภาพ':'วิดีโอ')));
      else if(c.action==='save'||c.action==='export')await click(button(root,kind==='image'?'บันทึกภาพ':'ส่งออก MP4'));
      else if(c.action==='project')await click(button(root,'เก็บโปรเจกต์'));
      else if(kind==='image') {
        if(c.action==='download_png')await click(button(root,'PNG ↓'));
        else if(c.action==='replace_text')await set(control(root,'ข้อความบนภาพ'),c.text);
        else if(c.action==='font_size')await set(control(root,'ขนาดอักษร'),c.value);
        else if(c.action==='bold')await click([...root.querySelectorAll('button')].find(n=>/^ตัวหนา(?: ✓)?$/.test(n.textContent)));
        else if(c.action==='brightness'||c.action==='brightness_delta'){const input=control(root,'ความสว่าง');await set(input,c.action==='brightness'?c.value:Math.max(0,Math.min(200,Number(input?.value||0)+c.value)));}
        else if(c.action==='opacity')await set(control(root,'ความทึบ'),c.value/100);
        else if(c.action==='zoom')await set(control(root,'ซูมภาพ'),c.value);
        else if(c.action==='rotate') {const input=control(root,'หมุน');await set(input,((Number(input?.value||0)+c.direction*c.value+540)%360)-180);}
        else if(c.action==='flip')await click(button(root,c.value==='horizontal'?'พลิกแนวนอน':'พลิกแนวตั้ง'));
        else if(c.action==='delete_layer'||c.action==='duplicate_layer'){if(!root.querySelector('[data-layer-id][aria-selected=true]'))throw Error('เลือกเลเยอร์ก่อน');await click(button(root,c.action==='delete_layer'?'ลบเลเยอร์':'สำเนาเลเยอร์'));}
        else if(c.action==='select'&&c.target==='layer')await click([...root.querySelectorAll('[data-layer-id]')][c.value-1]);
        else if(c.action==='image_tool') {await click([...root.querySelectorAll('[data-tool]')].find(n=>n.dataset.tool===c.value));return ok(['crop','paint','erase','move'].includes(c.value)?'เลือกเครื่องมือแล้ว ใช้พื้นที่ภาพเพื่อวาดหรือลากตำแหน่ง':'เพิ่มรูปร่างแล้ว');}
        else return fail('คำสั่งนี้ไม่รองรับในรูปภาพ พูด “คำสั่งเสียงสร้างสรรค์” เพื่อดูตัวอย่าง');
      } else {
        const bindings={speed:'ความเร็ว',volume:'ระดับเสียง',clip_start:'เริ่ม (วินาที)',clip_end:'จบ (วินาที)',aspect:'สัดส่วนวิดีโอ',fade:'เฟดเข้าและออก',seek:'ตำแหน่งเล่นบนไทม์ไลน์'};
        if(bindings[c.action])await set(control(root,bindings[c.action]),c.action==='volume'?c.value/100:c.value);
        else if(c.action==='select'&&c.target==='clip')await click([...root.querySelectorAll('[data-clip-index]')][c.value-1]);
        else if(c.action==='play') {if(!root.querySelector('[data-clip-index]'))throw Error('เพิ่มคลิปวิดีโอก่อนเล่น');const play=button(root,'▶ เล่น');if(play)await click(play);else if(!button(root,'❚❚ หยุด'))throw Error('เพิ่มคลิปวิดีโอก่อนเล่น');}
        else if(c.action==='pause')hooks.pause();
        else if(['split','duplicate_clip','delete_clip'].includes(c.action)) {
          if(!root.querySelector('[data-clip-index]'))throw Error('เลือกคลิปวิดีโอก่อน');
          await click(button(root,({split:'✂ แบ่งคลิป',duplicate_clip:'สำเนา',delete_clip:'ลบ'})[c.action]));
        } else return fail('คำสั่งนี้ไม่รองรับในวิดีโอ พูด “คำสั่งเสียงสร้างสรรค์” เพื่อดูตัวอย่าง');
      }
      return status.dataset.error==='true'?fail(status.textContent):ok(['save','export','project','download_png'].includes(c.action)?status.textContent:'ดำเนินคำสั่งใน'+(kind==='image'?'รูปภาพ':'วิดีโอ')+'แล้ว');
    } catch(e) {return fail(e.message);}
  }
  async function start(kind) {
    const live=window.PanthoriumLiveVoice;
    if(!live)return fail('ระบบเสียงยังไม่พร้อม กรุณาลองปุ่มไมโครโฟนหลักอีกครั้ง');
    if(!live.isActive())await live.toggle('creative-editor');
    if(!live.isActive())return fail('ยังเปิดไมโครโฟนไม่สำเร็จ ตรวจสิทธิ์ไมโครโฟนแล้วลองใหม่');
    live.sendText?.('ผู้ใช้เปิดสั่งด้วยเสียงในพื้นที่สร้างสรรค์ ประเภท '+kind+' รอฟังคำสั่งต่อไป ใช้ panthorium_studio_command กับคำสั่งแก้ไขบนหน้าจอเพื่อเก็บการแก้ไขที่ยังไม่บันทึก ห้ามเปลี่ยนไปแก้ไฟล์ต้นฉบับแทนร่างบนหน้าจอ การบันทึกหรือส่งออกให้เสนอการยืนยันในพื้นที่งานก่อน อย่าเริ่มงานจากข้อความนี้');
    return ok('พร้อมรับคำสั่งเสียงในพื้นที่งาน');
  }
  window.PanthoriumCreativeVoice=Object.freeze({media,start,click,set,button,control,fail,ok});
})();
