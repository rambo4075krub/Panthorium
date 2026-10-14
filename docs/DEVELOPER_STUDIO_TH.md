# Panthorium Developer Studio

Developer Studio อยู่ใน Start Menu ของบัญชีผู้สร้างระบบเท่านั้น การตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์ผูกกับ ID ถาวรของบัญชี การเปลี่ยนชื่อหรือให้บัญชีอื่นเป็น administrator ไม่ให้สิทธิ์นี้ บัญชีเจ้าของลบไม่ได้และสิทธิ์พื้นฐานของเจ้าของลดไม่ได้ การเข้าสู่ระบบและการเพิกถอน session ยังตรวจตามปกติ

## ใช้งาน

1. เปิด Developer Studio → โหลด staging ล่าสุด → ค้นหาและเปิด source
2. แก้ไฟล์ด้วย editor หรือสั่ง Gemini Live ด้วยข้อความให้หาไฟล์และเสนอแก้โค้ด (เลือก checkbox 1–6 ไฟล์เองได้)
3. ตรวจ source ก่อน/หลังทุกไฟล์ ยืนยัน แล้วสร้าง branch และ PR ไป staging
4. ตรวจ CI → เมื่อผ่านจึง merge staging ระบบ deploy ด้วย GitHub Actions เดิม
5. เปิดแท็บ Cloud Run ตรวจผล deploy ของ commit นี้ และทดสอบเว็บทั้ง `/` กับ `/admin` ด้วยบัญชีจริง
6. หลัง deploy ผ่าน ยืนยันผลทดสอบและพิมพ์ SHA ที่ทดสอบเพื่อสร้าง PR ไป main รอ CI ของ PR production แล้วจึงยืนยัน merge main

ทุกงานเก็บใน PostgreSQL เปิดกลับมาดูได้ การสร้าง branch/PR ซ้ำจากข้อเสนอเดียวจะใช้ branch เดิม ระบบตรวจ staging และ main ที่เปลี่ยนระหว่างทำงานเพื่อป้องกันการเขียนทับ การเปลี่ยนโค้ดไม่ถูกรันบน Cloud Run instance ที่ให้บริการเว็บ การตรวจ source JavaScript/JSON ก่อน PR เป็นเพียง syntax; GitHub CI เป็นผู้รัน tests จริง AI ไม่สามารถยืนยันว่า tests ผ่านแทน CI ได้

## เชื่อมต่อครั้งเดียว

ต้องตั้ง credential นี้ในโครงการเอง เนื่องจาก OAuth ของ GitHub ที่เชื่อมกับ ChatGPT ไม่สามารถนำมาใช้เป็น token ของแอปได้

- สร้าง [GitHub fine-grained token](https://github.com/settings/personal-access-tokens/new) จำกัด repository `rambo4075krub/Panthorium` และตั้งวันหมดอายุ
- Repository permissions: Contents = Read and write; Pull requests = Read and write; Actions = Read-only; Metadata = Read-only (อัตโนมัติ)
- หากต้องแก้ไฟล์ `.github/workflows/` ให้เพิ่ม Workflows = Read and write ด้วย
- เปิด [Google Cloud Shell](https://shell.cloud.google.com/?project=panthorium-staging) ด้วยบัญชีเจ้าของโครงการ แล้วรัน `bash scripts/configure-developer-studio.sh` จาก checkout ของ repository นี้ หรือคัดลอกเนื้อหา script ไป Cloud Shell
- script รับ token แบบซ่อนตัวอักษร เก็บใน Secret Manager ชื่อ `panthorium-staging-developer-github-token`, อนุญาต runtime SA อ่านเฉพาะ secret นี้, bind เป็น `DEVELOPER_GITHUB_TOKEN` และให้ `roles/run.viewer` อ่านสถานะ Cloud Run
- ตรวจ “เชื่อมต่อ” ใน Studio ต้องแสดง GitHub เชื่อมต่อแล้ว จากนั้นเปิด Code & AI แล้วโหลดไฟล์
- เมื่อ token หมดอายุหรือเพิกถอน ให้รัน script อีกครั้งด้วย token ใหม่ Secret เดิมยังใช้อยู่

ห้ามส่ง token ในแชท ช่อง AI หรือ source code ไม่มีช่องรับ token บน frontend Token ไม่ถูกส่งกลับ browser สถานะ Cloud Run เลือกเฉพาะ revision/traffic/URL ไม่คืน environment หรือ secret ของ service

## ขอบเขตของรุ่นนี้

- ผู้ช่วยใช้ Gemini Live ที่โครงการตั้งอยู่ ค่าใช้จ่ายเป็น Google Cloud ของโครงการ แยกจากแพ็กเกจลูกค้า จำกัด 3 คำขอ/นาที และ 20 คำขอ/24 ชั่วโมงรวมคำขอที่ล้มเหลว มี lock กันงาน AI ซ้อน
- บริบท AI สูงสุด 65,000 ตัวอักษร เลือกเฉพาะไฟล์ source ไม่มีการส่ง environment, credential หรือฐานข้อมูลผู้ใช้ให้ AI
- editor สร้าง/แก้ source ได้สูงสุด 8 ไฟล์ต่อข้อเสนอ (150 KB ต่อไฟล์ / 350 KB รวม) ช่องแก้มือใน UI แก้ทีละไฟล์ API รองรับหลายไฟล์
- ไฟล์ binary, credential, lockfile และการลบไฟล์ยังไม่รองรับ ข้อเสนอเป็น source replacement ที่ตรวจได้
- ไม่มี shell/terminal ที่รันคำสั่งบน Cloud Run และไม่มีการนำสิทธิ์ Google Cloud ทั้งโครงการไปให้ AI
- deploy ผ่าน workflow เดิม ไม่ต้องให้ runtime SA สิทธิ์ deploy หรือเข้าถึง Cloud SQL เพิ่ม
- อ่าน logs รายละเอียดและ rerun workflow ผ่านลิงก์ GitHub Actions ด้วยบัญชีเจ้าของ ยังไม่มี AI อ่าน build logs อัตโนมัติ
- นี่เป็นเครื่องมือพัฒนาใน Panthorium ด้วย Gemini Live ไม่ใช่ ChatGPT/Codex ที่ติดตั้งในเว็บ และไม่รับรองความสามารถเหมือนกันทุกงาน

## ตรวจหลังตั้งค่า

ทดสอบเปลี่ยนไฟล์เอกสารเล็กหนึ่งไฟล์ → เปิด diff → สร้าง PR → CI → staging deploy → อ่าน revision/traffic แล้วตรวจไฟล์ที่ deploy จริง บัญชี administrator อื่นต้องไม่เห็นไอคอนและได้ HTTP 403 เมื่อเรียก `/api/admin/developer/*` แม้ใส่ `systemOwner:true` เอง
