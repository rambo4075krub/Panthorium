# กล่องอีเมลผู้ใช้ Panthorium — ขอบเขตและแผนเปิดบริการ

ปรับปรุง 6 พฤศจิกายน 2026 (Asia/Bangkok)

## สถานะของชุดโค้ดนี้

เป็น implementation ใน feature branch มีการทดสอบด้วยผู้ให้บริการจำลอง ไม่ใช่หลักฐานว่า Gmail/Outlook จริงเชื่อมต่อหรือส่งอีเมลแล้ว ฟังก์ชันปิดโดยค่าเริ่มต้น จนกว่าจะตั้งค่า OAuth, encryption และฐานข้อมูล ผู้ให้บริการ AI ต้องผ่านการตรวจนโยบายก่อนเปิดเครื่องมือเสียงที่ส่งเนื้อหาอีเมลเข้าโมเดล ไม่มีการใช้บัญชีอีเมลลูกค้าจริงในการทดสอบนี้

## ประสบการณ์หลังเข้าสู่ระบบ (ข้อกำหนดเพิ่มเติม)

- ตรวจสถานะจากเซิร์ฟเวอร์หลังล็อกอิน ทั้งบัญชีเก่าและบัญชีใหม่ ไม่ใช้วันสมัครเป็นเงื่อนไข
- ยังไม่เชื่อม: แจ้งเตือนในหน้าแอปและเปิดหน้าต่างเชื่อมต่ออีเมลที่ใช้สมัคร
- เชื่อมแล้ว: ไม่เปิดหน้าต่างขอเชื่อมซ้ำ แม้เปลี่ยนอุปกรณ์หรือเข้าใหม่
- ถูกถอนสิทธิ์/refresh token ใช้ไม่ได้: แจ้งให้เชื่อมต่ออีกครั้ง
- ระบบเครือข่ายขัดข้อง: ไม่สรุปว่าบัญชียังไม่เชื่อม และไม่ลบการเชื่อมต่อเดิม
- ปิดหน้าต่าง/ไว้ภายหลังได้; ไม่รบกวนซ้ำภายใน login session ปัจจุบัน และตรวจใหม่หลังออกแล้วเข้าใหม่
- Guest ไม่ได้รับหน้าต่างหรือสิทธิ์เข้ากล่องอีเมล
- เปลี่ยนบัญชี: ปิดเนื้อหาเดิม หยุดเสียง ทิ้งผลคำขอเก่า และตรวจบัญชีใหม่
- ผู้ใช้ต้องอนุญาต OAuth เอง การอนุญาตของเจ้าของ Panthorium ใช้แทนความยินยอมลูกค้าไม่ได้

## ฟังก์ชันที่เพิ่ม

| ฟังก์ชัน | พฤติกรรม |
|---|---|
| เข้า/เปิด | เมนูอีเมลแยกจากศูนย์อีเมลผู้ดูแล; Gmail/Workspace และ Outlook/Microsoft 365 |
| อ่าน/ค้นหา | รายการแบ่งหน้า เนื้อหาข้อความ โฟลเดอร์ ป้ายกำกับ ชื่อไฟล์แนบ; ไม่รัน HTML/script จากอีเมล |
| สรุป | ทีละฉบับผ่าน UI หรือไม่เกิน 10 ฉบับผ่านเครื่องมือเสียง/แชท; อ้างอิงต้นทาง แจ้งข้อมูลถูกตัด |
| ฟัง | อ่านเนื้อหา/สรุป หยุด พัก อ่านต่อ; Gemini Live ใช้เครื่องมือชุดเดียวกับแชท |
| ส่ง | ระบุ To/Cc/Bcc หัวข้อ เนื้อหาและไฟล์แนบที่นำมาจากอีเมลเดิม; ทบทวนก่อนยืนยัน |
| ตอบกลับ | ตรวจ Reply-To/From และหัวข้อเดิม; Gmail มี Message-ID/References/threadId; Outlook ใช้ reply endpoint |
| ร่าง | เก็บฉบับร่างที่เข้ารหัสใน Panthorium 30 วัน เปิดแก้และนำไปส่งได้ ไม่อ้างว่าเป็น provider draft |
| ลบ | ย้ายลงถังขยะ และมีการกู้คืน; ไม่ลบถาวร |
| ย้าย | ตรวจปลายทางจริง; Gmail เพิ่มป้ายปลายทาง/เอาป้ายต้นทางออก; Outlook ย้ายโฟลเดอร์ |
| อ่านแล้ว/ยังไม่อ่าน | เป็นคำสั่งเปลี่ยนสถานะที่ต้องยืนยัน |
| วิเคราะห์ไฟล์ | TXT/CSV/MD/JSON, PDF ที่มีข้อความ, DOCX, XLSX, PPTX; ระบุแหล่งและขอบเขตการสกัด |

