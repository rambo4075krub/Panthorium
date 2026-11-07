(function (root) {
  'use strict';
  const domains = { mailbox:'อีเมล', calendar:'นัดหมาย', reminders:'การเตือน', files:'ไฟล์', notes:'บันทึก', goals:'เป้าหมาย', memory:'ความจำ', knowledge:'เอกสารความรู้', notifications:'การแจ้งเตือน', social:'Social Media', studio:'เอกสารและสื่อ', media:'สื่อ', billing:'แพ็กเกจ', integrations:'การเชื่อมต่อ', browser:'เบราว์เซอร์', window:'หน้าต่าง' };
  const verbs = { create:'สร้าง', add:'เพิ่ม', save:'บันทึก', write:'บันทึก', update:'แก้ไข', edit:'แก้ไข', delete:'ลบ', remove:'ลบ', forget:'ลบ', trash:'ลบ', restore:'กู้คืน', send:'ส่ง', reply:'ตอบกลับ', draft:'บันทึกฉบับร่าง', move:'ย้าย', mark_read:'ทำเครื่องหมายว่าอ่านแล้ว', mark_unread:'ทำเครื่องหมายว่ายังไม่อ่าน', cancel:'ยกเลิก', snooze:'เลื่อนเวลา', settings:'เปลี่ยนการตั้งค่า', publish:'เผยแพร่', comment:'แสดงความคิดเห็น', message:'ส่งข้อความ', 'group-message':'ส่งข้อความในกลุ่ม', like:'ถูกใจ', share:'แชร์', follow:'ติดตาม', 'friend-request':'ส่งคำขอเป็นเพื่อน', 'friend-review':'ตอบคำขอเป็นเพื่อน', 'group-join':'ขอเข้าร่วมกลุ่ม', 'group-review':'ตอบคำขอเข้าร่วมกลุ่ม', thread:'ขอเริ่มสนทนา', 'accept-thread':'ตอบคำขอสนทนา', call:'โทร', order:'สั่งซื้อ', 'order-status':'เปลี่ยนสถานะคำสั่งซื้อ', listing:'ลงประกาศขาย', 'live-start':'เริ่มถ่ายทอดสด', 'live-end':'จบการถ่ายทอดสด', 'live-leave':'ออกจากการถ่ายทอดสด', interest:'แสดงความสนใจ', report:'รายงานเนื้อหา', block:'บล็อก', pass:'ข้าม', 'group-create':'สร้างกลุ่ม', 'group-leave':'ออกจากกลุ่ม', 'group-cancel-request':'ยกเลิกคำขอเข้ากลุ่ม', 'friend-cancel':'ยกเลิกคำขอเป็นเพื่อน', 'friend-remove':'ลบเพื่อน', 'playlist-create':'สร้างรายการเล่น', 'playlist-add':'เพิ่มในรายการเล่น', 'playlist-remove':'นำออกจากรายการเล่น', moderate:'จัดการเนื้อหา', generate:'สร้าง', render:'สร้าง', ai_edit:'แก้ไข', open:'เปิด', close:'ปิด', refresh:'โหลดใหม่', connect:'เชื่อมต่อ', disconnect:'ยกเลิกการเชื่อมต่อ' };
  const clean = (value, max = 2000) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0,max) : '';
  function describe(frame = {}) {
    const args = frame.args && typeof frame.args === 'object' ? frame.args : {};
    const parts = String(frame.toolId || '').split('.');
    const action = args.action || parts.at(-1), domain = domains[parts[0]] || 'รายการนี้';
    let operation = verbs[action] ? verbs[action] + (parts[0] === 'social' ? '' : domain) : 'ดำเนินการกับ' + domain;
    if (['block','follow'].includes(action) && args.enabled === false) operation = action === 'block' ? 'เลิกบล็อก' : 'เลิกติดตาม';
    if (['group-review','friend-review','accept-thread'].includes(action)) operation = (args.accept === true ? 'ยอมรับ' : 'ปฏิเสธ') + ({'group-review':'คำขอเข้ากลุ่ม','friend-review':'คำขอเป็นเพื่อน','accept-thread':'คำขอสนทนา'})[action];
    const details = [];
    const fields = { account:'บัญชี', expectedSubject:'หัวข้ออีเมล', subject:'หัวข้อ', title:'รายการ', name:'ชื่อ', to:'ถึง', cc:'สำเนาถึง', bcc:'สำเนาลับถึง', text:'ข้อความ', body:'ข้อความ', content:'เนื้อหา', prompt:'สิ่งที่ต้องการสร้าง', instruction:'การแก้ไขที่ต้องการ', start:'เริ่ม', end:'สิ้นสุด', startAt:'เริ่ม', endAt:'สิ้นสุด', dueAt:'กำหนดเวลา', remindAt:'เวลาเตือน', scheduledAt:'เวลา', timeZone:'เขตเวลา', location:'สถานที่', filename:'ชื่อไฟล์', fileName:'ชื่อไฟล์', destinationName:'ปลายทาง', folderName:'โฟลเดอร์ปลายทาง', folder:'โฟลเดอร์ปลายทาง', amount:'จำนวนเงิน', currency:'สกุลเงิน' };
    for (const [key,label] of Object.entries(fields)) {
      const raw = args[key];
      const value = Array.isArray(raw) ? raw.filter(x => typeof x === 'string').map(x => clean(x,320)).join(', ') : typeof raw === 'number' ? String(raw) : clean(raw, ['text','body','content'].includes(key) ? 50000 : 2000);
      if (value) details.push(label + ': ' + value);
    }
    if (args.patch) {
      const labels = { enabled:'การแจ้งเตือนทั้งหมด', privacyPreview:'แสดงและอ่านรายละเอียด', askBeforeNotify:'ถามก่อนส่งแจ้งเตือน', inApp:'ในแอป', browser:'บนอุปกรณ์', sound:'เสียง', voice:'อ่านด้วยเสียง' };
      const events = typeof window === 'object' ? window.PanthoriumNotificationCatalog?.entries || [] : [];
      for (const entry of events) labels[entry.id] = entry.label;
      const changes = { ...args.patch, ...args.patch.channels, ...args.patch.events };
      for (const [key,value] of Object.entries(changes)) if (labels[key] && typeof value === 'boolean') details.push(labels[key] + ': ' + (value ? 'เปิด' : 'ปิด'));
    }
    const count = args.ids?.length || args.messageIds?.length;
    if (count || args.all === true) details.push(args.all === true ? 'รายการทั้งหมดในบัญชีนี้' : count + ' รายการที่เลือก');
    if (args.attachments?.length) details.push('ไฟล์แนบ: ' + args.attachments.length + ' ไฟล์');
    if (action === 'trash') details.push('กู้คืนจากถังขยะได้');
    if (/^(studio|media)\./.test(frame.toolId || '')) details.push('อาจใช้โควตาหรือมีค่าใช้จ่ายตามบริการที่เลือก');
    return { operation, question:'ยืนยันการ' + operation + 'หรือไม่', details };
  }
  const api = { describe };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PanthoriumActionPresentation = api;
})(typeof window === 'object' ? window : globalThis);
