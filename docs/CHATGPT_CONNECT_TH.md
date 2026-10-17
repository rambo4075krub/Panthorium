# เชื่อม ChatGPT กับ Panthorium

ตัวเชื่อมนี้ให้ ChatGPT เรียกเครื่องมือของบัญชี Panthorium ผ่าน MCP โดยใช้บัญชีและสิทธิ์เดิมของ Panthorium การเผยแพร่เซิร์ฟเวอร์สำเร็จยังไม่แปลว่าเชื่อมบัญชี ChatGPT แล้ว ต้องเพิ่มปลั๊กอินและอนุญาตบัญชีก่อน

## ตั้งค่าเซิร์ฟเวอร์

กำหนดค่าที่บริการ Cloud Run ของสภาพแวดล้อมนั้น:

```text
PANTHORIUM_MCP_ENABLED=1
PANTHORIUM_MCP_BASE_URL=https://panthorium.net
```

`PANTHORIUM_MCP_BASE_URL` ต้องเป็น HTTPS origin ที่ผู้ใช้และ ChatGPT เข้าถึงได้จริง ไม่มี path, query หรือ fragment สำหรับ staging ให้ใช้ origin ของ staging และบัญชีทดสอบแยกจาก production อย่าใช้ production origin บน staging

| หน้าที่ | เส้นทาง |
| --- | --- |
| MCP แบบ Streamable HTTP | `/mcp` |
| ข้อมูลวิธีเชื่อมและจัดการการเชื่อมต่อ | `/mcp/connect` |
| OAuth protected resource metadata | `/.well-known/oauth-protected-resource/mcp` |
| OAuth authorization server metadata | `/.well-known/oauth-authorization-server` |
| ลงทะเบียน OAuth client | `POST /oauth/register` |
| ลงชื่อเข้าใช้และอนุญาตบัญชี | `/oauth/authorize` |
| แลก code หรือ refresh token | `POST /oauth/token` |
| เพิกถอน token ของ OAuth client | `POST /oauth/revoke` |
| รายการการเชื่อมต่อของบัญชี | `GET /oauth/grants` |
| เพิกถอนการเชื่อมต่อของบัญชี | `DELETE /oauth/grants/:grantId` |
| ยืนยันการทำงานที่ต้องอนุมัติ | `/mcp/approve` |

MCP ใช้ transport แบบ stateless เพื่อรองรับหลาย Cloud Run instances ใน production ต้องมี `DATABASE_URL` ที่ชี้ไป PostgreSQL ของสภาพแวดล้อมนั้น เซิร์ฟเวอร์สร้างตาราง `panthorium_mcp_oauth` เมื่อเริ่มทำงาน และไม่เปิดใช้ OAuth ด้วยที่เก็บในหน่วยความจำหากไม่มีฐานข้อมูล สถานะการอนุมัติงานสื่อใช้ action ledger เดิม

Authorization code, access token และ refresh token เก็บเป็น SHA-256 hash; ไม่เก็บค่าดิบไว้ในตาราง OAuth การใช้ code และการหมุน refresh token ใช้ transaction และ row lock เพื่อป้องกันหลาย instance ใช้คำขอเดียวกันซ้ำ Access token มีอายุไม่เกิน 1 ชั่วโมง การเชื่อมต่อมีอายุ 30 วัน และการใช้ refresh token เก่าซ้ำจะเพิกถอนการเชื่อมต่อนั้น

## เพิ่มใน ChatGPT

1. เปิด `https://panthorium.net/mcp/connect` หลังเผยแพร่และตรวจสอบเซิร์ฟเวอร์แล้ว
2. ใน ChatGPT เปิด Plugins → `+` → **Add custom MCP server** ชื่อเมนูหรือสิทธิ์เพิ่มปลั๊กอินอาจต่างกันตามบัญชีและ workspace
3. ตั้งชื่อ `Panthorium` และใส่ Server URL `https://panthorium.net/mcp`
4. เลือก OAuth สร้างปลั๊กอิน แล้วเชื่อมบัญชี Panthorium ในหน้าต่างที่เปิดขึ้น
5. ตรวจชื่อบัญชีและสิทธิ์ที่ร้องขอ แล้วกดอนุญาตบนโดเมน Panthorium
6. เริ่มบทสนทนาใหม่ เลือกปลั๊กอิน Panthorium และทดลองอ่านข้อมูลบัญชีหรือรายการไฟล์ของตัวเอง

