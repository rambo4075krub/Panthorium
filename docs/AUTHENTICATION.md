# Authentication & Token Flow

## Guest flow

```text
Browser -> POST /api/auth/guest
Server  -> signed JWT access token
Browser -> keeps access token in JS memory
Browser -> Authorization: Bearer <token> -> /api/chat
Middleware -> verifies issuer, audience, signature, expiry, permission
Route -> Sentinel Core
```

Guest มี `chat` และ `system:read` เท่านั้น จึงเรียก `/api/core/command` ไม่ได้

## Admin login flow

1. ตั้ง `ADMIN_USERNAME` และ `ADMIN_PASSWORD` ที่ environment ก่อนเริ่มระบบครั้งแรก
2. Server hash password ด้วย bcrypt cost 12 และเก็บเฉพาะ hash ใน data store
3. `POST /api/auth/login` ตรวจ bcrypt hash
4. Server ส่ง access JWT ใน response และ refresh token แบบ opaque ใน HttpOnly/SameSite cookie
5. ใน data store เก็บ refresh token เฉพาะ SHA-256 hash
6. `/api/auth/refresh` rotate refresh token: token เดิมถูกลบทิ้งและออกคู่ใหม่
7. `/api/auth/logout` revoke refresh token

## Credentials

AI API keys และ JWT secret ต้องอยู่ใน environment variables เท่านั้น ห้ามใส่ใน `sentinel.html`, localStorage หรือ commit ลง Git.
