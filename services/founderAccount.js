'use strict';
const {createHash}=require('node:crypto');
// Bound to the founder account's immutable identifier, never its editable name or role.
const fingerprint='e17560343d221ddf40d36bc2ffb3c861a2026c2ac0188b28ced500dc0ab4686e';
function isFounderAccount(id){const value=String(id||'').trim().toLowerCase();return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)&&createHash('sha256').update(value).digest('hex')===fingerprint;}
function assertDeletable(id){if(isFounderAccount(id)){const error=new Error('founder_account_protected');error.status=403;throw error;}}
module.exports={isFounderAccount,assertDeletable};
