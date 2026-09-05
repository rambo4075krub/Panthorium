# Sentinel Training Lab

Training Lab ทำให้ Sentinel เรียนรู้จากตัวอย่างที่ผู้ดูแลอนุมัติ โดยไม่ต้องฝึกโมเดลใหม่และไม่เปลี่ยน UI เดิม ตัวอย่างที่อนุมัติจะถูกค้นหาตามคำถามและแนบเป็นบริบทให้ AI แบบ RAG

## ค่าใช้จ่าย

- การเพิ่มและอนุมัติตัวอย่างด้วยตัวเองไม่มีค่าบริการ AI
- `POST /api/training/teachers/draft` เรียกเฉพาะ provider ที่มี API key อยู่แล้ว ค่าใช้จ่ายหรือโควตาฟรีขึ้นอยู่กับ provider
- ระบบไม่ส่งคำถามให้ provider ใดเลยจนกว่าแอดมินจะเรียก endpoint สร้าง draft

## ความปลอดภัย

- ทุก endpoint ต้องล็อกอินและมี permission `settings`
- คำตอบจาก AI ครูมีสถานะ `pending` และไม่มีผลกับ Sentinel จนกว่าแอดมินจะอนุมัติ
- ห้ามใส่รหัสผ่าน, API key, token หรือข้อมูลส่วนบุคคลในตัวอย่างฝึก
- มี rate limit สำหรับการเรียก AI ครู และบันทึก audit event ทุกการสร้าง/อนุมัติ

## API

- `GET /api/training/status` — จำนวนตัวอย่างและชนิดที่เก็บข้อมูล
- `GET /api/training/examples?status=pending` — ดูรายการรอตรวจ
- `POST /api/training/examples` — เพิ่ม `{ "prompt", "answer", "tags" }`
- `POST /api/training/teachers/draft` — ให้ provider ที่ตั้งค่าไว้สร้างคำตอบรอตรวจ โดยส่ง `{ "prompt", "providers", "tags" }`
- `POST /api/training/examples/:id/approve` — อนุมัติให้ Sentinel ใช้
- `POST /api/training/examples/:id/reject` — ปฏิเสธ
- `GET /api/training/export.jsonl` — ส่งออกชุดข้อมูลที่อนุมัติสำหรับ fine-tuning ในอนาคต

ถ้ามี `DATABASE_URL` ระบบจะเก็บถาวรใน PostgreSQL หากไม่มีจะใช้หน่วยความจำและข้อมูลจะหายเมื่อเซิร์ฟเวอร์รีสตาร์ต
