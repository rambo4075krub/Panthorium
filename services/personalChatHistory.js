'use strict';
const {THREAD}=require('./remoteWorkspaceProtocol');
function validClientHistory(history) {
  return history===undefined || Array.isArray(history)&&history.length<=40&&Buffer.byteLength(JSON.stringify(history))<=96*1024
    && history.every(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string'&&m.content.length<=24000&&Object.keys(m).every(k=>['role','content'].includes(k)));
}
function personalHistory(sessionId,history,message,limit) {
  if(!THREAD.test(sessionId))return null;
  if(!validClientHistory(history))throw Object.assign(Error('invalid_client_history'),{status:400});
  return [...(history||[]).slice(-Math.max(0,limit-1)).map(m=>({role:m.role,content:m.content})),{role:'user',content:String(message).trim()}];
}
module.exports={validClientHistory,personalHistory,isPersonalChat:id=>THREAD.test(String(id||''))};