ตัวเชื่อมรองรับการลงทะเบียน OAuth client แบบ DCR สำหรับ callback ที่อนุญาตไว้ตรงตัว:

```text
https://chatgpt.com/connector_platform_oauth_redirect
```

Authorization response ส่งค่า `iss` ระบุ issuer ด้วย ไม่ใช้ wildcard callback และไม่เปลี่ยน redirect เป็นเว็บไซต์อื่นเพื่อแก้ข้อผิดพลาดการเชื่อมต่อ

หากหน้าจัดการ MCP ของ ChatGPT แสดง callback เฉพาะปลั๊กอิน ให้คัดลอก URL ที่แสดงจริงมาเพิ่มใน `PANTHORIUM_MCP_REDIRECT_URIS` แล้วเผยแพร่ใหม่ ค่านี้เป็นรายการ URL แบบตรงตัวคั่นด้วย comma ห้ามเดา callback ID หรือเปิด wildcard เพื่อให้ผ่านการตรวจสอบ

การลงชื่อเข้าใช้เกิดบนหน้า Panthorium ผ่านระบบบัญชีเดิม ไม่ต้องส่งรหัสผ่าน, access token หรือ secret ในแชต หากมี session อยู่ หน้าอนุญาตจะใช้การลงชื่อเข้าใช้จาก origin เดียวกัน

## สิทธิ์และการอนุมัติ

| OAuth scope | การใช้งาน |
| --- | --- |
| `panthorium:read` | อ่านโปรไฟล์ การใช้ AI ประวัติสนทนา ค้นคลังความรู้ ปฏิทิน เป้าหมาย งานเตือน โน้ต ความทรงจำ และ Cloud Files ภายในสิทธิ์ของบัญชี รวมทั้งตรวจความพร้อมสื่อและรายการวิดีโอ |
| `panthorium:media` | เสนองานสร้างวิดีโอ วางแผนตัดต่อ ตัดต่อด้วย AI ถอดเสียง เรนเดอร์ และติดตามผล โดยยังตรวจสิทธิ์และการอนุมัติแต่ละครั้ง |

หากคำขอ OAuth ไม่ระบุ scope จะได้รับเฉพาะ `panthorium:read` การใช้เครื่องมือสื่อต้องอนุญาต `panthorium:media` ด้วย รายการ `tools/list` กรองทั้ง scope และสิทธิ์บัญชี ไม่เปิดเครื่องมือผู้ดูแลระบบหรือเครื่องมือเขียนข้อมูลทั่วไปผ่านตัวเชื่อมนี้

OAuth scope ไม่เพิ่มบทบาทผู้ดูแลระบบ และไม่ข้ามข้อจำกัดบัญชี การเข้าถึงไฟล์ต้องผูกกับเจ้าของบัญชีเสมอ งานสร้างหรือประมวลผลสื่อที่ต้องยืนยันจะส่งผู้ใช้ไปอนุมัติที่ `/mcp/approve` ก่อนดำเนินการ การยืนยันในขั้นตอนนี้ต้องผูกกับงานและบัญชีที่ร้องขอ ไม่รับเพียงคำสั่งจากโมเดลว่า “อนุมัติแล้ว”

การเชื่อมปลั๊กอินไม่ทำให้โมเดลสร้างวิดีโอหรือบริการภายนอกใช้ฟรี ค่าใช้บริการและโควตาของ Panthorium ยังคงมีผล