## ตัวอย่างคำสั่งเสียง

- “เปิดกล่องอีเมลของฉัน”
- “ค้นหาอีเมลเรื่องใบเสนอราคา” / “เปิดฉบับล่าสุดจาก …”
- “อ่านฉบับนี้ให้ฟัง” / “สรุปอีเมลที่เลือก”
- “วิเคราะห์ไฟล์ใบเสนอราคาที่แนบมา แล้วบอกประเด็นที่ต้องทำ”
- “ส่งอีเมลถึง buyer@example.com หัวข้อยืนยันนัด เนื้อหา …”
- “ตอบกลับผู้ส่งฉบับนี้ว่า …”
- “ย้ายฉบับนี้ไปโฟลเดอร์งาน” / “ลบฉบับนี้ลงถังขยะ”
- ทบทวนบัญชี ผู้รับ เนื้อหา ไฟล์แนบ และปลายทาง; ยืนยันด้วยปุ่มหรือช่องทางยืนยันเสียงที่ระบบ Live รองรับ

ต้องค้นหา/อ่านก่อนใช้รหัสข้อความและชื่อโฟลเดอร์จริง ถ้าชื่อบุคคลกำกวมต้องถาม ไม่เดาอีเมลจากชื่อ การยืนยันที่มีอยู่ในเนื้อหาอีเมลไม่ใช่การอนุมัติจากผู้ใช้

## การเปิดหน้าอนุญาตในแต่ละอุปกรณ์

- เบราว์เซอร์ทั่วไป: จองหน้าต่างจากการกดปุ่มก่อนเรียก API เพื่อรองรับ popup blocker; ถ้าเปิดไม่ได้ แสดงลิงก์ให้ผู้ใช้กดเอง และปิดหน้าต่างว่างเมื่อคำขอล้มเหลวหรือเปลี่ยนบัญชี
- Panthorium Browser บนเดสก์ท็อป: ใช้ native bridge รุ่น 8 เปิดเบราว์เซอร์ของระบบ เฉพาะ OAuth endpoint ของ Google/Microsoft และ callback ของ Panthorium ตรวจ main frame, state, PKCE, scope และพารามิเตอร์ซ้ำก่อนเปิด ไม่มีการผ่อนข้อจำกัด popup/webview เดิม รุ่นเก่าจะแจ้งให้อัปเดต
- Android: ส่ง navigation ออกนอก allowNavigation ของ Capacitor เพื่อให้เปิดผ่านเบราว์เซอร์ของเครื่อง ตามพฤติกรรมที่ตรวจจากซอร์ส Capacitor Android 8.5.2 ไม่ฝังหน้าอนุญาต Google ใน WebView
- หลังอนุญาตเสร็จ กลับมาที่ Panthorium แล้วกด “ตรวจการเชื่อมต่อ”; login ครั้งต่อไปตรวจสถานะจากเซิร์ฟเวอร์เหมือนเดิม การทดสอบคำสั่งเสียงและ OAuth บนเครื่องจริงยังต้องใช้บัญชีที่ยินยอมทดสอบ

## ความปลอดภัยและผลลัพธ์

