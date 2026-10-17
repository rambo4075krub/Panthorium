'use strict';
const assert = require('node:assert/strict');
const { renderPrivacyPage } = require('../routes/publicPrivacy');
async function main() {
  const base = String(process.env.PRIVACY_SMOKE_URL || '').replace(/\/$/,'');
  const url = new URL(base); assert.equal(url.protocol,'https:','deployed privacy checks require HTTPS');
  for (const [route,deletion] of [['/privacy',false],['/account-deletion',true]]) {
    const res = await fetch(base+route,{redirect:'error',signal:AbortSignal.timeout(20000)});
    assert.equal(res.status,200,route+' must be public');
    assert.match(res.headers.get('content-type'),/text\/html/);
    assert.equal(res.headers.get('set-cookie'),null,'policy must not create a session');
    assert.equal(await res.text(),renderPrivacyPage(deletion),'deployed notice must match tested release');
    console.log(route+' public HTML matches release');
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
