'use strict';
const path = require('node:path');
const {loadLocalProfile} = require('./local-secret-store.cjs');
const root = path.resolve(__dirname, '..');
const state = path.resolve(root, '..', 'panthorium-state');
const profile = loadLocalProfile({statePath:state});
const keep = /^(Path|SystemRoot|windir|TEMP|TMP|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|COMSPEC|PATHEXT|ProgramFiles.*|CommonProgramFiles.*|OS|NUMBER_OF_PROCESSORS|PROCESSOR_.*)$/i;
for (const key of Object.keys(process.env)) if (!keep.test(key)) delete process.env[key];
Object.assign(process.env, {
 NODE_ENV:'development', PANTHORIUM_LOCAL_PROFILE:'1', PANTHORIUM_AI_MODE:'local-only',
 HOST:'127.0.0.1', PORT:'18787', ALLOWED_ORIGINS:'http://127.0.0.1:18787,http://localhost:18787',
 DATABASE_URL:'', DATABASE_SSL_MODE:'disable', DATA_FILE:path.join(state,'panthorium.json'), AUDIT_FILE:path.join(state,'audit.log'),
 ADMIN_USERNAME:profile.username, ADMIN_PASSWORD:profile.password, JWT_SECRET:profile.jwtSecret,
 LOCAL_LLM_URL:'http://127.0.0.1:8088/v1/chat/completions', LOCAL_LLM_MODEL:'panthorium-local',
 GEMINI_LIVE_ENABLED:'0', SENTINEL_AUTO_TRAINING:'0', SENTINEL_AUTO_CAPTURE:'0',
 PANTHORIUM_GOVERNANCE_MODE:'off', PANTHORIUM_SENTINEL_CONTROL_MODE:'off', PANTHORIUM_MCP_ENABLED:'0',
 PANTHORIUM_CHILD_FEATURES_ENABLED:'0'
});
process.chdir(root);