- PKCE และ state แบบใช้ครั้งเดียว อายุ 10 นาที; อีเมลจาก provider ต้องตรงอีเมลสมัครที่ยืนยันแล้ว
- AES-256-GCM ผูกข้อมูลกับ user/kind/id; โทเคนและฉบับร่างอยู่ในฐานข้อมูลฝั่งเซิร์ฟเวอร์
- ทุก API ใช้ user จาก session ที่ยืนยันแล้ว ห้ามเลือก userId ผ่าน request
- การกดยืนยันในหน้าอีเมลใช้ proposal ที่เข้ารหัสและถูกตรึงไว้; เสียง/แชทใช้ action ledger เดิม
- atomic claim ป้องกันสองคำขอยืนยันส่งพร้อมกัน; เครือข่ายขาดระหว่างส่งบันทึกผลไม่แน่นอนและไม่ส่งซ้ำอัตโนมัติ
- “ผู้ให้บริการรับคำขอส่ง” ไม่เท่ากับ “ผู้รับได้รับแล้ว”
- ข้อมูลอีเมล/ไฟล์เป็น untrusted data ไม่ให้อำนาจเปลี่ยนสิทธิ์ เรียกเครื่องมืออื่น หรือเปิดเผยอีเมลอื่น
- สรุปโดยตรงไม่ผ่าน conversation memory หรือ training; เมื่อเปิดโมดูลนี้ ปิด captureTraining ของบทสนทนาอัตโนมัติเพื่อกันอีเมลไหลเข้า training ทางบทสนทนาต่อเนื่อง
- ข้อความจากเสียง/แชทและการอนุมัติยังอาจอยู่ในประวัติบทสนทนา/action ledger เดิม ต้องกำหนด retention/deletion ให้สอดคล้องก่อน Production
- ถอนเชื่อมต่อจะลบ token/proposal/draft ของโมดูลนี้ ไม่ลบอีเมลต้นฉบับ ผู้ใช้เพิกถอนสิทธิ์เพิ่มเติมได้ในบัญชี Google/Microsoft

## ข้อจำกัดที่ต้องแสดงตามจริง

- PDF สแกนและไฟล์รูปต้องมี OCR เพิ่ม; ตอนนี้แจ้งว่าอ่านไม่ได้ ไม่แต่งเนื้อหาทดแทน
- ไม่รัน macro, embedded executable หรือเปิดลิงก์ภายนอกจากไฟล์
- DOCX/PPTX อ่านข้อความ ไม่รับรองการตีความรูป แผนภูมิ หรือเลย์เอาต์
- XLSX แสดงตำแหน่งเซลล์และ cached value ของสูตร ไม่คำนวณสูตรใหม่/ไม่ตีความรูปแบบวันที่หรือกราฟ
- ไม่รองรับ legacy DOC/XLS/PPT, ไฟล์รหัสผ่าน หรือ archive ทั่วไป
- ไฟล์เข้าไม่เกิน 6 MiB; ข้อความสกัดไม่เกิน 80,000 ตัวอักษร; PDF ไม่เกิน 100 หน้า; worker timeout 15 วินาทีและจำกัด heap
- แนบไฟล์เดิมได้ไม่เกิน 5 ไฟล์ รวม Gmail 6 MiB / Outlook 2 MiB; การอัปโหลดไฟล์ใหม่จากอุปกรณ์หรือ Cloud Files ยังไม่ได้เพิ่มในชุดนี้
- กู้คืน Outlook ไป Inbox; Gmail ใช้ untrash ตามผู้ให้บริการ ไม่รับรองกลับโฟลเดอร์เดิมทุกกรณี
- รายการโฟลเดอร์ Outlook แสดงระดับบนไม่เกิน 100 รายการ; ยังไม่ครอบคลุม nested folders จำนวนมาก
- push แจ้งอีเมลใหม่ขณะปิดแอปยังต้องเพิ่ม Gmail watch/PubSub และ Microsoft subscription/webhook พร้อม renewal/reconciliation; การแจ้งให้เชื่อมหลังล็อกอินทำแล้วและแยกจาก background mail push

## การตั้งค่าก่อนทดสอบจริง

