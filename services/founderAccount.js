'use strict';
const {createHash}=require('node:crypto');
// Bound to the founder account's immutable identifier, never its editable name or role.
const fingerprint='e17560343d221ddf40d36bc2ffb3c861a2026c2ac0188b28ced500dc0ab4686e';
function isFounderAccount(id){const compact=String(id||'').trim().toLowerCase().replace(/[{}-]/g,'');if(!/^[0-9a-f]{32}$/.test(compact))return false;const value=compact.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');return createHash('sha256').update(value).digest('hex')===fingerprint;}
function assertDeletable(id){if(isFounderAccount(id)){const error=new Error('founder_account_protected');error.status=403;throw error;}}
const FULL_PERMISSIONS=Object.freeze(['chat','sentinel:command','settings','system:read']);
function fullAccess(user,check=isFounderAccount){return check(user?.id||user?.sub)?{...user,roles:['administrator'],permissions:[...FULL_PERMISSIONS]}:user;}
function assertFounderMutationAllowed(id,actor,check=isFounderAccount){if(check(id)&&!check(actor)){const e=new Error('founder_account_protected');e.status=403;throw e;}}
function assertFounderAccess(id,roles,permissions,check=isFounderAccount){if(check(id)&&(!roles.includes('administrator')||roles.includes('guest')||!FULL_PERMISSIONS.every(p=>permissions.includes(p)))){const e=new Error('founder_access_required');e.status=403;throw e;}}
module.exports={isFounderAccount,assertDeletable,FULL_PERMISSIONS,fullAccess,assertFounderMutationAllowed,assertFounderAccess};
