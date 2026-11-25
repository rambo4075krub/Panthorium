"use strict";
const catalog = require("../billing-catalog");

const objectives = Object.freeze({
  discovery: "แนะนำ Panthorium ให้ผู้ใช้ใหม่",
  activation: "ชวนลองใช้ฟีเจอร์ครั้งแรก",
  retention: "ชวนกลับมาใช้ Panthorium",
});
const topics = Object.freeze({
  discovery: "รู้จักแพ็กเกจของ Panthorium",
  activation: "เริ่มใช้ผู้ช่วย AI ใน Panthorium",
  retention: "กลับมาใช้ผู้ช่วยของคุณ",
});
function choices(now = Date.now()) {
  const plans = catalog.products.filter(p => p.category === "membership" && !p.purchasePaused);
  const items = plans.map(p => ({id:p.id, name:p.name, terms:p.term, amountSatang:p.amountSatang}));
  items.push({id:"guided-setup",name:"นัดแนะนำการตั้งค่า Panthorium กับแอดมิน",
    terms:"ส่งคำขอนัดผ่านห้อง Panthorium แอดมินจะยืนยันเวลาทางแชต",amountSatang:0});
  const promo = catalog.promotionAt(now);
  if (promo) items.push({id:promo.id, name:"โปรโมชัน Sentinel AI สำหรับแพ็กเกจ Free",
    terms:catalog.displayDetails(catalog.get("free"), now).slice(-1)[0], endsAt:promo.endsAt, amountSatang:0});
  return items;
}
function offer(productId, objective, now = Date.now()) {
  const product = choices(now).find(p => p.id === productId);
  if (!product || !Object.hasOwn(objectives, objective)) return null;
  if (productId==="guided-setup") return {...product, title:product.name, text:product.terms, action:"contact"};
  const price = (product.amountSatang / 100).toLocaleString("th-TH");
  return { ...product, title:product.endsAt ? product.name : topics[objective] + " · " + product.name,
    text:product.endsAt ? "แพ็กเกจ Free ใช้โควต้า Sentinel AI ไม่จำกัดทั้งเสียงและข้อความในช่วงโปรโมชัน · " + product.terms :
      product.name + " · " + price + " บาท · " + product.terms };
}
function botAnswer(topic, now = Date.now()) {
  if (topic === "plans") return "แพ็กเกจสมาชิกปัจจุบัน\n" + choices(now).filter(p => catalog.get(p.id))
    .map(p => p.name + " · " + (p.amountSatang / 100).toLocaleString("th-TH") + " บาท · " + p.terms).join("\n");
  if (topic === "promotion") {
    const promo = catalog.promotionAt(now);
    return promo ? offer(promo.id, "activation", now).text : "ขณะนี้ไม่มีโปรโมชันโควต้า Free ในแค็ตตาล็อก";
  }
  if (topic === "help") return "พิมพ์ข้อความในห้องนี้เพื่อคุยกับแอดมิน Panthorium โดยตรง คุณสามารถแนบภาพประกอบเมื่อแจ้งปัญหาได้";
  throw Object.assign(Error("invalid_support_topic"), {status:400});
}
function questionTopic(text) {
  if (typeof text !== "string" || text.trim().length>100) return null;
  if (/(?:ขอ|อยาก|ต้องการ)?(?:คุย|ติดต่อ|สอบถาม)(?:กับ)?แอดมิน|เจ้าหน้าที่/.test(text)) return "staff";
  if (/^(?:สวัสดี(?:ครับ|ค่ะ|คะ)?[ ,]*)?(?:ตอนนี้|ขอทราบ|สอบถาม|มี)?(?:โปรโมชั[น่]+|โปรโมชั่น|โปรอะไร|โปรไหม|มีโปร)/u.test(text.trim())) return "promotion";
  if (/^(?:ขอทราบ|สอบถาม|อยากทราบ)?(?:ราคาแพ[็กค]+เกจ|แพ[็กค]+เกจ(?:ราคา|มี|อะไร|เท่าไหร่)|ค่าแพ[็กค]+เกจ)/u.test(text.trim())) return "plans";
  return null;
}
module.exports = { objectives, choices, offer, botAnswer, questionTopic };