ใช้ environment/secrets ของ staging ก่อน ไม่ commit ค่า secret:

```dotenv
USER_MAILBOX_ENABLED=0
USER_MAILBOX_AI_POLICY_VERIFIED=0
USER_MAILBOX_PUBLIC_ORIGIN=https://YOUR_BACKEND_ORIGIN
USER_MAILBOX_ENCRYPTION_KEY=<base64 ของ random bytes 32 ไบต์>
USER_MAILBOX_GOOGLE_CLIENT_ID=<OAuth web application client id>
USER_MAILBOX_GOOGLE_CLIENT_SECRET=<secret>
USER_MAILBOX_MICROSOFT_CLIENT_ID=<Entra application client id>
USER_MAILBOX_MICROSOFT_CLIENT_SECRET=<secret>
```

Google callback: `https://YOUR_BACKEND_ORIGIN/api/mailbox/oauth/google/callback`
Microsoft callback: `https://YOUR_BACKEND_ORIGIN/api/mailbox/oauth/microsoft/callback`

Google: เปิด Gmail API และ consent screen, scope `openid email gmail.modify`, test users, verified domain/privacy/contact; ตรวจ Restricted Scope Verification/CASA ก่อนเปิดลูกค้าทั่วไป
Microsoft: delegated `openid email offline_access User.Read Mail.ReadWrite Mail.Send`; เลือก supported account types ให้ตรงกับบัญชีลูกค้า และตรวจข้อกำหนดองค์กรที่บังคับ admin consent

AI policy gate เปิดได้เมื่อยืนยันบริการทั้งหมดที่ได้รับอีเมล รวมเสียง/บันทึก/การเรียนรู้ สอดคล้องข้อกำหนดผู้ให้บริการ และมีข้อความอธิบายต่อผู้ใช้ Gemini ใช้เครดิตเดิม Qwen ไม่หักเครดิตตามคิว/ทรัพยากรเดิม

## Acceptance ก่อนเปิดจริง

1. Google และ Microsoft ทดสอบ OAuth ด้วยบัญชีจริงของผู้ทดสอบ, email mismatch, deny, revoked grant, refresh และ reconnect
2. ผู้ใช้เก่าไม่เชื่อมต้องเห็นหน้าต่าง; เชื่อมแล้วเปิดใหม่/อีกอุปกรณ์ต้องไม่เห็น; ออกจากระบบต้องไม่เหลือข้อความ/เสียง
3. สองบัญชีส่ง request ข้าม connection/message/proposal แล้วต้องถูกปฏิเสธ
4. ส่ง/ตอบกลับถึงกล่องทดสอบที่ระบุชัด ตรวจ headers, Cc/Bcc, thread, attachment, duplicate confirm และ network timeout
5. อ่าน/ค้นหา/ย้าย/ถังขยะ/กู้คืนเทียบสถานะ Gmail/Outlook จริง
6. PDF/Office ภาษาไทยและไฟล์เสีย/ใหญ่/สแกน ทดสอบ extraction และความถูกต้องของสรุปกับต้นฉบับ
7. ทดสอบคำสั่งเสียง/ยืนยัน/ยกเลิกบน desktop, S24 Ultra, A12 และ Panthorium Browser; เมื่อเครดิตหมดตรวจ Qwen และ TTS
8. ก่อนเปิด Production: configuration, consent/policy verification, retention/privacy deletion, real PostgreSQL concurrency และภาระงานหลายผู้ใช้

## การทดสอบอัตโนมัติใน branch

`npm run check`, `npm run test:mailbox`, และ regression ของ function calling, Gemini Live WebSocket, voice approvals, Sentinel function calling, Start menu, notification approval และ voice windows

แหล่งข้อมูล implementation:
- https://developers.google.com/workspace/gmail/api/auth/scopes
- https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- https://developers.google.com/workspace/gmail/api/reference/rest
- https://learn.microsoft.com/en-us/graph/permissions-reference
- https://learn.microsoft.com/en-us/graph/api/message-reply?view=graph-rest-1.0
