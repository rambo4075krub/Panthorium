'use strict';
const express = require('express');
const notice = require('../privacy-notice');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function renderPrivacyPage(deletion = false) {
  const entries = deletion ? notice.policies.filter(p => ['account-deletion','retention-choices'].includes(p.id)) : notice.policies;
  const title = deletion ? 'ขอลบบัญชีและข้อมูล — Panthorium Browser' : 'นโยบายความเป็นส่วนตัว — Panthorium Browser';
  const mail = 'mailto:' + notice.contact + '?subject=' + encodeURIComponent('ขอลบบัญชี Panthorium Browser');
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title><meta name="description" content="นโยบายข้อมูลและช่องทางขอลบบัญชี Panthorium Browser"><style>
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0b1421;color:#edf5ff;font:17px/1.8 system-ui,sans-serif}main{max-width:900px;margin:auto;padding:28px 22px 60px}h1{font-size:clamp(24px,5vw,36px);line-height:1.4}h2{font-size:24px}h3{font-size:19px}a{color:#91e8ff;overflow-wrap:anywhere}a:focus-visible{outline:3px solid #ff9a45;outline-offset:4px}nav{display:flex;gap:18px;flex-wrap:wrap}section{border-top:1px solid #39516b;margin-top:32px;padding-top:15px}p{overflow-wrap:anywhere}small{color:#bdcddd}.action{display:inline-block;padding:10px 16px;background:#173b51;border:1px solid #91e8ff;border-radius:8px;margin:8px 12px 8px 0}footer{border-top:1px solid #39516b;margin-top:40px;padding-top:20px}
  </style></head><body><main><nav aria-label="นโยบาย"><a href="/privacy">นโยบายความเป็นส่วนตัว</a><a href="/account-deletion">ขอลบบัญชีและข้อมูล</a><a href="/">กลับ Panthorium</a></nav><h1>${escape(title)}</h1><p>ผู้ให้บริการ: ปานเทพ มีเหมือน · Panthorium</p><p>ติดต่อ: <a href="mailto:${escape(notice.contact)}">${escape(notice.contact)}</a></p><small>ฉบับ ${escape(notice.version)} · ปรับปรุง ${escape(notice.updated)}</small>
  ${deletion ? `<p>ขอลบบัญชีได้โดยไม่ต้องติดตั้งแอปหรือลงชื่อเข้าใช้หน้านี้</p><a class="action" href="${escape(mail)}">ส่งอีเมลขอลบบัญชี</a><a class="action" href="/?privacy=account-deletion">ยื่นคำขอและติดตามในบัญชี</a><p>หากปุ่มอีเมลไม่เปิด ให้ส่งถึง ${escape(notice.contact)} ด้วยตนเอง หัวข้อ “ขอลบบัญชี Panthorium Browser”</p>` : `<p>อ่านหน้านี้ได้โดยไม่ต้องเข้าสู่ระบบหรืออนุญาตไมโครโฟน</p>`}
  ${entries.map(p => `<section id="${escape(p.id)}"><h2>${escape(p.title)}</h2>${p.sections.map(([heading,body]) => `<h3>${escape(heading)}</h3><p>${escape(body)}</p>`).join('')}</section>`).join('')}
  <footer><a href="/account-deletion">ขอลบบัญชีและข้อมูล</a> · <a href="mailto:${escape(notice.contact)}">ติดต่อเรื่องความเป็นส่วนตัว</a></footer></main></body></html>`;
}
function createPublicPrivacyRouter() {
  const router = express.Router();
  for (const [paths,deletion] of [[['/privacy','/privacy/'],false],[['/account-deletion','/account-deletion/'],true]]) {
    router.get(paths,(req,res) => {
      res.set('Cache-Control','no-store');
      res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
      res.type('html').send(renderPrivacyPage(deletion));
    });
  }
  return router;
}
module.exports = { createPublicPrivacyRouter, renderPrivacyPage };