เซิร์ฟเวอร์ใช้ authorization code พร้อม PKCE S256 และกำหนด issuer จาก canonical origin ส่วน MCP รับเฉพาะ OAuth token ของตัวเชื่อม ตรวจ resource ที่ผูกกับ `/mcp`, อายุ token, การเพิกถอน, scope และสถานะบัญชีล่าสุดก่อนเรียกเครื่องมือ ไม่รับ JWT ของหน้าเว็บเป็น MCP token การติดตั้งปลั๊กอินไม่ได้อนุญาตให้เข้าถึงบัญชีอื่นหรือเรียกเครื่องมือภายในทุกตัวโดยอัตโนมัติ

## ยกเลิกการเชื่อมต่อ

เปิด `/mcp/connect` ลงชื่อเข้าใช้บัญชีที่เชื่อมไว้ เลือกรายการ แล้วกด **ยกเลิกการเชื่อมต่อ** และยืนยัน หน้าเว็บใช้ `GET /oauth/grants` และ `DELETE /oauth/grants/:grantId` ภายใต้ session ของบัญชีปัจจุบัน การเพิกถอนทำให้ access token และ refresh token ของการเชื่อมต่อนั้นใช้ต่อไม่ได้ ไม่ต้องรอ access token หมดอายุ

OAuth client เพิกถอนได้ผ่าน `POST /oauth/revoke` โดยส่ง `token` และ `client_id` แบบ `application/x-www-form-urlencoded` หลังเพิกถอนแล้ว สามารถลบหรือยกเลิกการเชื่อมปลั๊กอินจาก ChatGPT ได้ด้วย

หากต้องการปิดบริการ MCP ทั้งระบบ ให้ตั้ง `PANTHORIUM_MCP_ENABLED=0` และเผยแพร่ revision ใหม่ การปิดทั้งระบบมีผลกับผู้ใช้ตัวเชื่อมทุกบัญชี

## ตรวจสอบก่อนใช้งานจริง

รัน syntax checks และชุดทดสอบ MCP/OAuth/UI:

```sh
npm run check:mcp
npm run test:mcp
```

จากนั้นรันชุดทดสอบของ repository:

```sh
npm run check
npm test
```

กำหนด `TEST_DATABASE_URL` ให้ชี้ไป PostgreSQL สำหรับทดสอบที่แยกจาก production แล้วรัน `npm run test:postgres` ชุดนี้รวม `test/mcp-postgres.js` เพื่อตรวจสถานะ OAuth ที่ใช้ร่วมกันระหว่าง instance และการเปลี่ยนสถานะแบบ transaction ห้ามชี้ชุดทดสอบไปฐานข้อมูล production

ใช้ MCP Inspector หรือ client ที่รองรับ Streamable HTTP ตรวจ initialization, tool listing และ read-only tool call กับบัญชีทดสอบ ตรวจด้วยว่าคำขอไม่มี token ถูกปฏิเสธพร้อมข้อมูล OAuth discovery

ชุดตรวจ MCP/OAuth ต้องครอบคลุม PKCE, callback ตรงตามรายการอนุญาต, authorization code ใช้ได้ครั้งเดียว, token ผิด resource/หมดอายุ, scope ไม่พอ, บัญชีถูกระงับหรือเพิกถอน session, การแยกข้อมูลระหว่างบัญชี และงานสื่อที่ยังไม่ได้รับอนุมัติ ห้ามใช้การเรียกโมเดลเสียเงินเป็นเพียง health check

หลัง deploy ให้ตรวจ `/health` และ discovery ทั้งสองเส้นทางว่าตอบข้อมูลสำหรับ origin ที่ตั้งไว้ `/mcp` ที่ไม่มี bearer token ต้องตอบ HTTP 401 พร้อม `WWW-Authenticate` ที่ชี้ไป resource metadata จากนั้นทดสอบเชื่อมบัญชีใน ChatGPT และเรียก `panthorium_profile` สำเร็จ จึงรายงานว่า “เชื่อมแล้ว” การได้ HTTP 200 จาก health endpoint อย่างเดียวไม่ยืนยันว่า OAuth หรือการเรียกเครื่องมือทำงาน

เอกสารอ้างอิง:

- [OpenAI: Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI: Authentication](https://developers.openai.com/plugins/build/auth)
- [OpenAI: Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt)
