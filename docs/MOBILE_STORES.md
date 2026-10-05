# Panthorium บนสมาร์ทโฟน (Google Play / App Store)

## สิ่งที่ระบบรองรับแล้ว

1. **หน้าดาวน์โหลดหลายแพลตฟอร์ม** (`/browser-download.html`)
   - Windows / macOS / Linux / Android / iOS
   - แสดง**เฉพาะเวอร์ชันล่าสุด**ของแต่ละระบบ
   - ชื่อไฟล์ระบุ OS เช่น `Panthorium-Browser-user-15.0.4-windows-x64.exe`

2. **PWA**
   - ติดตั้งจากเบราว์เซอร์มือถือได้ทันที (Add to Home Screen / Install app)
   - ใช้ `manifest.json` ที่มีอยู่

3. **ตัวแปรสำหรับลิงก์สโตร์**
   - `PLAY_STORE_URL` — ลิงก์ Google Play เมื่อแอปเผยแพร่แล้ว
   - `APP_STORE_URL` — ลิงก์ App Store เมื่อแอปเผยแพร่แล้ว

## ข้อจำกัดสำคัญ (ต้องทำเองนอก repo)

การ**อัปโหลดเข้า Google Play และ Apple App Store** ต้องมี:

| สโตร์ | บัญชี | ค่าใช้จ่ายโดยประมาณ | แพ็กเกจ |
|--------|--------|---------------------|---------|
| Google Play | Google Play Console | ~$25 ครั้งเดียว | `.aab` (Android App Bundle) |
| Apple App Store | Apple Developer Program | ~$99 / ปี | `.ipa` ผ่าน Xcode / Transporter |

บัญชี, การเซ็นชื่อ (signing), การตรวจ Privacy/Policy และรีวิวสโตร์ **ทำแทนใน GitHub Actions อย่างเดียวไม่ได้** ต้องมีเจ้าของบัญชียืนยันตัวตน Privacy/Policy มีศูนย์รวมฉบับ staging ใน Start Menu แล้ว แต่ก่อนส่งขึ้นสโตร์เจ้าของบริการต้องยืนยันตัวตนผู้ควบคุมข้อมูล/ช่องทางติดต่อ ระยะเก็บข้อมูลและผู้ประมวลผล พร้อมตรวจเนื้อหาตามกฎหมายที่ใช้บังคับ

## เส้นทางที่แนะนำ

### ระยะสั้น (พร้อมใช้ทันที)
- ให้ผู้ใช้มือถือเปิด Panthorium OS บน Chrome/Safari แล้ว **Install / เพิ่มไปยังหน้าจอหลัก** (PWA)

### ระยะกลาง (native wrapper)
ใช้ [Capacitor](https://capacitorjs.com/) ห่อเว็บ Panthorium:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap init "Panthorium Browser" com.panthorium.browser
npx cap add android
npx cap add ios
npx cap sync
```

จากนั้น:
- Android: เปิดใน Android Studio → Build → Generate Signed Bundle → อัปโหลด Play Console ตัว preview ใช้ immersive fullscreen และแสดงแถบระบบชั่วคราวเมื่อผู้ใช้ปัดจากขอบจอ
- iOS: เปิดใน Xcode (ต้องใช้ Mac) → Archive → Distribute → App Store Connect

### ชื่อไฟล์เมื่อมีแพ็กเกจมือถือ
- `Panthorium-Browser-user-{version}-android.apk` หรือ `.aab`
- `Panthorium-Browser-user-{version}-ios.ipa`

หน้าดาวน์โหลดจะเลือกไฟล์เหล่านี้ให้อัตโนมัติ และถ้าตั้ง `PLAY_STORE_URL` / `APP_STORE_URL` จะแสดงปุ่มเข้าสโตร์

## นโยบาย “เฉพาะเวอร์ชันล่าสุด”
- หน้าดาวน์โหลดจัดเรียง semver แล้วเก็บ**ไฟล์ใหม่สุดต่อแพลตฟอร์ม**เท่านั้น
- GitHub Release แท็ก `staging` ใช้ `overwrite_files: true` ตอน publish
- Auto-update ของ Electron อ่าน manifest ต่อแพลตฟอร์มและติดตั้งเมื่อเวอร์ชันสูงกว่าที่ติดตั้งอยู่
