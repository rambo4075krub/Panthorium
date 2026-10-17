'use strict';
const assert = require('node:assert/strict');
const express = require('express');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const { createPublicPrivacyRouter } = require('../routes/publicPrivacy');
const notice = require('../privacy-notice');
async function main() {
  const app = express(); app.use(createPublicPrivacyRouter());
  const server = app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    for (const route of ['/privacy','/privacy/','/account-deletion','/account-deletion/']) {
      const res = await fetch(base+route); assert.equal(res.status,200);
      assert.match(res.headers.get('content-type'),/text\/html/); assert.equal(res.headers.get('set-cookie'),null);
      assert.equal(res.headers.get('cache-control'),'no-store');
      const html = await res.text(); const dom = new JSDOM(html); const doc=dom.window.document;
      assert.equal(doc.documentElement.lang,'th'); assert.equal(doc.querySelector('script'),null,'public notices cannot start auth, audio or AI sessions');
      assert.match(doc.title,/Panthorium Browser/);
      if (route.startsWith('/privacy')) {
        for(const policy of notice.policies) for(const [,body] of policy.sections) assert(doc.body.textContent.includes(body));
      } else {
        assert(doc.querySelector('a[href^="mailto:account@panthorium.net?subject="]'),'external deletion request without login');
        assert(doc.querySelector('a[href="/?privacy=account-deletion"]'),'existing authenticated request form remains reachable');
        assert.match(doc.body.textContent,/ไม่ต้องติดตั้งแอป/);
      }
      dom.window.close();
    }
    const dom = new JSDOM('<body></body>',{url:base,runScripts:'outside-only'});
    dom.window.eval(fs.readFileSync(require.resolve('../privacy-notice'),'utf8'));
    dom.window.eval(fs.readFileSync(require.resolve('../privacy-policy-ui'),'utf8'));
    for(const policy of notice.policies) {
      const root = dom.window.PanthoriumPrivacyPolicy.open(policy.id);
      for(const [,body] of policy.sections) assert(root.textContent.includes(body),'same policy in app and public page');
    }
    dom.window.close();
    console.log('Public privacy: anonymous HTML, no session/voice scripts, external deletion, shared in-app content passed');
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
