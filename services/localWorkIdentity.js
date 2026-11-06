'use strict';
const {createHash}=require('node:crypto');
// Only call with the authenticated account; never forward a browser-supplied header.
function accountKey(userId) {
  return createHash('sha256').update(String(userId||'internal-local')).digest('hex');
}
module.exports={accountKey};
