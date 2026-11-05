(function () {
  'use strict';

  const APP_ID = 'privacy-policy';
  // Extend the central registry through PanthoriumPrivacyPolicy.register({id,title,sections}).
  const policies = new Map();
  const initialPolicies = [
  {
    "id": "privacy-notice",
    "title": "นโยบายความเป็นส่วนตัว — Panthorium Browser",
    "subtitle": "Privacy Policy · ฉบับ 3.7 · ปรับปรุง 5 พฤศจิกายน 2026",
    "sections": [
      [
        "ผู้ให้บริการและขอบเขต",
        "Panthorium Browser (Android package: com.panthorium.browser) และบริการ Panthorium ดำเนินการโดยปานเทพ มีเหมือน ติดต่อเรื่องความเป็นส่วนตัวและคำขอใช้สิทธิได้ที่ account@panthorium.net นโยบายนี้ครอบคลุมแอป เว็บไซต์ panthorium.net และบริการ Cloud ที่คุณเรียกใช้ผ่านบัญชีเดียวกัน แม้แอปทำหน้าที่เป็นเบราว์เซอร์ ข้อมูลที่คุณส่งให้บริการ Panthorium บน Cloud ก็อยู่ในขอบเขตนี้"
      ],
      [
        "ข้อมูลบัญชีและอุปกรณ์",
        "เมื่อสมัครหรือใช้งานบัญชี ระบบประมวลผลชื่อ อีเมล รหัสผ่านในรูปค่า hash รหัสบัญชี บทบาทและสิทธิ์ ข้อมูลเซสชัน ตัวระบุอุปกรณ์ที่ระบบสร้างขึ้น และบันทึกการเข้าถึง เช่น IP เวลา คำขอและข้อผิดพลาด เพื่อยืนยันตัวตน รักษาเซสชัน และดูแลความปลอดภัย รหัสผ่านแบบอ่านได้และ OTP ไม่ควรถูกส่งให้ทีมสนับสนุน"
      ],
      [
        "เนื้อหาที่คุณเลือกใช้งาน",
        "ระบบประมวลผลข้อความ เสียงสนทนา คำสั่ง ไฟล์ รูปภาพ วิดีโอ เอกสาร และผลลัพธ์ที่คุณส่ง สร้าง หรือบันทึก รวมถึงบันทึกส่วนตัว ความจำ การตั้งค่า งานอัตโนมัติ สถานะงานและการใช้โควตาตามฟังก์ชันที่ใช้งาน การเก็บบน Cloud ทำให้คุณเข้าถึงข้อมูลได้จากอุปกรณ์อื่น การปิดแอปหรือถอนการติดตั้งไม่ลบข้อมูลเหล่านี้"
      ],
      [
        "วัตถุประสงค์",
        "ใช้ข้อมูลเพื่อสร้างและกู้คืนบัญชี ให้บริการ AI และเครื่องมือที่ร้องขอ จัดเก็บและเรียกคืนงาน จัดการสิทธิ์และโควตา ช่วยเหลือผู้ใช้ และป้องกันการใช้ผิดวัตถุประสงค์ ข้อมูลที่จำเป็นต่อบริการใช้ตามสัญญา ข้อมูลความปลอดภัยใช้เพื่อประโยชน์โดยชอบที่ต้องพิจารณาสิทธิผู้ใช้ ข้อมูลตามหน้าที่กฎหมายใช้เพื่อปฏิบัติหน้าที่นั้น ส่วนการสร้างแม่แบบเสียงต้องให้ความยินยอมแยกตามขั้นตอนที่แสดง"
      ],
      [
        "ผู้รับข้อมูลและบริการภายนอก",
        "ข้อมูลหลักของบัญชี ฐานข้อมูลและไฟล์จัดเก็บบนเซิร์ฟเวอร์ที่ผู้ให้บริการ Panthorium ดูแล และใช้ Cloudflare เพื่อเชื่อมต่อเว็บไซต์อย่างปลอดภัย ผู้ให้บริการเครือข่ายอาจประมวลผล IP และข้อมูลคำขอที่ผ่านระบบ; การประมวลผล AI บางฟังก์ชันใช้โมเดลบนเซิร์ฟเวอร์ของเรา และบางฟังก์ชันส่งข้อมูลที่จำเป็นไปยัง Google Gemini/Vertex AI หรือ Google Cloud; Google Firebase Cloud Messaging (FCM) และบริการ Push ของเบราว์เซอร์ เช่น Google, Mozilla หรือ Apple ใช้ส่งแจ้งเตือนเมื่อเปิดรับ; Resend รับอีเมลผู้รับและเนื้อหาสำหรับ OTP การแจ้งเตือนหรืออีเมลที่ผู้ใช้สั่งส่ง; Omise รับข้อมูลที่จำเป็นต่อการชำระ โดย Panthorium เก็บเลขคำสั่งซื้อ เลขอ้างอิงการชำระ ราคา แพ็กเกจ และสถานะชำระเงิน ไม่ส่งประวัติสนทนา AI ให้ Omise เพื่อประมวลผลการชำระ ผู้ให้บริการภายนอกอาจประมวลผลข้อมูลในประเทศอื่นตามบริการที่เรียกใช้ การส่งข้อมูลจำกัดตามวัตถุประสงค์และมาตรการคุ้มครองที่เกี่ยวข้อง"
      ],
      [
        "Social Media และการสื่อสารระหว่างบัญชี",
        "เมื่อใช้ Feed, Short, Watch, Live, TV, Market, Community, Chat หรือ Connect รูปแรกของโปรไฟล์ใช้แสดงเป็นรูปผู้โพสต์ต่อผู้ที่มีสิทธิ์ดูโพสต์ โดยข้อมูลเกี่ยวกับฉันยังไม่เผยแพร่ ระบบเก็บโปรไฟล์ โพสต์ ความคิดเห็น สมาชิกกลุ่ม ข้อความ รายการสินค้า คำขอสั่งซื้อและสถานะที่คุณสร้างตามฟังก์ชันนั้น ผู้รับเข้าถึงตามกลุ่มผู้ชมและสิทธิ์ที่เลือก ไฟล์แนบอ้างอิงไฟล์ Cloud ของเจ้าของบัญชีและใช้โควตาพื้นที่บัญชีนั้น Connect เปิดเฉพาะเมื่อคุณเลือกเข้าร่วมและยืนยันด้วยตนเองว่าอายุ 18 ปีขึ้นไป โดยไม่ใช่การตรวจเอกสารอายุ การโทรและไลฟ์ใช้กล้องหรือไมโครโฟนเมื่อคุณสั่งและอนุญาต ระบบแลกเปลี่ยนข้อมูลเชื่อมต่อ WebRTC ซึ่งอาจเปิดเผยข้อมูลเครือข่ายแก่คู่สนทนาหรือบริการเชื่อมต่อ และไม่บันทึกเสียงหรือวิดีโอการโทรอัตโนมัติ TV เก็บข้อมูลช่อง ช่องโปรด และข้อมูลติดต่อผู้ให้บริการเพื่อให้ผู้ดูแลตรวจสอบ ช่องฟรีทีวีใช้เครื่องเล่นแบบฝังของ TrueID ซึ่งอาจใช้คุกกี้และการตั้งค่าของผู้ให้บริการ เมื่อสื่อภายนอกเริ่มเล่นอัตโนมัติในรายการหรือเมื่อเปิดเว็บไซต์สถานี ผู้ให้บริการภายนอกจะได้รับข้อมูลการเชื่อมต่อของคุณตามนโยบายของตน คำขอสั่งซื้อใน Market ไม่ใช่หลักฐานว่าชำระเงินแล้ว การบล็อกหรือถอนการแบ่งปันไม่สามารถเรียกคืนสำเนาที่ผู้รับดาวน์โหลดไปแล้ว"
      ],
      [
        "เครื่องมือที่เชื่อมต่อและการแบ่งปัน",
        "เมื่อคุณเชื่อมต่อหรืออนุญาตให้เครื่องมือภายนอกทำงาน ระบบส่งข้อมูลตามขอบเขตสิทธิ์และงานที่เลือก เช่น ข้อความหรือไฟล์ต้นทาง ผู้รับภายนอกอาจมีนโยบายของตนเอง ฟังก์ชันองค์กรหรือทีมที่คุณใช้สามารถเปิดให้สมาชิกที่มีสิทธิ์เข้าถึงข้อมูลร่วมกันได้ โปรดตรวจสิทธิ์ก่อนแบ่งปัน นโยบายนี้ไม่หมายความว่าเครื่องมือหรือแผนงานทุกอย่างได้เปิดให้ใช้งานแล้ว"
      ],
      [
        "คุกกี้และการจัดเก็บในอุปกรณ์",
        "ใช้คุกกี้และที่เก็บภายในเบราว์เซอร์สำหรับเซสชัน การตั้งค่า และการจดจำอุปกรณ์ การจดจำรหัสผ่านใช้ความสามารถของเบราว์เซอร์เมื่อคุณเลือกอนุญาต คุณจัดการสิทธิ์และข้อมูลเว็บไซต์ผ่านการตั้งค่าอุปกรณ์ได้ การล้างข้อมูลอุปกรณ์อาจทำให้ต้องเข้าสู่ระบบใหม่ แต่ไม่เท่ากับลบบัญชีบน Cloud"
      ],
      [
        "การรักษาความปลอดภัย",
        "ใช้ HTTPS สำหรับการเชื่อมต่อบริการ การตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์ การจำกัดอัตราคำขอ และการแยกการเข้าถึงข้อมูลตามบัญชี รหัสผ่านและ refresh token จัดเก็บเป็น hash แม่แบบเสียงเข้ารหัสในระบบ ข้อมูลลับของบริการจัดการฝั่งเซิร์ฟเวอร์ มาตรการเหล่านี้ลดความเสี่ยง แต่ไม่ใช่คำรับประกันว่าระบบปลอดภัยอย่างสมบูรณ์"
      ],
      [
        "สิทธิและช่องทางติดต่อ",
        "คุณสามารถติดต่อ account@panthorium.net เพื่อขอเข้าถึง รับสำเนา แก้ไข ลบ จำกัดหรือคัดค้านการใช้ โอนข้อมูล หรือถอนความยินยอมตามเงื่อนไขที่เกี่ยวข้อง เราจะตรวจสอบตัวตนเท่าที่จำเป็นก่อนดำเนินการ หากมีเหตุจำกัดสิทธิจะอธิบายเหตุให้ทราบ คุณอาจร้องเรียนต่อสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคลได้"
      ],
      [
        "ผู้เยาว์และการเปลี่ยนแปลงนโยบาย",
        "ผู้เยาว์ต้องดำเนินการร่วมกับผู้แทนโดยชอบธรรมเมื่อจำเป็นตามกฎหมาย โดยเฉพาะก่อนให้ข้อมูลชีวมิติ ข้อความนี้ไม่ใช่การรับรองว่าบริการได้รับอนุมัติสำหรับเด็กทุกวัย เมื่อเปลี่ยนการใช้ข้อมูลสำคัญ เราจะปรับนโยบาย แจ้งผู้ใช้ผ่านบริการ และขอความยินยอมเพิ่มเติมเมื่อจำเป็น ฉบับปัจจุบันเข้าถึงได้ที่ /privacy และจากเมนูนโยบายในแอป"
      ],
      [
        "Gemini Live และ Qwen 4B",
        "ระบบใช้ Gemini Live API ของ Google เป็นหลักสำหรับเสียง และอาจเลือก Qwen 4B สำหรับงานข้อความที่เหมาะสม คิดเครดิต AI เฉพาะการประมวลผลด้วย Gemini Live API ส่วน Qwen และการถอด/สร้างเสียงในเซิร์ฟเวอร์ไม่หักเครดิตผู้ใช้ เครดิต Gemini หมดแล้วใช้ Qwen ต่อได้ฟรีเมื่อทรัพยากรพร้อม หากเลือก Qwen โดยตรงจะไม่เปลี่ยนไปใช้บริการที่หักเครดิตโดยไม่แจ้ง"
      ],
      [
        "เส้นทางข้อมูลของ AI และเสียง",
        "ข้อความ บริบท เสียง และผลเครื่องมือที่จำเป็นสำหรับ Gemini Live จะถูกส่งไปประมวลผลกับ Google ส่วน Qwen ถอดเสียงและสร้างเสียงบนเครื่องเซิร์ฟเวอร์ของผู้ให้บริการ Panthorium ไม่ใช่ประมวลผลบนอุปกรณ์ของผู้ใช้ทุกคน การใช้ Qwen จึงไม่ใช่คำรับรองว่าข้อมูลไม่ออกจากอุปกรณ์ผู้ใช้ เสียงสำหรับถอดและสร้างในเส้นทาง Qwen ประมวลผลชั่วคราวในหน่วยความจำ ส่วนข้อความบทสนทนาและบันทึกการใช้เครื่องมืออยู่ภายใต้นโยบายการเก็บข้อมูลเดิม"
      ],
      [
        "เครื่องมือ API และ MCP",
        "ทั้งสองโมเดลเรียกเครื่องมือ API ที่ลงทะเบียนและเปิดใช้งานตามสิทธิ์บัญชีได้ และเข้าถึงเครื่องมืออ่านข้อมูลของ MCP ภายใน Panthorium ได้ การเรียกบริการภายนอกอาจส่งคำค้นหรือข้อมูลที่จำเป็นไปยังผู้ให้บริการนั้นแม้ใช้ Qwen การเปลี่ยนแปลงข้อมูลที่ต้องอนุมัติยังต้องยืนยันตามรายละเอียดจริง ระบบไม่ให้โมเดลยืนยันแทนผู้ใช้ MCP ภายนอกอื่นต้องมีการเชื่อมต่อและสิทธิ์แยก ไม่ได้เปิดทุกเซิร์ฟเวอร์โดยอัตโนมัติ"
      ],
      [
        "ข้อจำกัดบริการ Qwen ฟรี",
        "Qwen เป็นบริการเสริมเมื่อเครื่องพร้อม ระบบจำกัดงานพร้อมกันและตรวจ RAM/VRAM เพื่อรักษาระบบหลัก ตั้งเพดานทรัพยากร AI และพักหรือถอดโมเดลออกจากหน่วยความจำเมื่อเกินเกณฑ์ ทั้งนี้ไม่ใช่การรับประกันว่า RAM/VRAM รวมทั้งเครื่องซึ่งรวมระบบปฏิบัติการและโปรแกรมอื่นจะไม่เกิน 60% บริการอาจรอ เริ่มช้า ปฏิเสธงานชั่วคราว หรือถูกปิดเมื่อจำเป็น คำตอบและความสามารถอาจลดลง เสียง Qwen เป็นการถอดเสียง–ตอบข้อความ–สร้างเสียง สำหรับคำตอบสั้นเตรียมเสียงครบก่อนเล่น ส่วนคำตอบยาวแบ่งตามช่วงภาษาและเตรียมเสียงล่วงหน้า ความต่อเนื่องขึ้นกับเครื่องและเครือข่าย ไม่รับประกันเทียบเท่าเสียงสด"
      ]
    ]
  },
  {
    "id": "account-security",
    "title": "บัญชีและความปลอดภัย",
    "subtitle": "Account & Security",
    "sections": [
      [
        "การเข้าสู่ระบบ",
        "บัญชีใช้รหัสผ่านที่จัดเก็บเป็นค่า hash ร่วมกับการยืนยันอีเมลตามขั้นตอนสมัครหรือกู้บัญชี เก็บ refresh token เป็น hash ฝั่งเซิร์ฟเวอร์ คุกกี้เซสชันและข้อมูลอุปกรณ์ใช้รักษาการเข้าสู่ระบบและป้องกันการใช้งานที่ไม่ได้รับอนุญาต"
      ],
      [
        "คุกกี้และที่เก็บในอุปกรณ์",
        "คุกกี้ที่จำเป็นใช้สำหรับเซสชัน localStorage/sessionStorage ใช้บันทึกการตั้งค่า อุปกรณ์ และสถานะคำสั่งซื้อบางส่วน ไม่ใช้ข้อความนี้เป็นความยินยอมต่อการติดตามเพื่อโฆษณา หากเพิ่มการติดตามที่ต้องขอความยินยอม จะขอแยกก่อนเริ่ม"
      ],
      [
        "การป้องกัน",
        "ใช้การควบคุมสิทธิ์ฝั่งเซิร์ฟเวอร์ แยกสิทธิ์ผู้ใช้และผู้ดูแล และจำกัดอัตราคำขอ โปรดรักษารหัสผ่านและข้อมูลยืนยันบัญชี หากสงสัยว่าถูกเข้าถึงโดยไม่ได้รับอนุญาตให้ติดต่อผู้ให้บริการทันที"
      ]
    ]
  },
  {
    "id": "ai-processing",
    "title": "เสียงสนทนา AI และเครื่องมือสร้างงาน",
    "subtitle": "AI processing",
    "sections": [
      [
        "ข้อความและคำตอบของผู้ช่วย AI",
        "Panthorium คือบริการผู้ช่วย AI ผ่านเว็บไซต์และแอป สำหรับถามตอบ สรุปข้อมูล ช่วยร่างข้อความ และสั่งงานเครื่องมือที่เปิดใช้งาน โดยพิมพ์ข้อความหรือพูดผ่านไมโครโฟน แล้วรับคำตอบเป็นข้อความหรือเสียง ข้อความที่ส่งให้ AI หมายถึงคำถาม คำสั่ง และบริบทที่ระบบส่งไปประมวลผล ส่วนคำตอบจาก AI คือข้อความที่ระบบสร้างกลับมา โทเคนเป็นหน่วยย่อยของข้อความ ไม่ใช่จำนวนข้อความหรือจำนวนคำตายตัว โควต้านี้ไม่ใช่แพ็กเกจ SMS ค่าโทรศัพท์ หรือการส่งข้อความโฆษณา ระบบอาจรวมคำสั่งของระบบ ประวัติสนทนา หรือข้อมูลที่จำเป็นกับคำถามเพื่อให้ AI ตอบต่อเนื่อง โดยใช้โมเดลที่ให้บริการบนเซิร์ฟเวอร์ของเรา หรือบริการ AI ภายนอกตามฟังก์ชันที่เลือก ผลลัพธ์อาจคลาดเคลื่อนและควรตรวจสอบก่อนนำไปใช้"
      ],
      [
        "ไมโครโฟนและเสียงสนทนา",
        "เมื่อคุณเปิดฟังก์ชันเสียงและอนุญาตไมโครโฟน เสียงจะถูกส่งไปประมวลผลเพื่อสนทนา ถอดความ หรือทำคำสั่งผ่านบริการที่เปิดใช้งาน ข้อความถอดเสียง ประวัติหรือผลลัพธ์อาจถูกบันทึกตามฟังก์ชันที่ใช้ หยุดการรับเสียงได้จากตัวควบคุมในแอปหรือเพิกถอนสิทธิ์ไมโครโฟนของอุปกรณ์"
      ],
      [
        "ความจำและงานบน Cloud",
        "ข้อมูลที่บันทึกเป็นความจำ บันทึกส่วนตัว และสถานะงานช่วยให้ทำงานต่อเนื่องได้ งานอัตโนมัติที่เปิดไว้บน Cloud อาจทำต่อแม้ปิดเบราว์เซอร์ คุณต้องยกเลิกงานหรือปิดการทำงานในระบบหากไม่ต้องการให้ทำต่อ การปิดหน้าต่างเพียงอย่างเดียวไม่ใช่การยกเลิกงาน"
      ],
      [
        "การปรับปรุงและฝึกโมเดล",
        "การส่งคำสั่งเพื่อให้บริการไม่ถือเป็นความยินยอมให้นำข้อมูลชีวมิติหรือข้อมูลอ่อนไหวไปฝึกโมเดลทั่วไป การใช้ข้อมูลเพิ่มเติมนอกวัตถุประสงค์ที่แจ้งต้องมีฐานการประมวลผลและขอความยินยอมเมื่อจำเป็น นโยบายนี้ไม่อ้างว่าผู้ให้บริการภายนอกไม่มีการเก็บข้อมูลใดเลย"
      ],
      [
        "ข้อมูลการใช้โควต้าร่วม",
        "ระบบประมวลผลจำนวนโทเคนข้อความและเวลาข้อมูลเสียงที่รับส่ง แล้วแปลงเป็นเครดิต AI ตามอัตราที่แสดงก่อนซื้อ ผูกยอดใช้และวันหมดอายุกับบัญชีและรายการซื้อ เพื่อควบคุมสิทธิ์ บอกยอดคงเหลือ และตรวจสอบข้อโต้แย้งเรื่องค่าบริการ ข้อมูลโควต้าเป็นตัวนับการใช้บริการ ไม่ใช่การขายเนื้อหาข้อความหรือเสียงของผู้ใช้ การรวมโควต้าไม่เปลี่ยนการขอสิทธิ์ไมโครโฟนหรือความยินยอม Voice Identity"
      ]
    ]
  },
  {
    "id": "voice-identity",
    "title": "Voice Identity และแม่แบบเสียง",
    "subtitle": "Voice identity",
    "sections": [
      [
        "แยกจากเสียงที่ใช้คุยกับ AI",
        "ตัวอย่างเสียงที่บันทึกเพื่อลงทะเบียน Voice Identity ถูกประมวลผลเพื่อสร้างแม่แบบสำหรับจับคู่เสียง เป็นข้อมูลสำหรับระบุตัวตนและต้องให้ความยินยอมโดยชัดแจ้งก่อนลงทะเบียน แยกจากการอนุญาตไมโครโฟนเพื่อสนทนาทั่วไป"
      ],
      [
        "การใช้และการจัดเก็บ",
        "ระบบประมวลผลตัวอย่างเสียงและเก็บแม่แบบเสียงที่เข้ารหัส พร้อมข้อมูลโปรไฟล์และความยินยอม เพื่อจับคู่เสียงและควบคุมการใช้ฟังก์ชันเสียง ผลจับคู่อาจคลาดเคลื่อน ไม่รับรองความแม่นยำทั้งหมด และไม่แทนสิทธิ์บัญชีหรือรหัสผ่านในทุกขั้นตอน"
      ],
      [
        "ถอนความยินยอม",
        "ลบโปรไฟล์เสียงผ่านตัวเลือก Voice Identity ที่มีให้ หรือขอถอนความยินยอมและลบข้อมูลที่ account@panthorium.net การถอนอาจทำให้ฟังก์ชันที่ต้องจับคู่เสียงใช้ไม่ได้ ไม่กระทบการประมวลผลที่ดำเนินการโดยชอบก่อนถอน"
      ]
    ]
  },
  {
    "id": "cloud-files",
    "title": "ไฟล์และพื้นที่จัดเก็บ",
    "subtitle": "Cloud Files",
    "sections": [
      [
        "พื้นที่และโควตา",
        "ไฟล์จัดเก็บในโครงสร้างพื้นฐาน Google Cloud โดยแยกเจ้าของและตรวจสิทธิ์ในการเข้าถึง ขนาดต่อไฟล์และพื้นที่รวมเป็นไปตามหน้าฟังก์ชันและแพ็กเกจ พื้นที่เพิ่มและสิทธิ์ดาวน์โหลดมีระยะใช้งานตามรายการซื้อ"
      ],
      [
        "สิทธิ์ในเนื้อหา",
        "คุณยังคงมีสิทธิ์ในเนื้อหาของคุณและอนุญาตให้ Panthorium ประมวลผล จัดเก็บ และส่งข้อมูลเท่าที่จำเป็นต่อบริการ ต้องมีสิทธิ์ใช้ไฟล์ก่อนอัปโหลด และรับผิดชอบการเผยแพร่หรือแบ่งปันของคุณ"
      ],
      [
        "การลบและสำรอง",
        "ลบไฟล์ได้ใน Files การออกจากระบบหรือปิดหน้าต่างไม่ใช่การลบข้อมูล สำเนาที่ดาวน์โหลดหรือส่งไปภายนอกไม่ถูกลบตามไปด้วย โปรดสำรองข้อมูลสำคัญก่อนสิทธิ์พื้นที่หมดอายุหรือขอปิดบัญชี"
      ]
    ]
  },
  {
    "id": "retention-choices",
    "title": "ระยะเก็บรักษาและข้อมูลสำรอง",
    "subtitle": "Retention",
    "sections": [
      [
        "บัญชีและเนื้อหาบน Cloud",
        "ข้อมูลบัญชี ไฟล์ งาน ความจำ และแม่แบบเสียงเก็บขณะบัญชีหรือฟังก์ชันที่เกี่ยวข้องยังใช้งาน จนคุณลบรายการหรือคำขอลบบัญชีได้รับการดำเนินการ ระบบไม่ได้ลบข้อมูลทั้งหมดอัตโนมัติเมื่อไม่มีการใช้งานหรือถอนการติดตั้งแอป คุณขอลบรายการเฉพาะได้โดยไม่จำเป็นต้องขอลบบัญชีทั้งหมด"
      ],
      [
        "ข้อมูลยืนยันและบันทึกระบบ",
        "OTP มีอายุใช้งาน 10 นาที ค่า hash และรายการที่หมดอายุถูกล้างตามการดำเนินงานของระบบ ไม่ใช่คำรับรองว่าข้อมูลทุกสำเนาหายไปทันทีที่ครบ 10 นาที บันทึกการใช้บริการ ความปลอดภัย ธุรกรรมและคำขอใช้สิทธิเก็บตามความจำเป็นของวัตถุประสงค์นั้น หากต้องเก็บต่อด้วยเหตุทางกฎหมาย ความปลอดภัยหรือข้อพิพาท จะจำกัดการใช้และแจ้งเหตุที่เกี่ยวข้องในการตอบคำขอ"
      ],
      [
        "สำรองข้อมูลและข้อจำกัด",
        "การลบจากระบบที่ใช้งานไม่หมายความว่าสำเนาสำรองทุกชุดถูกลบทันที สำเนาสำรองและบันทึกของผู้ให้บริการต้องดำเนินการตามการตั้งค่าและรอบเก็บรักษาของบริการนั้น ผู้ดูแลต้องตรวจขอบเขตและแจ้งข้อยกเว้นหรือระยะเก็บที่เกี่ยวข้องก่อนยืนยันผลคำขอ เราไม่รับรองรอบลบสำรองที่ยังไม่ได้ตรวจสอบ สำเนาที่ผู้รับภายนอกดาวน์โหลดไว้ไม่ถูกลบจากอุปกรณ์ของผู้นั้นโดยอัตโนมัติ"
      ]
    ]
  },
  {
    "id": "terms-of-use",
    "title": "รูปแบบบริการ โควต้า AI และการชำระเงิน",
    "subtitle": "Business policy / Terms of service",
    "sections": [
      [
        "รูปแบบธุรกิจและสิ่งที่จำหน่าย",
        "Panthorium คือบริการผู้ช่วย AI ผ่านเว็บไซต์และแอป สำหรับถามตอบ สรุปข้อมูล ช่วยร่างข้อความ และสั่งงานเครื่องมือที่เปิดใช้งาน โดยพิมพ์ข้อความหรือพูดผ่านไมโครโฟน แล้วรับคำตอบเป็นข้อความหรือเสียง ให้บริการซอฟต์แวร์ออนไลน์แบบสมาชิกและแพ็กโควต้าเพิ่มเติม สิ่งที่ลูกค้าซื้อคือสิทธิ์ใช้งานฟังก์ชันและโควต้าตามแพ็กเกจ ไม่ใช่การซื้อขายข้อมูลส่วนบุคคล"
      ],
      [
        "ความหมายของ “ข้อความเข้า/ออก” ในแพ็กเกจเดิม",
        "“ข้อความเข้า” หมายถึงคำถาม คำสั่ง และบริบทที่ส่งให้ AI ประมวลผล “ข้อความออก” หมายถึงคำตอบข้อความที่ AI สร้างกลับมา “เสียงเข้า” คือเสียงที่ผู้ใช้ส่งให้ AI และ “เสียงออก” คือเสียงคำตอบของ AI โควต้าเหล่านี้เกี่ยวกับการสนทนากับผู้ช่วย AI ไม่ใช่แพ็กเกจ SMS ค่าโทรศัพท์ หรือบริการส่งข้อความโฆษณา ภาพแพ็กเกจเดิมแสดงหน่วยแยกกัน ส่วนฉบับปัจจุบันใช้เครดิต AI จากยอดร่วม"
      ],
      [
        "ขั้นตอนที่ลูกค้าใช้บริการ",
        "เข้าเว็บไซต์ panthorium.net หรือแอป Panthorium Browser สมัครและเข้าสู่บัญชี เปิดผู้ช่วย AI แล้วพิมพ์คำถามหรือเปิดไมโครโฟนและอนุญาตการใช้งานเมื่อเลือกเสียง ระบบประมวลผลและแสดงคำตอบเป็นข้อความหรือเสียงตามฟังก์ชันที่เปิดใช้งาน เช่น ถามตอบ สรุปข้อมูล หรือช่วยร่างข้อความ เมื่อเลือกซื้อ ให้เปิดหน้าแพ็กเกจและชำระเงิน อ่านรายละเอียด ราคา อายุสิทธิ์ วิธีคิดโควต้าและเงื่อนไขคืนเงินก่อนยืนยัน"
      ],
      [
        "ราคาและการส่งมอบสิทธิ์",
        "Free ไม่มีค่าบริการ สมาชิก Life 189 บาท Work 489 บาท และ Work Pro 1,089 บาทต่อรอบ 1 เดือน ราคาสุทธิเป็นเงินบาทตามหน้าสรุปรายการ ผู้ให้บริการเป็นบุคคลธรรมดาที่ยังไม่จด VAT จึงไม่ออกใบกำกับภาษี VAT ช่องทางที่เปิดให้ใช้จะแสดงก่อนชำระ การชำระบนเว็บผ่าน Omise/PromptPay เปิดสิทธิ์เข้าบัญชีเมื่อเซิร์ฟเวอร์ตรวจยืนยันการชำระสำเร็จแล้วเท่านั้น ไม่ต้องรอจัดส่งสินค้า รายการ Test ไม่ตัดเงินจริงและไม่เพิ่มสิทธิ์จริง การซื้อในแอป Android ยังไม่เปิดให้บริการ"
      ],
      [
        "โควต้า AI ร่วมและอัตราการใช้",
        "ข้อความที่ส่งให้ AI 1 โทเคน = 1 เครดิต; คำตอบข้อความจาก AI 1 โทเคน = 5 เครดิต; เสียงที่ส่งให้ AI 1 วินาที = 100 เครดิต; เสียงคำตอบจาก AI 1 วินาที = 500 เครดิต ทุกประเภทหักจากยอดเครดิต AI เดียวกันตามบัญชี ใช้ได้ข้ามอุปกรณ์ พื้นที่เก็บไฟล์และปริมาณดาวน์โหลดเป็นสิทธิ์แยกจากเครดิต AI เครดิตเป็นหน่วยนับบริการภายในระบบ ไม่ใช่เงิน ไม่สามารถโอนให้บัญชีอื่นหรือแลกเป็นเงินสดได้"
      ],
      [
        "ตัวอย่างและขอบเขตการนับ",
        "ส่งข้อความ 1,000 โทเคนและรับคำตอบ 200 โทเคน ใช้ 2,000 เครดิต; ส่งเสียง 60 วินาทีและรับเสียงคำตอบ 60 วินาที ใช้ 36,000 เครดิต หากใช้ผสมให้นำเครดิตแต่ละส่วนมารวมกัน โทเคนไม่เท่ากับจำนวนคำหรือจำนวนข้อความตายตัว ข้อความบริบทและข้อความถอดเสียงที่ส่งให้ AI ประมวลผลอาจนับเพิ่มตามข้อมูลการใช้บริการ เสียงนับจากเวลาข้อมูลเสียงที่รับส่ง ปัดเศษสะสมเป็นวินาที ไม่คิดจากเวลาที่เปิดหน้าต่างค้างไว้ งานอัตโนมัติและการลองใหม่ที่เกิดการประมวลผลใช้ยอดเดียวกัน ระบบหยุดให้บริการส่วนที่ต้องใช้เครดิตเมื่อยอดไม่พอ ไม่มีการเรียกเก็บเงินเกินแพ็กอัตโนมัติ"
      ],
      [
        "วงเงิน ระยะเวลา และสิทธิ์เดิม",
        "โควต้าปกติ Free 100,000 เครดิตต่อเดือน Life 2,465,000 เครดิต Work 7,600,000 เครดิต และ Work Pro 17,400,000 เครดิตต่อรอบ สมาชิกใช้ได้ 1 เดือนนับจากชำระสำเร็จ โควต้า AI เสริมใช้ได้ 30 วัน ใช้สิทธิ์ที่ใกล้หมดอายุก่อน โควต้าหมดอายุไม่ทบยอด ไม่มีการต่ออายุหรือเติมเงินอัตโนมัติ สิทธิ์เสียงและข้อความเดิมที่ยังไม่หมดอายุแปลงส่วนคงเหลือทั้งหมดตามอัตราข้างต้นเป็นยอดร่วม โดยไม่รีเซ็ตยอดใช้ ไม่เปลี่ยนราคา และคงวันหมดอายุเดิม โปรโมชัน Free ใช้ Gemini Live ไม่จำกัดตั้งแต่ 18 ตุลาคมถึง 30 พฤศจิกายน 2026 เวลาไทย และกลับโควต้าปกติวันที่ 1 ธันวาคม 2026 การใช้ช่วงโปรโมชันไม่หักเครดิตแพ็กเสริม"
      ],
      [
        "การยกเลิกและขอคืนเงิน",
        "ไม่มีหักเงินต่ออายุอัตโนมัติ หากชำระซ้ำ ไม่ได้รับสิทธิ์ หรือบริการมีปัญหา ติดต่อ account@panthorium.net พร้อมเลขคำสั่งซื้อเพื่อขอยกเลิกหรือคืนเงิน ผู้ให้บริการตรวจสอบรายการและสิทธิ์ตามกฎหมายก่อนแจ้งผล ไม่จำกัดสิทธิ์ผู้บริโภคตามกฎหมาย หากยังไม่ชำระ สามารถออกจากหน้าชำระและปล่อย QR หมดอายุได้ หากไม่ต้องการต่ออายุ ให้ไม่สร้างรายการชำระรอบใหม่ สำหรับรายการที่ชำระแล้ว แจ้งเลขคำสั่งซื้อ เหตุผลและหลักฐานที่เกี่ยวข้องทางอีเมลโดยไม่ส่งรหัสผ่านหรือ OTP ระยะรับเงินคืนขึ้นกับช่องทางและผู้ให้บริการชำระเงิน การคืนเงินอาจเพิกถอนสิทธิ์ของรายการนั้น ไม่รับประกันการคืนเงินอัตโนมัติหรือระยะเวลาที่ยังไม่ได้ยืนยัน"
      ],
      [
        "การใช้งานและการเปลี่ยนเงื่อนไข",
        "ใช้บัญชีและบริการโดยชอบด้วยกฎหมาย ห้ามเข้าถึงข้อมูลผู้อื่น รบกวนระบบหรือละเมิดสิทธิในเนื้อหา บริการต้องใช้การเชื่อมต่ออินเทอร์เน็ตและอาจหยุดชั่วคราวเมื่อบำรุงรักษาหรือมีเหตุขัดข้อง การเปลี่ยนราคา อัตราเครดิต หรือเงื่อนไขสำคัญจะแจ้งก่อนมีผลกับรายการซื้อใหม่ ไม่ลดสิทธิ์รายการที่ซื้อแล้วโดยย้อนหลัง ติดต่อ account@panthorium.net เพื่อสอบถามหรือโต้แย้ง"
      ],
      [
        "Gemini Live และ Qwen 4B",
        "ระบบใช้ Gemini Live API ของ Google เป็นหลักสำหรับเสียง และอาจเลือก Qwen 4B สำหรับงานข้อความที่เหมาะสม คิดเครดิต AI เฉพาะการประมวลผลด้วย Gemini Live API ส่วน Qwen และการถอด/สร้างเสียงในเซิร์ฟเวอร์ไม่หักเครดิตผู้ใช้ เครดิต Gemini หมดแล้วใช้ Qwen ต่อได้ฟรีเมื่อทรัพยากรพร้อม หากเลือก Qwen โดยตรงจะไม่เปลี่ยนไปใช้บริการที่หักเครดิตโดยไม่แจ้ง"
      ],
      [
        "ข้อจำกัดบริการ Qwen ฟรี",
        "Qwen เป็นบริการเสริมเมื่อเครื่องพร้อม ระบบจำกัดงานพร้อมกันและตรวจ RAM/VRAM เพื่อรักษาระบบหลัก ตั้งเพดานทรัพยากร AI และพักหรือถอดโมเดลออกจากหน่วยความจำเมื่อเกินเกณฑ์ ทั้งนี้ไม่ใช่การรับประกันว่า RAM/VRAM รวมทั้งเครื่องซึ่งรวมระบบปฏิบัติการและโปรแกรมอื่นจะไม่เกิน 60% บริการอาจรอ เริ่มช้า ปฏิเสธงานชั่วคราว หรือถูกปิดเมื่อจำเป็น คำตอบและความสามารถอาจลดลง เสียง Qwen เป็นการถอดเสียง–ตอบข้อความ–สร้างเสียง สำหรับคำตอบสั้นเตรียมเสียงครบก่อนเล่น ส่วนคำตอบยาวแบ่งตามช่วงภาษาและเตรียมเสียงล่วงหน้า ความต่อเนื่องขึ้นกับเครื่องและเครือข่าย ไม่รับประกันเทียบเท่าเสียงสด"
      ]
    ]
  },
  {
    "id": "policy-archive",
    "title": "เวอร์ชันนโยบาย",
    "subtitle": "Policy versions",
    "sections": [
      [
        "ฉบับปัจจุบัน",
        "ฉบับ 3.7 วันที่ 5 พฤศจิกายน 2026 แยกเครดิต Gemini Live จาก Qwen ฟรี เพิ่มเส้นทางข้อมูลเสียงและข้อความ ขอบเขต API/MCP เงื่อนไขทรัพยากรและการปิด Qwen ราคา ยอดเครดิตเดิม และวันหมดอายุไม่เปลี่ยน ประวัติฉบับก่อนหน้าเก็บในระบบควบคุมเวอร์ชัน การประกาศนี้ไม่ใช่การให้ความยินยอมแทนผู้ใช้"
      ]
    ]
  },
  {
    "id": "notifications-updates",
    "title": "การแจ้งเตือน สถานะอ่านแล้ว และอัปเดต",
    "subtitle": "Notifications & Updates",
    "sections": [
      [
        "ช่องทางและทางเลือกของคุณ",
        "สำหรับบัญชีที่ยังไม่มีค่าบันทึก ช่องทาง ‘ในแอป’ ปิดเป็นค่าเริ่มต้นจนคุณเปิดเอง โดยคงค่าที่บัญชีเคยบันทึกไว้ ช่องทาง ‘บนอุปกรณ์’ ต้องเปิดรับและให้สิทธิ์ตามที่เบราว์เซอร์หรือระบบปฏิบัติการร้องขอ คุณเลือกประเภทเหตุการณ์ เสียง การอ่านด้วยเสียง และช่วงห้ามรบกวนได้ในตั้งค่าการแจ้งเตือน การปิดป๊อปอัปไม่ลบประวัติหรือสถานะยังไม่อ่าน และไม่ลบข้อมูลต้นทาง"
      ],
      [
        "ข้อมูลสำหรับการส่งและผู้รับข้อมูล",
        "Panthorium เก็บตัวระบุการลงทะเบียนอุปกรณ์ เช่น FCM token หรือที่อยู่ Web Push พร้อมกุญแจสำหรับเข้ารหัส Web Push ข้อมูลผูกอุปกรณ์กับบัญชี เวลาลงทะเบียนและหมดอายุ รวมทั้งรหัสแจ้งเตือน สถานะและจำนวนครั้งที่พยายามส่ง เพื่อส่งให้บัญชีและอุปกรณ์ที่ถูกต้อง Android ใช้ Google Firebase Cloud Messaging ซึ่งใช้ Firebase installation ID เพื่อกำหนดอุปกรณ์ปลายทาง ส่วนเว็บใช้บริการ Push ของเบราว์เซอร์ ผู้ให้บริการได้รับตัวระบุและข้อมูลที่จำเป็นต่อการส่ง และอาจประมวลผลในต่างประเทศ ดูรายละเอียดของ Firebase ได้ที่ https://firebase.google.com/support/privacy"
      ],
      [
        "เนื้อหาบนหน้าจอและข้อจำกัดการส่ง",
        "ข้อความที่ระบบส่งผ่านบริการ Push เบื้องหลังใช้ชื่อ Panthorium และข้อความทั่วไปให้เปิดแอปดูรายละเอียด พร้อมรหัสสำหรับจับคู่แจ้งเตือน ไม่แนบข้อความสนทนาหรือไฟล์ส่วนตัวในเนื้อหา Push นี้ การแสดงรายละเอียดขณะเปิดแอปเป็นไปตามตัวเลือกแสดงตัวอย่างและสิทธิ์เข้าถึง เสียงอ่านอาจได้ยินโดยคนใกล้เคียง การแสดงบนหน้าจอล็อกและแถบแจ้งเตือนขึ้นกับการตั้งค่าอุปกรณ์ เครือข่าย การประหยัดแบตเตอรี่ การบังคับหยุดแอป และโหมดห้ามรบกวนอาจทำให้ล่าช้าหรือไม่แสดง การตอบรับจากผู้ให้บริการส่งไม่ได้ยืนยันว่าผู้ใช้เห็นหรืออ่านแล้ว"
      ],
      [
        "ตัวเลขยังไม่อ่านและสถานะอ่านแล้ว",
        "ระบบเก็บสถานะและเวลาอ่านของกิจกรรมที่เกี่ยวข้องกับบัญชี เพื่อรวมตัวเลขที่หัวหมวดและแต่ละเมนู Social Media เมื่อคุณเปิดอ่านกิจกรรมที่แสดงอยู่จริงในหน้าต่างด้านหน้า หรือกดอ่านแล้ว ระบบยืนยันสถานะกับเซิร์ฟเวอร์ก่อนลดตัวเลข และซ่อนเมื่อเหลือศูนย์ รายการที่ซ่อนหรือยังไม่ปรากฏบนจอจะไม่ถูกทำเครื่องหมายว่าอ่านจากการเปิดเมนูเพียงอย่างเดียว สถานะนี้ซิงก์ระหว่างอุปกรณ์ของบัญชี การอ่านกิจกรรมแจ้งเตือนแยกจากการเปิดอ่านข้อความสนทนา ซึ่งอาจแสดงสถานะอ่านแล้วแก่คู่สนทนาหรือสมาชิกกลุ่มตามฟังก์ชัน"
      ],
      [
        "แจ้งเตือนอัปเดต",
        "เมื่อระบบตรวจพบเว็บหรือ Panthorium Browser รุ่นใหม่ จะใช้ข้อมูลแพลตฟอร์ม รุ่น และบัญชีเพื่อสร้างรายการแจ้งเตือนและป้องกันรายการซ้ำ คุณเปิดหรือปิดประเภท ‘มีอัปเดต Panthorium’ ได้ สถานะอัปเดตที่รอส่งอาจเก็บชั่วคราวใน sessionStorage เพื่อส่งใหม่เมื่อกลับมาออนไลน์หรือเข้าสู่ระบบ การปิดแจ้งเตือนอัปเดตไม่ใช่การปิดระบบอัปเดตซอฟต์แวร์"
      ],
      [
        "ระยะเก็บและการหยุดรับ",
        "ประวัติศูนย์แจ้งเตือนระบบแสดงย้อนหลังไม่เกิน 90 วัน และล้างรายการเก่าตามรอบทำงานเมื่อเข้าถึงประวัติ บันทึกความพยายามส่ง Push ที่เกิน 2 วันและทะเบียนอุปกรณ์ที่หมดอายุถูกล้างโดยงานประมวลผล Push ทะเบียนมีอายุ 90 วันและอาจต่ออายุเมื่ออุปกรณ์ที่เปิดรับกลับมาใช้งาน ระยะนี้ไม่ใช่ระยะลบเนื้อหา Social Media ไฟล์ หรือข้อมูลสำรอง การปิดรับเบื้องหลัง ออกจากระบบ หรือเปลี่ยนบัญชีจะเริ่มยกเลิกทะเบียนของอุปกรณ์นั้น หากออฟไลน์อาจต้องรอเชื่อมต่อหรือหมดอายุ คุณปิดสิทธิ์แจ้งเตือนที่ระบบปฏิบัติการได้ด้วย การหยุดรับไม่เรียกคืนข้อความที่ส่งถึงอุปกรณ์แล้ว และไม่รับรองว่าลบตัวระบุในระบบผู้ให้บริการภายนอกทันที ติดต่อ account@panthorium.net เพื่อขอลบข้อมูลหรือสอบถามระยะเก็บของผู้ให้บริการ"
      ]
    ]
  }
];
  initialPolicies.push({
    id: 'account-deletion', title: 'ขอลบบัญชีและข้อมูล', subtitle: 'Account Deletion Request',
    sections: [
      ['ยื่นคำขอจากบัญชีของคุณ', 'ลงชื่อเข้าใช้บัญชีที่ต้องการลบ แล้วส่งคำขอด้านล่าง ผู้ดูแลจะตรวจสอบตัวตน ขอบเขตข้อมูล และดำเนินการตามคำขอ การรับคำขอไม่ใช่การลบบัญชีหรือข้อมูลทันที'],
      ['ขอบเขตและข้อมูลที่อาจต้องเก็บต่อ', 'คำขอครอบคลุมบัญชีและข้อมูลที่เชื่อมโยง เช่น ไฟล์ ความจำ ประวัติ และโปรไฟล์เสียง ผู้ดูแลจะพิจารณาข้อมูลธุรกรรม หลักฐานตามกฎหมายหรือข้อพิพาท และแจ้งรายการที่ต้องเก็บต่อพร้อมเหตุผลตามนโยบาย ควรรับสำเนาข้อมูลสำคัญก่อนดำเนินการ'],
      ['ติดตามผลคำขอ', 'ตรวจสถานะและผลตอบกลับในหน้านี้ได้ ระบบนี้ส่งคำขอเข้าคิวผู้ดูแล ยังไม่มีการลบข้อมูลอัตโนมัติ และสถานะรับคำขอไม่หมายความว่าบัญชีถูกลบแล้ว']
    ]
  });
  initialPolicies.push({
    id: 'ai-report', title: 'รายงานคำตอบ AI', subtitle: 'Report AI Output',
    sections: [['แจ้งคำตอบที่มีปัญหา', 'รายงานคำตอบที่ไม่ถูกต้อง เป็นอันตราย หรือกระทบความเป็นส่วนตัวได้จากหน้านี้ รวมถึงคำตอบเสียง ระบบจะส่งเรื่องเข้าคิวผู้ดูแลเพื่อพิจารณา การรับรายงานไม่ใช่การยืนยันว่าได้ตรวจหรือแก้ผลลัพธ์แล้ว']]
  });
  const currentUser = () => typeof OS !== 'undefined' ? OS.state?.user : null;
  const accountId = () => String(currentUser()?.sub || currentUser()?.id || '');
  const signedIn = () => !!accountId() && !/^guest[:_-]/i.test(accountId()) && !(currentUser()?.roles || []).includes('guest');
  const authIdentity = () => JSON.stringify([accountId(), [...(currentUser()?.roles || [])].sort()]);
  let lastAuthIdentity = authIdentity();

  async function requestApi(method, body, resource = 'account-deletion') {
    const owner = accountId();
    if (!signedIn()) throw new Error('authentication_required');
    const valid = () => signedIn() && accountId() === owner;
    const send = () => {
      if (!valid()) throw new Error('account_changed');
      const backend = typeof OS !== 'undefined' ? OS.config?.backendUrl || '' : '';
      const token = typeof OS !== 'undefined' ? OS.config?.accessToken || '' : '';
      return fetch(backend.replace(/\/$/, '') + '/api/privacy/' + resource, {
        method, credentials: 'include', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    };
    let response = await send();
    if (response.status === 401 && valid() && window.PanthoriumAuth?.refreshSession) {
      if (await window.PanthoriumAuth.refreshSession().catch(() => false)) response = await send();
    }
    const data = await response.json().catch(() => ({}));
    if (!valid()) throw new Error('account_changed');
    if (!response.ok || data.ok === false) throw new Error(data.error || 'request_unavailable');
    return data;
  }

  function renderReportForm(root, content, target) {
    const panel = document.createElement('section'); panel.className = 'pp-section'; panel.dataset.aiReport = ''; content.appendChild(panel);
    appendText(panel, 'h3', 'ส่งรายงานให้ผู้ดูแล');
    const status = appendText(panel, 'p', ''); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.dataset.reportStatus = '';
    if (!signedIn()) {
      status.textContent = 'ลงชื่อเข้าใช้เพื่อส่งรายงานคำตอบ AI';
      const login = appendText(panel, 'button', 'เข้าสู่ระบบเพื่อรายงาน'); login.type = 'button'; login.onclick = () => window.PanthoriumAccounts?.openLogin?.(); return;
    }
    const owner = accountId();
    const source = target?.sourceType === 'cloud_app_run' && typeof target.sourceId === 'string' && target.sourceId ? { sourceType: 'cloud_app_run', sourceId: target.sourceId } : { sourceType: 'general' };
    const valid = () => root.isConnected && panel.isConnected && signedIn() && accountId() === owner;
    appendText(panel, 'p', source.sourceId ? 'รายงานผลลัพธ์ Cloud Apps เลขอ้างอิง ' + source.sourceId : 'รายงานคำตอบทั่วไปหรือคำตอบเสียง • ระบุข้อความหรือช่วงเวลาที่เกิดปัญหา');
    const form = document.createElement('form'); form.dataset.reportForm = ''; form.style.cssText = 'display:grid;gap:10px;margin-top:12px';
    const label = appendText(form, 'label', 'ประเภทปัญหา'); label.style.cssText = 'display:grid;gap:5px';
    const category = document.createElement('select'); category.dataset.reportCategory = ''; category.style.cssText = 'padding:10px;font:inherit';
    for (const [id, text] of [['inaccurate', 'ข้อมูลไม่ถูกต้อง'], ['harmful', 'เนื้อหาที่เป็นอันตราย'], ['privacy', 'ความเป็นส่วนตัว'], ['other', 'ปัญหาอื่น']]) { const option = appendText(category, 'option', text); option.value = id; }
    label.appendChild(category);
    const detailLabel = appendText(form, 'label', source.sourceId ? 'รายละเอียดเพิ่มเติม (ไม่บังคับ)' : 'รายละเอียดคำตอบที่ต้องการรายงาน'); detailLabel.style.cssText = 'display:grid;gap:5px';
    const details = appendText(detailLabel, 'textarea', ''); details.dataset.reportDetails = ''; details.rows = 4; details.maxLength = 2000; details.required = source.sourceType === 'general'; details.style.cssText = 'padding:10px;font:inherit;resize:vertical';
    appendText(form, 'small', 'ไม่ใส่รหัสผ่าน รหัส OTP หรือข้อมูลส่วนตัวที่ไม่จำเป็น รายงานนี้ส่งเข้าคิวภายในของผู้ดูแล Panthorium');
    const submit = appendText(form, 'button', 'ส่งรายงาน'); submit.type = 'submit'; submit.dataset.reportSubmit = ''; submit.style.cssText = 'justify-self:start;padding:10px 14px'; panel.appendChild(form);
    form.onsubmit = async event => {
      event.preventDefault(); if (!valid() || submit.disabled) return;
      if (source.sourceType === 'general' && !details.value.trim()) { status.textContent = 'กรอกรายละเอียดคำตอบที่มีปัญหาก่อนส่ง'; return; }
      submit.disabled = true; status.textContent = 'กำลังส่งรายงาน…';
      try {
        const data = await requestApi('POST', { ...source, category: category.value, details: details.value.trim() }, 'reports');
        if (!valid()) return; status.textContent = 'รับรายงานเข้าคิวผู้ดูแลแล้ว • เลขอ้างอิง ' + String(data.request?.id || '') + ' • ยังไม่ใช่ผลการตรวจสอบ';
        form.hidden = true; form.style.display = 'none';
      } catch (_) { if (valid()) status.textContent = 'ยังไม่ได้รับการยืนยันว่ารับรายงาน • ตรวจการเชื่อมต่อก่อนส่งอีกครั้ง'; }
      finally { if (valid()) submit.disabled = false; }
    };
  }

  function renderDeletionRequest(root, content) {
    const panel = document.createElement('section'); panel.className = 'pp-section'; panel.dataset.deletionRequest = '';
    content.appendChild(panel);
    appendText(panel, 'h3', 'คำขอลบบัญชีของฉัน');
    const status = appendText(panel, 'p', '', 'pp-request-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    if (!signedIn()) {
      status.textContent = 'ลงชื่อเข้าใช้บัญชีที่ต้องการลบเพื่อส่งและติดตามคำขอ';
      const login = appendText(panel, 'button', 'เข้าสู่ระบบเพื่อยื่นคำขอ'); login.type = 'button'; login.dataset.deletionLogin = '';
      login.onclick = () => window.PanthoriumAccounts?.openLogin?.();
      return;
    }
    const owner = accountId();
    const valid = () => root.isConnected && panel.isConnected && root.dataset.selectedPolicy === 'account-deletion' && signedIn() && accountId() === owner;
    const receipt = appendText(panel, 'div', ''); receipt.dataset.deletionReceipt = '';
    const form = document.createElement('form'); form.dataset.deletionForm = ''; form.style.cssText = 'display:grid;gap:10px;margin-top:15px';
    const reasonLabel = appendText(form, 'label', 'เหตุผลหรือรายละเอียดเพิ่มเติม (ไม่บังคับ)'); reasonLabel.style.cssText = 'display:grid;gap:5px';
    const reason = appendText(reasonLabel, 'textarea', ''); reason.rows = 3; reason.maxLength = 500; reason.dataset.deletionReason = ''; reason.setAttribute('aria-label', 'รายละเอียดคำขอลบบัญชี'); reason.style.cssText = 'padding:10px;resize:vertical;font:inherit';
    appendText(form, 'small', 'ไม่ต้องใส่รหัสผ่าน รหัส OTP หรือข้อมูลส่วนตัวที่ไม่จำเป็น');
    const acknowledgement = document.createElement('label'); acknowledgement.style.cssText = 'display:flex;gap:8px;align-items:flex-start';
    const check = document.createElement('input'); check.type = 'checkbox'; check.required = true; check.dataset.deletionAcknowledge = '';
    acknowledgement.appendChild(check); appendText(acknowledgement, 'span', 'ฉันขอให้ผู้ดูแลลบบัญชีและข้อมูลที่เกี่ยวข้อง และเข้าใจว่าต้องรอตรวจสอบและดำเนินการก่อน ไม่ได้ลบทันที');
    form.appendChild(acknowledgement);
    const submit = appendText(form, 'button', 'ส่งคำขอลบบัญชีและข้อมูล'); submit.type = 'submit'; submit.style.cssText = 'justify-self:start;padding:10px 14px'; submit.dataset.deletionSubmit = '';
    panel.appendChild(form);
    const refresh = appendText(panel, 'button', 'ตรวจสถานะคำขอ'); refresh.type = 'button'; refresh.dataset.deletionRefresh = ''; refresh.style.cssText = 'margin-top:12px;padding:8px 12px';
    const renderRequest = request => {
      receipt.replaceChildren();
      if (!request) { form.hidden = false; form.style.display = 'grid'; status.textContent = 'ยังไม่มีคำขอลบบัญชี'; return; }
      const labels = { requested: 'รับคำขอแล้ว • รอผู้ดูแลตรวจสอบ', manual_processing: 'ผู้ดูแลกำลังดำเนินการตามคำขอ', completed: 'ผู้ดูแลปิดคำขอแล้ว • โปรดอ่านผลการดำเนินการ' };
      status.textContent = labels[request.status] || 'คำขออยู่ระหว่างตรวจสอบสถานะ';
      appendText(receipt, 'p', 'เลขอ้างอิง: ' + String(request.id || ''));
      const created = new Date(request.createdAt);
      if (Number.isFinite(created.getTime())) appendText(receipt, 'p', 'ส่งเมื่อ: ' + created.toLocaleString('th-TH'));
      if (request.resolution) appendText(receipt, 'p', String(request.resolution));
      appendText(receipt, 'p', 'การรับหรือปิดคำขอเพียงอย่างเดียวไม่ยืนยันว่าลบข้อมูลทุกประเภทแล้ว ให้ตรวจผลและข้อยกเว้นที่ผู้ดูแลแจ้ง');
      form.hidden = request.status === 'requested' || request.status === 'manual_processing';
      form.style.display = form.hidden ? 'none' : 'grid';
    };
    async function load() {
      status.textContent = 'กำลังตรวจสถานะบน Cloud…'; refresh.disabled = true;
      try { const data = await requestApi('GET'); if (valid()) renderRequest(data.request); }
      catch (_) { if (valid()) status.textContent = 'โหลดสถานะไม่ได้ • ตรวจการเชื่อมต่อแล้วกดตรวจสถานะอีกครั้ง'; }
      finally { if (valid()) refresh.disabled = false; }
    }
    refresh.onclick = load;
    form.onsubmit = async event => {
      event.preventDefault(); if (!valid() || submit.disabled || !check.checked) return;
      submit.disabled = true; status.textContent = 'กำลังส่งคำขอให้ผู้ดูแล…';
      try {
        const data = await requestApi('POST', { confirmation: 'DELETE_REQUEST', reason: reason.value.trim() });
        if (!valid()) return; renderRequest(data.request); reason.value = ''; check.checked = false;
      } catch (_) { if (valid()) status.textContent = 'ยังไม่ได้รับการยืนยันว่ารับคำขอ • ตรวจสถานะก่อนส่งอีกครั้ง'; }
      finally { if (valid()) submit.disabled = false; }
    };
    load();
  }

  function cleanPolicy(value) {
    if (!value || typeof value !== 'object' || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(String(value.id || '')) || !String(value.title || '').trim()) return null;
    const sections = Array.isArray(value.sections) ? value.sections.map(section => {
      if (Array.isArray(section)) return [String(section[0] || ''), String(section[1] || '')];
      return [String(section?.title || ''), String(section?.body || '')];
    }).filter(section => section[0] && section[1]) : [];
    if (!sections.length) return null;
    return { id: String(value.id), title: String(value.title).trim(), subtitle: String(value.subtitle || '').trim(), sections };
  }
  initialPolicies.forEach(policy => policies.set(policy.id, cleanPolicy(policy)));
  (window.PanthoriumPrivacyNotice?.policies || []).forEach(policy => policies.set(policy.id, cleanPolicy(policy)));

  function list() { return Array.from(policies.values(), policy => JSON.parse(JSON.stringify(policy))); }
  function register(policy) {
    const clean = cleanPolicy(policy);
    if (!clean) return false;
    policies.set(clean.id, clean);
    window.dispatchEvent(new CustomEvent('panthorium:policy-registry-changed'));
    return true;
  }
  function appendText(parent, tag, text, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text;
    parent.appendChild(el);
    return el;
  }
  function renderArticle(root, id, reportContext) {
    const policy = policies.get(id) || policies.values().next().value;
    if (!policy) return;
    root.dataset.selectedPolicy = policy.id;
    const nav = root.querySelector('[data-policy-nav]');
    const content = root.querySelector('[data-policy-content]');
    if (!nav || !content) return;
    nav.replaceChildren();
    content.replaceChildren();
    policies.forEach(entry => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.policyId = entry.id;
      button.className = entry.id === policy.id ? 'pp-nav-item active' : 'pp-nav-item';
      appendText(button, 'strong', entry.title);
      if (entry.subtitle) appendText(button, 'small', entry.subtitle);
      button.addEventListener('click', () => renderArticle(root, entry.id));
      nav.appendChild(button);
    });
    appendText(content, 'h2', policy.title, 'pp-title');
    if (policy.subtitle) appendText(content, 'p', policy.subtitle, 'pp-subtitle');
    policy.sections.forEach(([title, body]) => {
      const section = document.createElement('section');
      section.className = 'pp-section';
      appendText(section, 'h3', title);
      appendText(section, 'p', body);
      content.appendChild(section);
    });
    if (['privacy-notice', 'account-deletion'].includes(policy.id)) {
      const link = appendText(content, 'a', policy.id === 'account-deletion' ? 'เปิดหน้าขอลบบัญชีสาธารณะ / ติดต่อทางอีเมล' : 'เปิดนโยบายฉบับสาธารณะ');
      link.href = policy.id === 'account-deletion' ? '/account-deletion' : '/privacy';
      link.target = '_blank'; link.rel = 'noopener';
    }
    if (policy.id === 'account-deletion') renderDeletionRequest(root, content);
    if (policy.id === 'ai-report') renderReportForm(root, content, reportContext);
  }
  function createWindow(selectedPolicy, reportContext) {
    const root = document.createElement('section');
    root.id = 'panthorium-privacy-policy';
    root.tabIndex = -1;
    root.style.cssText = 'position:fixed;inset:0;z-index:10030;background:#10161d;color:#e7edf4;border:1px solid #33404a;border-radius:0;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;font:14px/1.55 system-ui,sans-serif';
    root.innerHTML = `
      <style>
        #panthorium-privacy-policy *{box-sizing:border-box}#panthorium-privacy-policy [hidden]{display:none!important}#panthorium-privacy-policy button{font:inherit;color:inherit;touch-action:manipulation}
        #panthorium-privacy-policy header{min-height:66px;padding:env(safe-area-inset-top,0px) max(16px,env(safe-area-inset-right,0px)) 10px max(16px,env(safe-area-inset-left,0px));display:flex;align-items:center;gap:12px;background:#1c242b;border-bottom:1px solid #34404a}
        #panthorium-privacy-policy .pp-brand{min-width:0;flex:1}#panthorium-privacy-policy .pp-brand h1{margin:0;font-size:18px;line-height:1.2}#panthorium-privacy-policy .pp-brand p{margin:4px 0 0;color:#9eacb7;font-size:12px}
        #panthorium-privacy-policy [data-close],#panthorium-privacy-policy [data-minimize]{min-width:40px;min-height:40px;border:1px solid #46535e;border-radius:8px;background:#252e36;cursor:pointer}
        #panthorium-privacy-policy .pp-workspace{display:grid;grid-template-columns:minmax(210px,290px) minmax(0,1fr);flex:1;min-height:0}
        #panthorium-privacy-policy [data-policy-nav]{overflow:auto;padding:12px;background:#151c23;border-right:1px solid #303b45;overscroll-behavior:contain}
        #panthorium-privacy-policy .pp-nav-item{width:100%;display:flex;flex-direction:column;align-items:flex-start;gap:3px;margin:0 0 6px;padding:11px;border:1px solid transparent;border-radius:8px;background:transparent;text-align:left;cursor:pointer}
        #panthorium-privacy-policy .pp-nav-item:hover,#panthorium-privacy-policy .pp-nav-item.active{background:#202c34;border-color:#2f746e;color:#8fe6d8}#panthorium-privacy-policy .pp-nav-item small{color:#9caab5;font-size:11px}
        #panthorium-privacy-policy [data-policy-content]{min-width:0;overflow:auto;padding:clamp(18px,4vw,42px);overscroll-behavior:contain}
        #panthorium-privacy-policy .pp-title{margin:0;font-size:clamp(22px,3vw,32px);line-height:1.2}#panthorium-privacy-policy .pp-subtitle{margin:8px 0 26px;color:#9eb0bc}
        #panthorium-privacy-policy .pp-section{max-width:920px;margin:0 0 18px;padding:18px;border:1px solid #2d3943;border-radius:10px;background:#171f26}
        #panthorium-privacy-policy .pp-section h3{margin:0 0 8px;color:#8fe6d8;font-size:15px}#panthorium-privacy-policy .pp-section p{margin:0;color:#c4cdd4;white-space:pre-wrap;line-height:1.7}
        #panthorium-privacy-policy.panthorium-window-fullscreen{padding:0!important}html[data-panthorium-immersive="true"] #panthorium-privacy-policy header{padding-top:8px}
        @media(max-width:700px){#panthorium-privacy-policy .pp-workspace{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(130px,28dvh) minmax(0,1fr)}#panthorium-privacy-policy [data-policy-nav]{border-right:0;border-bottom:1px solid #303b45;display:flex;gap:7px;overflow:auto;padding:8px}#panthorium-privacy-policy .pp-nav-item{width:190px;min-width:190px;align-self:stretch;margin:0;padding:8px}#panthorium-privacy-policy [data-policy-content]{padding:16px}#panthorium-privacy-policy .pp-section{padding:13px}}
        @media(max-width:700px) and (orientation:landscape){#panthorium-privacy-policy .pp-workspace{grid-template-columns:minmax(175px,32vw) minmax(0,1fr);grid-template-rows:minmax(0,1fr)}#panthorium-privacy-policy [data-policy-nav]{display:block;border-right:1px solid #303b45;border-bottom:0}#panthorium-privacy-policy .pp-nav-item{width:100%;min-width:0;min-height:54px;margin-bottom:5px}}
        @media(min-width:701px) and (orientation:portrait){#panthorium-privacy-policy .pp-workspace{grid-template-columns:minmax(190px,30vw) minmax(0,1fr)}}
      </style>
      <header><div class="pp-brand"><h1>🔐 Privacy/Policy</h1><p>ศูนย์รวมนโยบายและข้อกำหนดของ Panthorium</p></div><div class="pp-window-tools"><button type="button" data-close aria-label="ปิด Privacy/Policy" title="ปิด">✕</button></div></header>
      <div class="pp-workspace"><nav data-policy-nav aria-label="หัวข้อ Privacy/Policy"></nav><main data-policy-content tabindex="0"></main></div>`;
    root.querySelector('[data-close]').addEventListener('click', () => {
      if (window.PanthoriumWindowManager?.close?.(APP_ID)) return;
      root.remove();
    });
    renderArticle(root, selectedPolicy || root.dataset.selectedPolicy || policies.keys().next().value, reportContext);
    document.body.appendChild(root);
    window.PanthoriumWindowManager?.registerExternal?.(APP_ID, 'Privacy/Policy', root, { menuAppId: APP_ID });
    return root;
  }
  function open(selectedPolicy, reportContext) {
    const existing = window.PanthoriumWindowManager?.findByAppId?.(APP_ID)?.el || document.getElementById('panthorium-privacy-policy');
    if (existing) {
      if (window.PanthoriumWindowManager?.restore) window.PanthoriumWindowManager.restore(APP_ID);
      else existing.style.display = 'flex';
      renderArticle(existing, selectedPolicy || existing.dataset.selectedPolicy, reportContext);
      existing.focus?.();
      return existing;
    }
    return createWindow(selectedPolicy, reportContext);
  }

  const openDeletionRequest = () => open('account-deletion');
  const openAIReport = target => open('ai-report', target);
  window.PanthoriumPrivacyPolicy = Object.freeze({ open, list, register, openDeletionRequest, openAIReport });
  window.PanthoriumStartMenuUI?.pinLast?.(APP_ID);
  window.addEventListener('panthorium:policy-registry-changed', () => {
    const root = document.getElementById('panthorium-privacy-policy');
    if (root) renderArticle(root, root.dataset.selectedPolicy);
  });
  window.addEventListener('panthorium:auth-changed', () => {
    const next = authIdentity(); if (next === lastAuthIdentity) return; lastAuthIdentity = next;
    const root = document.getElementById('panthorium-privacy-policy');
    if (['account-deletion', 'ai-report'].includes(root?.dataset.selectedPolicy)) renderArticle(root, root.dataset.selectedPolicy);
  });
  let routeOpened = false;
  function openRequestedRoute() {
    if (routeOpened) return;
    if (/^\/account-deletion\/?$/.test(window.location.pathname) || new URLSearchParams(window.location.search).get('privacy') === 'account-deletion') {
      routeOpened = true; openDeletionRequest();
    }
  }
  window.addEventListener('panthorium:boot-complete', openRequestedRoute);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', openRequestedRoute, { once: true }); else openRequestedRoute();
})();
