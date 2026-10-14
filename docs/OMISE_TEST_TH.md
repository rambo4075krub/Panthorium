# Omise staging — โหมด Test

ใช้ OMISE_SECRET_KEY แบบ skey_test_ เท่านั้น โค้ดปฏิเสธ live key และไม่เพิ่มสิทธิ์/โควต้าใช้งานจริง ไม่มีการตัดเงินจริง ไม่มีการต่ออายุอัตโนมัติ รายการทดสอบไม่ใช้แทนการเปิดขายจริง

GET /api/billing/status ตรวจฐานข้อมูลและ GET /account จาก Omise ก่อนเปิดปุ่มทดสอบ
POST /api/billing/checkout ต้องเป็นบัญชีลงทะเบียน มี requestKey UUID และ testAcknowledged=true ราคาเลือกจาก catalog ฝั่ง server เท่านั้น
GET /api/billing/orders/:id ตรวจเจ้าของและเรียก Omise ใหม่เพื่อยืนยันสถานะ
POST /api/billing/webhook รับ event ID เป็นเพียงคำใบ้ แล้ว GET event และ charge จาก Omise ตรวจ test mode, order ID, amount, currency, charge ID ก่อนบันทึกสถานะ

ฐานข้อมูล PostgreSQL: panthorium_omise_test_orders และ panthorium_omise_test_receipts เก็บแยกจากสิทธิ์จริง คำสั่งซื้อมี unique user/request key ก่อนเรียก charge ถ้าเครือข่ายล้มเหลวไม่สร้าง charge ซ้ำจากคำขอเดิม ผลกำกวมต้องให้ webhook ตรวจหรือผู้ดูแลตรวจ Omise คำขอเดิม ไม่เดาว่าล้มเหลว

ใน Omise Test Dashboard ตั้ง webhook URL ของ staging เป็น /api/billing/webhook จากนั้นสร้างรายการในหน้าแพ็กเกจ กดยืนยันโหมด Test เปิด charge ใน Dashboard → Actions → Successful/Failed กดตรวจสถานะใน Panthorium ไม่ใช้แอปธนาคารสแกน QR ทดสอบ

การเปิดขายจริงยังต้องเพิ่มการบังคับโควต้า/สิทธิ์ตามแพ็กเกจ การต่ออายุ/ยกเลิกสมาชิก ข้อกำหนดคืนเงิน และทดสอบการคืนเงินจริง ก่อนเปลี่ยน integration ให้ยอมรับ live key ไม่ให้เปิดเพียงเปลี่ยน env

ตรวจ npm run check และ npm test ครอบคลุมค่าราคาแก้จาก client, บัญชี guest, การอ่านรายการของคนอื่น, callback ปลอม/ซ้ำ, refunded, test mode และการส่งคำขอซ้ำ
