'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const state = path.resolve(root, '..', 'panthorium-state');
fs.mkdirSync(state, {recursive:true});
const profileFile = path.join(state, 'local-profile.json');
if (!fs.existsSync(profileFile)) fs.writeFileSync(profileFile, JSON.stringify({ username:'localadmin', password:crypto.randomBytes(24).toString('base64url'), jwtSecret:crypto.randomBytes(48).toString('base64url') }, null, 2), {flag:'wx',mode:0o600});
const profile = JSON.parse(fs.readFileSync(profileFile,'utf8'));
fs.writeFileSync(path.join(state, 'LOCAL_LOGIN.txt'), 'Panthorium local pilot only\nUsername: ' + profile.username + '\nPassword: ' + profile.password + '\n', {mode:0o600});
const keep = /^(Path|SystemRoot|windir|TEMP|TMP|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|COMSPEC|PATHEXT|ProgramFiles.*|CommonProgramFiles.*|OS|NUMBER_OF_PROCESSORS|PROCESSOR_.*)$/i;
for (const key of Object.keys(process.env)) if (!keep.test(key)) delete process.env[key];
Object.assign(process.env, {
 NODE_ENV:'development', PANTHORIUM_LOCAL_PROFILE:'1', PANTHORIUM_AI_MODE:'local-only',
 HOST:'127.0.0.1', PORT:'8787', ALLOWED_ORIGINS:'http://127.0.0.1:8787,http://localhost:8787',
 DATABASE_URL:'', DATABASE_SSL_MODE:'disable', DATA_FILE:path.join(state,'panthorium.json'), AUDIT_FILE:path.join(state,'audit.log'),
 ADMIN_USERNAME:profile.username, ADMIN_PASSWORD:profile.password, JWT_SECRET:profile.jwtSecret,
 LOCAL_LLM_URL:'http://127.0.0.1:8088/v1/chat/completions', LOCAL_LLM_MODEL:'panthorium-local',
 GEMINI_LIVE_ENABLED:'0', SENTINEL_AUTO_TRAINING:'0', SENTINEL_AUTO_CAPTURE:'0',
 PANTHORIUM_GOVERNANCE_MODE:'off', PANTHORIUM_SENTINEL_CONTROL_MODE:'off', PANTHORIUM_MCP_ENABLED:'0',
 PANTHORIUM_CHILD_FEATURES_ENABLED:'0'
});
process.chdir(root);
