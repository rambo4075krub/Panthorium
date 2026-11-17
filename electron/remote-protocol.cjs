'use strict';
const { createHash, randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const THREAD = /^personal-[0-9a-f-]{36}$/i;
const CAPABILITIES = Object.freeze({
  'chat.read':'chat.sync', 'chat.write':'chat.sync', 'chat.delete':'chat.sync',
  'files.list':'files.read', 'files.read':'files.read', 'files.write':'files.write',
  'files.mkdir':'files.write', 'files.move':'files.write', 'files.remove':'files.delete',
  'memory.read':'files.read', 'memory.write':'files.write', 'process.run':'process.run',
  'browser.open':'browser.open', 'desktop.screenshot':'desktop.control',
  'desktop.click':'desktop.control', 'desktop.type':'desktop.control', 'desktop.key':'desktop.control'
});
const SCOPES = [...new Set(Object.values(CAPABILITIES))];
const ACTIVE = new Set(['awaiting_confirmation','queued','running','cancel_requested','unknown']);
const hash = value => createHash('sha256').update(String(value)).digest('hex');
function fail(code, status = 400) { throw Object.assign(new Error(code), { status, code }); }
function owner(user) { const id = String(user?.sub || ''); if (!id || id.length > 200 || user.isGuest || user.roles?.includes('guest') || id.startsWith('guest:') || !user.permissions?.includes('chat')) fail('remote_account_required',403); return id; }
function text(value, max, empty = false) { return typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0) && !/[\x00]/.test(value); }
function relative(value) { return text(value, 500) && !/^[\\/]|^[a-z]:|[\x00-\x1f:*?"<>|]/i.test(value) && !value.replace(/\\/g,'/').split('/').some(part => part === '..' || /[. ]$/.test(part) && part !== '.' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part)); }
function validateSteps(steps) {
  if (!Array.isArray(steps) || !steps.length || steps.length > 24 || Buffer.byteLength(JSON.stringify(steps)) > 768*1024) fail('invalid_remote_steps');
  return steps.map(step => {
    if (!step || typeof step !== 'object' || Array.isArray(step) || !CAPABILITIES[step.op] || Object.keys(step).some(key => !['op','args'].includes(key))) fail('invalid_remote_operation');
    const a = step.args || {};
    if (!a || typeof a !== 'object' || Array.isArray(a)) fail('invalid_remote_arguments');
    const keys = {
      'chat.read':['id'], 'chat.write':['id','content','version'], 'chat.delete':['id'],
      'files.list':['path'], 'files.read':['path'], 'files.write':['path','content','overwrite'], 'files.mkdir':['path'],
      'files.move':['path','destination'], 'files.remove':['path'], 'memory.read':['path'], 'memory.write':['path','content','overwrite'],
      'process.run':['command','timeoutSeconds'], 'browser.open':['url'], 'desktop.screenshot':[],
      'desktop.click':['x','y'], 'desktop.type':['text'], 'desktop.key':['key']
    }[step.op];
    if (Object.keys(a).some(key => !keys.includes(key))) fail('invalid_remote_arguments');
    if(step.op.startsWith('chat.')) {
      if(!THREAD.test(a.id))fail('invalid_personal_chat');
      if(step.op==='chat.write' && (!text(a.content,512*1024)||Buffer.byteLength(a.content)>512*1024||!Number.isSafeInteger(a.version)||a.version<1))fail('personal_chat_too_large',413);
    }
    if (step.op.startsWith('files.') || step.op.startsWith('memory.')) {
      if (!(step.op === 'files.list' && (a.path === undefined || a.path === '.')) && !relative(a.path)) fail('invalid_workspace_path');
      if (a.destination !== undefined && !relative(a.destination)) fail('invalid_workspace_path');
      if (step.op === 'files.move' && a.destination === undefined) fail('invalid_workspace_path');
      if (step.op.endsWith('.write') && !text(a.content, 64000, true)) fail('invalid_workspace_content');
      if (a.overwrite !== undefined && typeof a.overwrite !== 'boolean') fail('invalid_remote_arguments');
    }
    if (step.op === 'process.run' && (!text(a.command,8000) || a.timeoutSeconds !== undefined && (!Number.isInteger(a.timeoutSeconds) || a.timeoutSeconds < 1 || a.timeoutSeconds > 600))) fail('invalid_remote_command');
    if (step.op === 'browser.open') { let u; try { u = new URL(a.url); } catch { fail('invalid_remote_url'); } if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.href.length > 2000) fail('invalid_remote_url'); }
    if (step.op === 'desktop.click' && ![a.x,a.y].every(v => Number.isInteger(v) && v >= 0 && v <= 32767)) fail('invalid_remote_coordinates');
    if (step.op === 'desktop.type' && !text(a.text,4000)) fail('invalid_remote_text');
    if (step.op === 'desktop.key' && !['ENTER','TAB','ESC','BACKSPACE','DELETE','UP','DOWN','LEFT','RIGHT','CTRL+A','CTRL+C','CTRL+V','CTRL+S','ALT+TAB'].includes(a.key)) fail('invalid_remote_key');
    return { op:step.op, args:structuredClone(a) };
  });
}
function makeCipher(secret) {
  if (!secret || String(secret).length < 24) fail('remote_encryption_unconfigured',503);
  const key = createHash('sha256').update('panthorium-remote-transit-v1\0' + secret).digest();
  return {
    seal(value, aad) { const iv=randomBytes(12), c=createCipheriv('aes-256-gcm',key,iv); c.setAAD(Buffer.from(aad)); return Buffer.concat([iv,c.update(JSON.stringify(value)),c.final(),c.getAuthTag()]).toString('base64'); },
    open(value, aad) { const b=Buffer.from(value,'base64'), c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12)); c.setAAD(Buffer.from(aad)); c.setAuthTag(b.subarray(-16)); return JSON.parse(Buffer.concat([c.update(b.subarray(12,-16)),c.final()]).toString()); }
  };
}
module.exports = { ID, THREAD, CAPABILITIES, SCOPES, ACTIVE, hash, fail, owner, text, relative, validateSteps, makeCipher };
