# Panthorium Cloud บน Google Cloud

## ทิศทางที่ยืนยันแล้ว

Panthorium เป็นบริการคลาวด์และบัญชีของคุณ แต่เช่าโครงสร้างพื้นฐานจาก Google Cloud ไม่ต้องซื้อหรือตั้งเครื่องเซิร์ฟเวอร์จริงเอง Google ให้บริการเครื่อง ฐานข้อมูล และพื้นที่ไฟล์ ส่วน Panthorium เป็นผู้กำหนดบัญชีผู้ใช้ สิทธิ์ โควตา หน้าบริการ การดูแลข้อมูล และค่าบริการที่เรียกเก็บจากผู้ใช้

Google Cloud กับ Google Play Billing เป็นคนละบริการ:
- **Google Cloud** ใช้โฮสต์ API, ฐานข้อมูล และไฟล์ของ Panthorium
- **Google Play Billing** ใช้รับและจัดการค่าสมาชิกรายเดือนในแอป Android
- การมี Play Billing ไม่ได้เก็บไฟล์หรือข้อมูลแอปให้โดยอัตโนมัติ

## สถานะโค้ดปัจจุบัน

- staging ใช้ Google Cloud Run, Cloud SQL และ Artifact Registry ตาม `.github/workflows/deploy-staging.yml`; API ใช้ PostgreSQL ผ่าน `DATABASE_URL`
- Notes ผูกกับบัญชีจาก session ที่ตรวจสอบแล้ว; โค้ด PR นี้ย้าย Notes จาก Cloud SQL ไปเก็บเป็น object ใน Cloud Storage แยก prefix ตาม account ID และย้ายโน้ตเก่าแบบคัดลอก/ตรวจสอบก่อนลบข้อมูลต้นทาง
- ค่า AI ของ staging เลือก Vertex; การใช้ Vertex เป็นการเรียกบริการ AI เพิ่มเติมจาก API/ฐานข้อมูล และมีต้นทุน/การประมวลผลข้อมูลของตัวเอง
- Files มี API สำหรับรายการ อัปโหลด ดาวน์โหลด และลบ โดย backend ใช้ account ID จาก session; ขีดจำกัดในโค้ดปัจจุบันคือ 20 MiB ต่อไฟล์, 100 MiB และ 1,000 ไฟล์ต่อบัญชี
- Notes และ Files ใช้ bucket ที่ระบุผ่าน `PANTHORIUM_FILES_BUCKET`; staging/production ต้องใช้ bucket คนละใบและให้ Cloud Run runtime service account มี `roles/storage.objectUser` บน bucket ของสภาพแวดล้อมนั้นเท่านั้น
- ปฏิทินและการเตือนมีโค้ด UI/API บางส่วนแล้ว แต่การซิงก์ครบทุกอุปกรณ์และการแจ้งเตือนขณะอุปกรณ์ออฟไลน์ยังต้องทดสอบและพัฒนาต่อ; การเก็บไฟล์สื่อขนาดใหญ่ยังต้องทดสอบกับ bucket จริง

## โครงสร้างเป้าหมาย

1. **Panthorium Browser และแอป** เชื่อมโดเมน API ของ Panthorium ด้วย HTTPS
2. **Cloud Run** รัน API ของ Panthorium ใน Google Cloud project ที่คุณควบคุม
3. **Cloud SQL for PostgreSQL** เก็บบัญชี ปฏิทิน งาน นัด เตือนยา การตั้งค่า และ metadata ที่เป็นข้อมูลเชิงโครงสร้าง โดย API ใช้ account ID จาก session ที่ตรวจสอบแล้ว ห้ามเชื่อ `user_id` ที่แอปส่งมาเอง เนื้อหา Notes เก็บใน Cloud Storage ตามการย้ายใน PR นี้
4. **Cloud Storage bucket ส่วนตัวของ Panthorium** เก็บไฟล์ รูป วิดีโอ และสื่อ ตั้ง Public Access Prevention ห้ามเปิด bucket เป็นสาธารณะ ให้ backend ตรวจเจ้าของ/โควตาก่อนออกสิทธิ์อัปโหลดหรือดาวน์โหลด และกำหนดอายุ URL ชั่วคราวให้สั้น
5. **ระบบสมาชิก** บันทึกโควตาของแต่ละบัญชีในฐานข้อมูล หลัง backend ตรวจสอบสถานะการซื้อจาก Google Play แล้วเท่านั้น
6. **การแจ้งเตือน** เก็บตารางนัดและเวลาเตือนในคลาวด์เป็นข้อมูลหลัก แต่โทรศัพท์ยังใช้ระบบแจ้งเตือนของ Android เพื่อส่งเสียง/แสดงเตือนขณะไม่ได้เปิดแอป

