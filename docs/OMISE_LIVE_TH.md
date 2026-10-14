# Omise Live / สิทธิ์แพ็กเกจ

โค้ดรองรับ PromptPay แบบสแกนชำระต่อรายการ ไม่ผูกบัตรและไม่หักเงินต่ออายุอัตโนมัติ
ราคาใช้ billing-catalog.js ตามเกณฑ์บุคคลธรรมดายังไม่จด VAT วันที่ 11 ตุลาคม 2569

## สิ่งที่เปิดสิทธิ์

- Live เท่านั้น: จ่ายสำเร็จและตรวจ GET Charge กับ Omise แล้ว จึงเขียนใบรับและสิทธิ์ในธุรกรรมฐานข้อมูลเดียวกัน
- ตรวจยอด สกุลเงิน เจ้าของคำสั่งซื้อ metadata และ livemode ก่อนยืนยัน
- เก็บ snapshot ราคาและโควต้าตอนสร้างรายการ ไม่อ่านข้อมูลสิทธิ์จาก client
- สมาชิกและพื้นที่เสริมอายุ 1 เดือน; Voice/Text/Download ซื้อครั้งเดียวอายุ 30 วันนับจาก paid_at
- โควต้าคงเหลือร่วมบัญชีทุกอุปกรณ์ เริ่มใช้แพ็กที่หมดอายุก่อน ไม่ทบยอดเมื่อหมดอายุ
- ไม่ขายสมาชิกฐานซ้อนรอบที่ยังใช้งาน และไม่สร้างสมาชิกใหม่เมื่อมีรายการเดิมที่ยังรอผล
- Storage/Download เสริมต้องมีสมาชิก Life ขึ้นไป รอบพื้นที่เสริมเริ่มตอนจ่าย เต็มราคา ไม่มี prorate กลางรอบ
- คืนเงินที่ตรวจพบจาก Omise ทำให้สิทธิ์รายการนั้นถูกเพิกถอน เก็บใบรับ Live สำหรับตรวจสอบย้อนหลัง
- สิทธิ์ Free ใช้รอบเดือนปฏิทินและวันตามเวลาไทย เสียงฐาน Free รวมสูงสุด 60 วินาทีต่อวัน
- โหมด Test เก็บตารางคำสั่งซื้อและใบรับแยก ไม่เพิ่มสิทธิ์จริง

## การควบคุมการใช้

Gemini Live WebSocket และ HTTP Live completion นับ PCM input/output จากระยะเวลาตัวอย่างเสียง
นับข้อความจากรายงาน TEXT modality แบบ cumulative ของ provider ใช้ delta เพื่อไม่คิดซ้ำ
คำขอ HTTP/งาน agent ส่ง userId ไปถึง completion ด้วย บัญชีระบบที่ไม่ใช่ UUID ไม่คิดเป็นโควต้าผู้ใช้
เมื่อตรวจโควต้าไม่ได้หรือโควต้าหมด จะปิด session แทนการปล่อยใช้ต่อ
Cloud Files ตรวจพื้นที่ก่อนอัปโหลดและนับ byte การดาวน์โหลดฝั่งเซิร์ฟเวอร์
โควต้าและการอัปโหลดใช้ advisory lock ต่อบัญชีใน PostgreSQL

QR โหลดผ่าน endpoint ที่ตรวจเจ้าของคำสั่งซื้อ ปิด redirect อัตโนมัติ จำกัด host เป็น api.omise.co/cdn.omise.co
จำกัดขนาด 1 MiB และชนิด SVG/PNG ไม่ส่ง secret ไป redirect host
หน้าชำระใช้ blob URL และตรวจสถานะอัตโนมัติทุก 10 วินาทีเฉพาะขณะเปิดรายการ pending
Webhook ดึง Event และ Charge ด้วย server key ใหม่ทุกครั้ง ไม่เชื่อสถานะใน request
รองรับ charge events และ refund events ที่อ้าง charge

## เปิด Live หลังผ่าน staging

1. Omise Dashboard → Switch to live mode หากยังมี Get started ให้ส่งใบสมัครและรออนุมัติก่อน
2. บัญชีต้องได้รับอนุมัติ Live และเปิด PromptPay แล้ว คีย์ Live จริงขึ้นต้น skey_ และ pkey_ (ไม่มี test_)
3. เก็บ Live secret ใน Secret Manager แยกจาก Test secret ห้ามใส่ source code หรือแชท
4. ให้ runtime service account มี secretAccessor เฉพาะ secret นั้น และผูก OMISE_SECRET_KEY ตามชื่อ env จริงด้านล่าง
5. ตั้ง `OMISE_SECRET_KEY` ผ่าน secret reference พร้อม `OMISE_MODE=live` และ `OMISE_LIVE_ENABLED=1`
6. ตั้ง webhook ใน Live Dashboard ให้ชี้ `/api/billing/webhook` ของ backend ที่เปิด Live จริง
7. `/api/billing/status` ต้องรายงาน mode=live, connected=true, checkoutEnabled=true
8. ซื้อรายการด้วยบัญชีเจ้าของที่ยืนยันแล้ว ตรวจ QR/ยอดก่อนสแกนจริง ตรวจผลจาก webhook โดยไม่กด refresh
9. ตรวจ `/api/billing/entitlements` ของบัญชีนั้น ราคาและสิทธิ์ตรงรายการ จ่ายซ้ำ callback ซ้ำไม่เปิดสิทธิ์ซ้ำ
10. ตรวจ quota การใช้จริง การหมดอายุ และกระบวนการคืนเงิน ก่อนเปิดขายทั่วไป

**ยังไม่มีหลักฐานผ่านเงินจริงจนกว่าจะใส่ Live Key และทดสอบกับบัญชีที่อนุมัติแล้ว**
Unit tests ใช้ provider/ฐานข้อมูลจำลอง ไม่ใช่หลักฐานว่าธนาคารรับชำระ Live แล้ว
QR host อื่นหรือชนิดภาพที่ไม่รองรับจะปฏิเสธและแสดงข้อความลองโหลดใหม่ ต้องตรวจ URL จริงเมื่อพบกรณีนั้น
Android native ยังไม่เปิด Omise checkout ต้องใช้ Play Billing ตามแผนเดิม

## คำสั่งผูก secret (ตัวอย่าง staging)

สร้าง secret `panthorium-staging-omise-live-secret-key` ผ่านหน้าจอ Secret Manager โดยใส่ Live Secret Key
แล้วใช้ Cloud Shell ใน project panthorium-staging:

```bash
gcloud secrets add-iam-policy-binding panthorium-staging-omise-live-secret-key \
  --project=panthorium-staging \
  --member=serviceAccount:staging-runtime@panthorium-staging.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor

gcloud run services update panthorium-backend-staging \
  --project=panthorium-staging --region=asia-southeast1 \
  --update-secrets=OMISE_SECRET_KEY=panthorium-staging-omise-live-secret-key:1 \
  --update-env-vars=OMISE_MODE=live,OMISE_LIVE_ENABLED=1
```

คำสั่งนี้เปิดสร้างรายการเงินจริงบน staging จึงใช้หลังบัญชี Live พร้อมและเจ้าของเริ่มการทดสอบเงินจริง
ไม่สร้าง charge เองจาก health check; ลูกค้าต้องเข้าสู่ระบบและยอมรับยอดชำระก่อนทุกครั้ง
