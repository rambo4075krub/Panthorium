# Panthorium OS

Panthorium OS เป็น Web OS ที่ใช้ Sentinel เป็น backend AI orchestrator เวอร์ชันนี้รีแฟกเตอร์โครงสร้างภายในโดยคงหน้าตา `sentinel.html` เดิมไว้

## เริ่มใช้งาน

```bash
cp .env.example .env
npm install
npm start
```

เปิด `http://localhost:8787`

## Security model

- UI ขอ guest access token อัตโนมัติและเก็บ token ใน memory เท่านั้น
- `/api/chat`, `/api/chat/stream` และ `/api/sentinel/status` ต้องมี Bearer token
- `/api/sentinel/command` จำกัดสิทธิ์ `sentinel:command` และ guest ใช้ไม่ได้
- Admin password ถูก hash ด้วย bcrypt ก่อนบันทึก
- Refresh token ของ admin อยู่ใน HttpOnly cookie และเก็บเฉพาะ SHA-256 hash ฝั่ง server
- AI provider API keys อ่านจาก environment variables เท่านั้น ไม่เก็บใน browser/localStorage
- มี Helmet/CSP, CORS allowlist, rate limit, request validation และ audit log

ดูรายละเอียดที่ `docs/ARCHITECTURE.md`, `docs/AUTHENTICATION.md`, `docs/DEPLOYMENT.md`