ไม่จำเป็นต้องสร้าง bucket แยกต่อผู้ใช้ ให้เก็บไฟล์ใน bucket ส่วนตัวของบริการและให้ API ใช้ account ID จากการยืนยันตัวตน พร้อมจำกัดสิทธิ์อ่าน/เขียนในทุกคำขอ วิธีนี้ดูแลง่ายกว่าและป้องกันไม่ให้ผู้ใช้เปลี่ยน path เพื่อเห็นไฟล์ของผู้อื่น

## ลำดับดำเนินงาน

1. แยก Google Cloud project สำหรับ staging และ production พร้อมกำหนดเจ้าของ Billing Account, IAM และ service account ที่มีสิทธิ์เท่าที่จำเป็น
2. เตรียม bucket ส่วนตัวแยกสำหรับ staging และ production; ตั้ง Public Access Prevention และห้ามปะปนข้อมูลทดสอบกับข้อมูลจริง
3. ให้ `roles/storage.objectUser` แก่ Cloud Run runtime service account เฉพาะ bucket ของสภาพแวดล้อมนั้น และกำหนด GitHub repository variables `PANTHORIUM_STAGING_FILES_BUCKET` กับ `PANTHORIUM_PRODUCTION_FILES_BUCKET`
4. ตรวจทดสอบ Notes migration และ Files API ด้วย bucket จริง แยกบัญชี และยืนยันสิทธิ์ของ runtime service account ก่อนเปิดใช้
5. ตั้ง CORS ให้เฉพาะโดเมน Panthorium ที่ใช้งานจริง และคำนวณโควตากับต้นทุน Cloud Storage/เครือข่ายก่อนเปิดแพ็กเกจพื้นที่
6. ทดสอบระบบ Notes/Files บน Browser โทรศัพท์และแท็บเล็ต ด้วยบัญชีเดียวกันและบัญชีที่แยกจากกัน
7. ทำ API และฐานข้อมูลสำหรับปฏิทิน งาน เตือนยา และเตือนนัด แล้วทดสอบการซิงก์บัญชีเดียวกันระหว่างอุปกรณ์
8. เพิ่ม Play Billing: แอปส่ง purchase token ให้ backend, backend ตรวจสอบกับ Google Play ก่อนเปิดแพ็กเกจ/เพิ่มโควตา และปรับสิทธิ์เมื่อการสมัครต่ออายุ ยกเลิก หรือหมดอายุ
9. ทดสอบบัญชีแยกกันบนเว็บทั่วไปและ Panthorium Browser ทั้ง Admin/Guest รวมทั้งบัญชีเดียวกันบนโทรศัพท์และแท็บเล็ต ก่อนค่อยพิจารณา merge `main`

## ค่าใช้จ่ายและแพ็กเกจพื้นที่

Cloud Storage มีต้นทุนหลายส่วน เช่น ปริมาณข้อมูลที่เก็บ การเรียกใช้งานไฟล์ การรับส่งข้อมูลออกจากระบบ และตัวเลือกการทำสำเนา/สำรองข้อมูล จึงควรเริ่มด้วยแพ็กเกจโควตาชัดเจนเป็น GB ต่อบัญชี ไม่ใช้คำว่าไม่จำกัด จับคู่โควตากับต้นทุนจริงและตั้งการแจ้งเตือนงบประมาณใน Google Cloud

ค่าบริการรายเดือนที่ผู้ใช้จ่ายผ่าน Google Play เป็นรายรับของแพ็กเกจ Panthorium ส่วน Google Cloud จะเรียกเก็บค่าการใช้โครงสร้างพื้นฐานกับเจ้าของโปรเจกต์ Panthorium แยกกัน ต้องคำนวณต้นทุน Cloud Storage, เครือข่าย, Cloud SQL, Cloud Run, backup และ AI ก่อนกำหนดราคาให้ต่ำกว่า AI subscription ทั่วไป

เป้าหมายผู้ใช้ 10 ล้านคนต้องทดสอบ capacity, การกระจายโหลด, redundancy, backup/restore, monitoring และค่าใช้จ่ายตามรูปแบบการใช้งานจริง เซิร์ฟเวอร์ staging หรือการทดสอบผ่านมือถือสองเครื่องยังไม่ยืนยันว่าระบบพร้อมรองรับ 10 ล้านบัญชี

## ขอบเขตของ PR นี้

PR นี้เพิ่มการย้าย Notes จาก Cloud SQL ไป Cloud Storage, API Cloud Files, การแยกข้อมูลตามบัญชี และเปิดการตรวจ Voice Identity ใน deployment ตามค่าที่กำหนด แต่ยังไม่สร้าง bucket/กำหนด IAM ให้อัตโนมัติ การทดสอบ Cloud Storage ใน CI ใช้ mock จึงต้องตรวจ bucket จริงและทำ staging acceptance ก่อน merge ส่วน Play Billing และการรองรับผู้ใช้ 10 ล้านคนยังไม่อยู่ในขอบเขตนี้
