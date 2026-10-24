(function (root, factory) {
  'use strict';
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  if (root) root.PanthoriumNotificationCatalog = catalog;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  // One ordered catalog for settings, delivery and voice tools. These are observed
  // events already produced by the application, not promises of new monitoring.
  const rows = [
    ['self_notification', 'system', 'แจ้งเตือนที่ฉันขอให้ส่ง', 'รายการที่สั่งให้ Sentinel ส่งถึงคุณทันที', ['user.requested']],
    ['system_notice', 'system', 'ข้อความแจ้งเตือนทั่วไปของระบบ', 'ข้อความจากระบบที่ไม่มีประเภทเฉพาะ', ['system.notice']],
    ['security_login', 'security', 'มีการเข้าสู่ระบบบัญชี', 'แจ้งเมื่อบัญชีของคุณเข้าสู่ระบบสำเร็จ', ['auth.login_success']],
    ['security_password', 'security', 'รหัสผ่านถูกเปลี่ยน', 'แจ้งเมื่อรหัสผ่านบัญชีถูกตั้งใหม่', ['auth.user_password_reset', 'auth.voice_password_reset']],
    ['security_access', 'security', 'สิทธิ์บัญชีเปลี่ยนแปลง', 'แจ้งเมื่อสิทธิ์การเข้าถึงบัญชีถูกปรับ', ['auth.user_access_updated']],
    ['security_protection', 'security', 'การป้องกันการเข้าถึงเปลี่ยนแปลง', 'การบล็อกหรือปลดบล็อกที่เกี่ยวข้องกับบัญชี', ['security.ip_blocked', 'security.ip_unblocked']],
    ['operation_scheduled', 'operations', 'ตั้งเวลาดำเนินงานแล้ว', 'บันทึกงานที่จะดำเนินการตามกำหนดเวลา', ['agent.job_scheduled']],
    ['operation_started', 'operations', 'เริ่มดำเนินงาน', 'เริ่มงาน วางแผน หรือเริ่มการทำงานหลายขั้นตอน', ['action.running', 'agent.tool_started', 'agent.job_started', 'agent.workflow_plan_started', 'agent.orchestration_started']],
    ['operation_approval', 'operations', 'งานรอการยืนยัน', 'มีขั้นตอนที่ต้องให้คุณยืนยันก่อนทำต่อ', ['action.awaiting_confirmation', 'agent.job_waiting_confirmation']],
    ['operation_succeeded', 'operations', 'ดำเนินงานสำเร็จ', 'ระบบบันทึกผลสำเร็จของงานแล้ว', ['action.succeeded', 'agent.tool_completed', 'agent.job_completed', 'agent.workflow_completed', 'agent.orchestration_completed', 'agent.job_terminal.completed']],
    ['operation_failed', 'operations', 'ดำเนินงานไม่สำเร็จ', 'งานหรือขั้นตอนที่ระบบรายงานว่าล้มเหลว', ['action.failed', 'agent.tool_failed', 'agent.job_failed', 'agent.job_terminal.failed']],
    ['operation_cancelled', 'operations', 'งานถูกยกเลิกหรือรับคำขอยกเลิก', 'ตรวจผลขั้นตอนที่เริ่มไปแล้วได้ในประวัติงาน', ['action.cancel_requested', 'agent.job_cancelled', 'agent.workflow_cancelled', 'agent.orchestration_cancelled', 'agent.job_terminal.cancelled']],
    ['operation_expired', 'operations', 'งานหรือคำขอยืนยันหมดอายุ', 'งานที่หมดเวลารอการดำเนินการหรือยืนยัน', ['agent.workflow_expired', 'agent.job_terminal.expired']],
    ['operation_unknown', 'operations', 'ยังยืนยันผลการดำเนินงานไม่ได้', 'ผลของงานยังไม่แน่นอน ควรตรวจสอบก่อนสั่งซ้ำ', ['action.unknown']],
    ['operation_legacy_result', 'operations', 'สถานะงานอื่น ๆ', 'ผลสถานะการดำเนินงานเพิ่มเติม', ['agent.job_terminal']],
    ['reminder_scheduled', 'reminders', 'บันทึกการตั้งเตือนแล้ว', 'ยืนยันการตั้งเตือนตามเวลาทางอีเมล', ['reminder.scheduled']],
    ['reminder_snoozed', 'reminders', 'เลื่อนเวลาการเตือน', 'เวลาส่งการเตือนถูกเลื่อนตามคำขอ', ['reminder.snoozed']],
    ['reminder_cancelled', 'reminders', 'ยกเลิกการตั้งเตือน', 'การเตือนที่เลือกถูกยกเลิกแล้ว', ['reminder.cancelled']],
    ['reminder_delivered', 'reminders', 'ผู้ให้บริการรับอีเมลเตือนแล้ว', 'ยังไม่ใช่การยืนยันว่าผู้รับได้รับหรืออ่านอีเมล', ['reminder.delivered']],
    ['reminder_failed', 'reminders', 'ส่งการเตือนไม่สำเร็จหรือผลยังไม่ชัดเจน', 'ตรวจสถานะการส่งก่อนดำเนินการซ้ำ', ['reminder.delivery_failed']],
    ['calendar_created', 'calendar', 'เพิ่มรายการในปฏิทิน', 'บันทึกนัดหมายหรือรายการปฏิทินใหม่', ['agent.memory_created']],
    ['calendar_updated', 'calendar', 'แก้ไขรายการในปฏิทิน', 'รายละเอียดนัดหมายหรือเวลาเปลี่ยนแปลง', ['agent.memory_updated']],
    ['calendar_deleted', 'calendar', 'ลบรายการในปฏิทิน', 'รายการปฏิทินที่เลือกลบเรียบร้อยแล้ว', ['agent.memory_deleted']],
    ['file_uploaded', 'files', 'บันทึกหรืออัปโหลดไฟล์สำเร็จ', 'ไฟล์ถูกบันทึกในพื้นที่ไฟล์แล้ว', ['files.uploaded']],
    ['file_deleted', 'files', 'ลบไฟล์สำเร็จ', 'ลบไฟล์ที่เลือกออกจากพื้นที่ไฟล์แล้ว', ['files.deleted']],
    ['notes_changed', 'files', 'บันทึกหรือเป้าหมายเปลี่ยนแปลง', 'มีการเพิ่ม แก้ไข หรือลบข้อมูลที่บันทึก', ['agent.memory_created', 'agent.memory_updated', 'agent.memory_deleted']],
    ['creative_succeeded', 'files', 'ขั้นตอนสร้างสื่อหรือเอกสารสำเร็จ', 'มีผลงานพร้อมให้ตรวจในหน้าสร้างสรรค์และเอกสาร', ['studio.step_completed']],
    ['creative_failed', 'files', 'ขั้นตอนสร้างสื่อหรือเอกสารไม่สำเร็จ', 'ตรวจสถานะงานก่อนเริ่มใหม่', ['studio.step_failed']],
    ['media_plan_created', 'files', 'แผนแก้ไขสื่อพร้อมตรวจสอบ', 'เตรียมแผนแล้ว แต่ยังไม่ยืนยันว่าแก้ไขสื่อสำเร็จ', ['media.ai_edit_plan_created']],
    ['media_plan_failed', 'files', 'เตรียมแผนแก้ไขสื่อไม่สำเร็จ', 'เกิดปัญหาระหว่างเตรียมแผนแก้ไขสื่อ', ['media.ai_edit_plan_failed']],
    ['social_message', 'social', 'มีข้อความใหม่', 'ข้อความส่วนตัวหรือข้อความในกลุ่ม', ['social.activity.message', 'social.activity.group-message']],
    ['social_call', 'social', 'มีสายโทรหรือวิดีโอคอล', 'กิจกรรมการโทรที่คุณมีสิทธิ์เข้าถึง', ['social.activity.call']],
    ['social_request', 'social', 'มีคำขอเป็นเพื่อน สนทนา หรือเข้ากลุ่ม', 'คำขอใหม่ที่ส่งถึงคุณหรือกลุ่มที่คุณดูแล', ['social.activity.friend-request', 'social.activity.thread-request', 'social.activity.group-request']],
    ['social_response', 'social', 'มีผลตอบรับคำขอ Social', 'การตอบรับหรือปฏิเสธคำขอของคุณ', ['social.activity.friend-accepted', 'social.activity.friend-declined', 'social.activity.thread-accepted', 'social.activity.thread-declined', 'social.activity.group-accepted', 'social.activity.group-declined']],
    ['social_reaction', 'social', 'มีคนกดถูกใจ แสดงความคิดเห็น หรือติดตาม', 'ความเคลื่อนไหวที่เกี่ยวกับเนื้อหาหรือโปรไฟล์ของคุณ', ['social.activity.like', 'social.activity.comment', 'social.activity.follow']],
    ['social_order', 'social', 'คำสั่งซื้อใน Market เปลี่ยนสถานะ', 'คำขอสั่งซื้อ การตอบรับ ส่งมอบ หรือยกเลิก', ['social.activity.order-requested', 'social.activity.order-accepted', 'social.activity.order-fulfilled', 'social.activity.order-cancelled']],
    ['social_live_ended', 'social', 'การถ่ายทอดสดสิ้นสุด', 'รายการถ่ายทอดสดที่คุณเข้าร่วมจบแล้ว', ['social.activity.live-ended']],
    ['social_connect', 'social', 'มีความสนใจตรงกันใน Connect', 'ผลความสนใจตรงกันที่คุณมีสิทธิ์ดู', ['social.activity.connect-match']],
    ['social_moderation', 'social', 'สถานะการแสดงเนื้อหาเปลี่ยนแปลง', 'เนื้อหาของคุณถูกซ่อนหรือคืนการแสดง', ['social.activity.moderation-hidden', 'social.activity.moderation-restored']],
    ['social_activity', 'social', 'กิจกรรม Social อื่น ๆ', 'ความเคลื่อนไหวอื่น ๆ ที่เกี่ยวข้องกับคุณ', ['social.activity']],
    ['billing_pending', 'billing', 'รอการชำระเงิน', 'คำสั่งซื้ออยู่ระหว่างรอชำระ', ['billing.pending']],
    ['billing_paid', 'billing', 'ยืนยันการชำระเงินแล้ว', 'ผู้ให้บริการยืนยันผลชำระเงิน', ['billing.paid']],
    ['billing_failed', 'billing', 'การชำระเงินไม่สำเร็จ', 'ผู้ให้บริการรายงานว่าชำระไม่สำเร็จ', ['billing.failed']],
    ['billing_expired', 'billing', 'คำสั่งชำระเงินหมดอายุ', 'คำสั่งซื้อหมดเวลาชำระเงิน', ['billing.expired']],
    ['billing_refunded', 'billing', 'มีการคืนเงินหรือยกเลิกการชำระ', 'สถานะการชำระเงินและสิทธิ์อาจเปลี่ยนแปลง', ['billing.refunded']],
    ['billing_verification', 'billing', 'ต้องตรวจสอบการชำระเงิน', 'ยังยืนยันผลชำระเงินไม่ได้', ['billing.verification_required']],
    ['ai_provider_failed', 'ai', 'บริการ AI ไม่พร้อมใช้งาน', 'ผู้ให้บริการ AI มีปัญหาระหว่างดำเนินงาน', ['ai.gateway.provider_failed']],
    ['ai_stream_failed', 'ai', 'การตอบกลับ AI สะดุด', 'การส่งคำตอบหยุดหรือเกิดปัญหาระหว่างทาง', ['ai.gateway.stream_provider_failed']]
  ];
  const entries = Object.freeze(rows.map(([id, category, label, description, types]) => Object.freeze({ id, category, label, description, types: Object.freeze(types) })));
  const defaults = Object.freeze(Object.fromEntries(entries.map(entry => [entry.id, true])));
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const keys = new Map();
  for (const entry of entries) for (const type of entry.types) keys.set(entry.category + ':' + type, entry.id);
  function keyFor(item) {
    if (!item || typeof item !== 'object') return null;
    if (item.type === 'user.requested') return 'self_notification';
    const exact = keys.get(item.category + ':' + item.type);
    if (exact) return exact;
    if (item.category === 'social' && typeof item.type === 'string' && item.type.startsWith('social.activity.')) return 'social_activity';
    return null;
  }
  function enabled(settings, item) {
    if (settings?.enabled !== true || !item) return false;
    const key = keyFor(item);
    const category = key ? byId.get(key).category : item.category;
    // A self-requested notice always belongs to its one visible System row,
    // even if its optional history metadata names another category.
    if (settings.categories?.[category] !== true) return false;
    // Old stored preferences have no events object; preserve their existing behavior.
    return !key || settings.events?.[key] !== false;
  }
  return Object.freeze({ entries, defaults, keyFor, enabled });
});
