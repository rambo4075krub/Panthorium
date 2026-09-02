# Deployment

## Render

ตั้ง environment variables อย่างน้อย:

- `NODE_ENV=production`
- `JWT_SECRET=<random secret อย่างน้อย 32 bytes>`
- `TRUST_PROXY=1`
- `ALLOWED_ORIGINS=https://<your-render-domain>`
- API key ของ provider ที่ต้องการใช้

ถ้าต้องการ admin ให้เพิ่ม `ADMIN_USERNAME` และ `ADMIN_PASSWORD` ก่อน deploy ครั้งแรก

> `data/` และ `logs/` บน filesystem ของบริการแบบ ephemeral อาจหายเมื่อ redeploy. สำหรับ production ควรใช้ persistent disk หรือเปลี่ยน repository เป็น PostgreSQL และส่ง audit log ไป log service.
