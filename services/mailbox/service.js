'use strict';
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const {MailboxStore,owner,fail}=require('./store');
const {PROVIDERS,MailProvider,request,requireGmail}=require('./providers');
const string=(v,max=500)=>typeof v==='string'&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
const identifier=v=>string(v,1500)&&v.length>0;
const addresses=v=>{if(!Array.isArray(v)||v.length>20)fail('invalid_mail_recipients');return v.map(x=>{if(!string(x,254)||! /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(x))fail('invalid_mail_recipients');return x;});};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
class UserMailboxService {
 constructor({pool,env=process.env,fetchImpl=fetch,complete,extract,store}={}){this.env=env;this.fetch=fetchImpl;this.store=store||new MailboxStore({pool,key:env.USER_MAILBOX_ENCRYPTION_KEY});this.complete=complete;this.extract=extract;}
 enabled(){if(this.env.USER_MAILBOX_ENABLED!=='1')fail('mailbox_not_enabled',503);}
 config(provider,purpose='standard'){
  if(!['standard','agent'].includes(purpose))fail('invalid_mailbox_purpose');
  requireGmail(provider);const spec=PROVIDERS.google;
  const prefix=purpose==='agent'?'USER_MAILBOX_GOOGLE_AGENT':'USER_MAILBOX_GOOGLE';
  const clientId=this.env[prefix+'_CLIENT_ID'],clientSecret=this.env[prefix+'_CLIENT_SECRET'],base=this.env.USER_MAILBOX_PUBLIC_ORIGIN;
  if(!clientId||!clientSecret||!base||!/^https:\/\/[^/?#]+$/.test(base))fail(purpose==='agent'?'mailbox_agent_not_configured':'mailbox_provider_not_configured',503);
  if(provider==='google'&&purpose==='agent'&&clientId===this.env.USER_MAILBOX_GOOGLE_CLIENT_ID)fail('mailbox_agent_client_must_be_separate',503);
  return{...spec,clientId,clientSecret,redirectUri:base+'/api/mailbox/oauth/'+provider+'/callback'};
 }
 configured(purpose){return Object.keys(PROVIDERS).filter(p=>{try{this.config(p,purpose);return true;}catch{return false;}});}
 async status(user,{purpose}={}){
  owner(user);if(this.env.USER_MAILBOX_ENABLED!=='1')return{enabled:false,connections:[],onboardingRequired:false};
  await this.store.cleanup();let connections=(await this.store.list(user,'connection')).filter(c=>c.provider==='google');
  if(purpose)connections=connections.filter(c=>(c.purpose||'standard')===purpose);
  for(const c of connections){if(!c.reconnectRequired){try{const active=await this.client(user,c.id);const email=await active.provider.identity();if(email.toLowerCase()!==c.email.toLowerCase())fail('mailbox_registration_email_mismatch',403);}catch(e){if([400,401,403].includes(e.status)){c.reconnectRequired=true;await this.store.put(user,'connection',c,{id:c.id,ttl:365*86400000});}else throw e;}}}
  const safe=connections.map(c=>({id:c.id,provider:c.provider,purpose:c.purpose||'standard',email:c.email,reconnectRequired:!!c.reconnectRequired}));
  return{enabled:true,localAiAllowed:require('../localAiAccess').localAiAllowed(user),providerPolicy:'gmail_only',email:user.email||'',connections:safe,onboardingRequired:!safe.some(c=>!c.reconnectRequired&&c.purpose===(purpose||'standard')),aiEnabled:this.env.USER_MAILBOX_AI_POLICY_VERIFIED==='1',providers:this.configured(purpose||'standard'),agentProviders:this.configured('agent')};
 }
 async agentStatus(user){this.requireAI();return this.status(user,{purpose:'agent'});}
 requireAI(){if(this.env.USER_MAILBOX_AI_POLICY_VERIFIED!=='1')fail('mailbox_ai_not_enabled',503);}
 async requireAgent(user,connectionId){this.enabled();this.requireAI();const c=await this.store.get(user,'connection',connectionId);if(c.purpose!=='agent')fail('mailbox_agent_connection_required',403);}
 async requireStandard(user,connectionId){const c=await this.store.get(user,'connection',connectionId);if(c.purpose==='agent')fail('mailbox_standard_connection_required',403);}
 async manualRead(user,args){await this.requireStandard(user,args.connectionId);return this.read(user,args);}
 async manualPrepare(user,args){await this.requireStandard(user,args.connectionId);return this.prepare(user,args);}
 async manualExecute(user,id){const p=await this.store.get(user,'proposal',id);await this.requireStandard(user,p.payload.connectionId);return this.execute(user,id);}
 async agentRead(user,args){await this.requireAgent(user,args.connectionId);return this.read(user,args);}
 async agentPrepare(user,args){await this.requireAgent(user,args.connectionId);return this.prepare(user,args);}
 async connect(user,provider,purpose='standard'){
  this.enabled();if(!user.email||!user.emailVerifiedAt)fail('mailbox_verified_email_required',403);
  if(purpose==='agent')this.requireAI();
  const c=this.config(provider,purpose),verifier=randomBytes(32).toString('base64url'),state=randomBytes(32).toString('base64url');
  await this.store.put(user,'oauth',{provider,purpose,verifier,email:user.email.toLowerCase()},{id:state,ttl:600000});
  const q=new URLSearchParams({client_id:c.clientId,redirect_uri:c.redirectUri,response_type:'code',scope:c.scope,state,code_challenge:hashBuffer(verifier),code_challenge_method:'S256',prompt:'consent',login_hint:user.email});
  if(provider==='google')q.set('access_type','offline');return{url:c.authorize+'?'+q};
 }
 async callback(provider,code,state){
  this.enabled();requireGmail(provider);if(!identifier(code)||!string(state,100)||! /^[A-Za-z0-9_-]{43}$/.test(state))fail('invalid_mailbox_oauth');
  await this.store.init();const row=(await this.store.pool.query("SELECT user_id FROM panthorium_user_mailbox WHERE id=$1 AND kind='oauth'",[state])).rows[0];if(!row)fail('mailbox_oauth_expired',400);
  const user={sub:row.user_id},pending=await this.store.get(user,'oauth',state);if(pending.provider!==provider)fail('mailbox_oauth_provider_mismatch');
  const purpose=pending.purpose||'standard';if(purpose==='agent')this.requireAI();
  await this.store.claim(user,'oauth',state);const c=this.config(provider,purpose);
  const token=await request(this.fetch,c.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.clientId,client_secret:c.clientSecret,redirect_uri:c.redirectUri,code,code_verifier:pending.verifier,grant_type:'authorization_code'}).toString()});
  if(!token.access_token||!token.refresh_token)fail('mailbox_offline_permission_required',403);
  const granted=new Set(String(token.scope||'').split(' '));for(const scope of ['https://www.googleapis.com/auth/gmail.modify'])if(!granted.has(scope))fail('mailbox_scope_missing',403);
  const email=await new MailProvider({provider,token:token.access_token,fetchImpl:this.fetch}).identity();if(String(email).toLowerCase()!==pending.email)fail('mailbox_registration_email_mismatch',403);
  const id=provider+':'+(purpose==='agent'?'agent:':'')+owner(user);
  await this.store.put(user,'connection',{provider,purpose,email,token,expiresAt:Date.now()+Number(token.expires_in||3600)*1000,reconnectRequired:false},{id,ttl:365*86400000});
  await this.store.remove(user,'oauth',state);return{connected:true,purpose};
 }
 async client(user,connectionId){
  this.enabled();const c=await this.store.get(user,'connection',connectionId);requireGmail(c.provider);
  if(c.reconnectRequired||user.email&&c.email.toLowerCase()!==user.email.toLowerCase())fail('mailbox_reconnect_required',401);
  if(c.expiresAt<Date.now()+60000){try{
   const cfg=this.config(c.provider,c.purpose||'standard');
   const token=await request(this.fetch,cfg.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:cfg.clientId,client_secret:cfg.clientSecret,grant_type:'refresh_token',refresh_token:c.token.refresh_token}).toString()});
   c.token={...c.token,...token};c.expiresAt=Date.now()+Number(token.expires_in||3600)*1000;await this.store.put(user,'connection',c,{id:connectionId,ttl:365*86400000});
  }catch(e){if([400,401,403].includes(e.status)){c.reconnectRequired=true;await this.store.put(user,'connection',c,{id:connectionId,ttl:365*86400000});}throw e;}}
  return{connection:c,provider:new MailProvider({provider:c.provider,token:c.token.access_token,fetchImpl:this.fetch})};
 }
 async read(user,args){const {provider}=await this.client(user,args.connectionId);if(args.action==='folders')return{items:await provider.folders()};if(args.action==='get'){if(!identifier(args.messageId))fail('invalid_mail_message');return{message:await provider.read(args.messageId),untrusted:true};}if(args.action!=='list')fail('invalid_mail_action');if(!string(args.query||'',500)||!string(args.folderId||'',1500)||!string(args.cursor||'',2500)||args.limit!=null&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>30))fail('invalid_mail_search');return{...await provider.list({query:args.query,folder:args.folderId,cursor:args.cursor,limit:args.limit||20}),untrusted:true};}
 async normalize(user,input){if(!input||typeof input!=='object'||!['send','reply','trash','restore','move','mark_read','mark_unread','draft'].includes(input.action)||!identifier(input.connectionId))fail('invalid_mail_action');const {provider,connection}=await this.client(user,input.connectionId);let p={action:input.action,connectionId:input.connectionId};if(['send','reply','draft'].includes(p.action)){p={...p,to:addresses(input.to||[]),cc:addresses(input.cc||[]),bcc:addresses(input.bcc||[]),subject:input.subject||'',text:input.text||'',attachments:[]};if(!string(p.subject,300)||/[\r\n]/.test(p.subject)||!string(p.text,50000)||p.action!=='draft'&&(!p.to.length||!p.subject.trim()||!p.text.trim()))fail('invalid_mail_content');if(input.attachments!=null&&!Array.isArray(input.attachments))fail('invalid_mail_attachments');if((input.attachments||[]).length>5)fail('too_many_mail_attachments');let bytes=0;for(const ref of input.attachments||[]){if(!identifier(ref.messageId)||!identifier(ref.attachmentId))fail('invalid_mail_attachment');const a=await provider.attachment(ref.messageId,ref.attachmentId);bytes+=a.buffer.length;if(bytes>6*1024*1024||!string(a.name,180)||/[\r\n]/.test(a.mime)||! /^[\w.+-]+\/[\w.+-]+$/.test(a.mime))fail('invalid_mail_attachment');p.attachments.push({name:a.name,mime:a.mime,content:a.buffer.toString('base64'),source:{messageId:ref.messageId,attachmentId:ref.attachmentId}});}}
 if(!['send','draft'].includes(p.action)){if(!identifier(input.messageId))fail('invalid_mail_message');const message=await provider.read(input.messageId);if(input.expectedSubject!==message.subject)fail('mailbox_message_changed',409);p.messageId=message.id;p.expectedSubject=message.subject;p.messageFrom=message.from;p.messageDate=message.date;p.snapshot=hash({subject:message.subject,from:message.from,date:message.date,folders:message.folders,replyTo:message.replyTo});if(p.action==='reply'){p.reply={messageId:message.messageId,references:message.references||'',threadId:message.threadId};const allowed=String(message.replyTo).split(',').map(x=>(/<([^<>]+)>/.exec(x)?.[1]||x).trim().toLowerCase());if(!p.to.every(x=>allowed.includes(x.toLowerCase())))fail('mailbox_reply_recipient_mismatch',409);}if(p.action==='move'){const folders=await provider.folders();if(!folders.some(f=>f.id===input.folderId))fail('mailbox_folder_not_found');p.folderId=input.folderId;p.folderName=folders.find(f=>f.id===input.folderId).name;if(connection.provider==='google'){if(!input.sourceFolderId||!message.folders.includes(input.sourceFolderId)||input.folderId===input.sourceFolderId)fail('mailbox_source_folder_required');const mutable=id=>id==='INBOX'||/^Label_/.test(id);if(!mutable(input.sourceFolderId)||!mutable(input.folderId))fail('mailbox_use_trash_or_restore');p.sourceFolderId=input.sourceFolderId;p.sourceFolderName=folders.find(f=>f.id===input.sourceFolderId)?.name||input.sourceFolderId;}}}return p;}
 preview(p,email){return{action:p.action,account:email,messageId:p.messageId,subject:p.subject||p.expectedSubject,to:p.to,cc:p.cc,bcc:p.bcc,text:p.text,folder:p.folderName,sourceFolder:p.sourceFolderName,from:p.messageFrom,date:p.messageDate,originalSubject:p.expectedSubject,attachments:p.attachments?.map(a=>({name:a.name,bytes:Buffer.from(a.content,'base64').length,...a.source})),deletion:p.action==='trash'?'move_to_trash':undefined};}
 async prepare(user,input){const payload=await this.normalize(user,input),{connection}=await this.client(user,payload.connectionId);const preview=this.preview(payload,connection.email);const proposalId=await this.store.put(user,'proposal',{payload,preview},{ttl:600000});return{proposalId,preview,expiresInSeconds:600,requiresConfirmation:true};}
 async execute(user,proposalId){if(!identifier(proposalId))fail('invalid_mail_proposal');const proposal=await this.store.get(user,'proposal',proposalId);if(proposal.state==='complete')return{...proposal.result,replayed:true};const p=proposal.payload;const {provider,connection}=await this.client(user,p.connectionId);if(p.messageId){const m=await provider.read(p.messageId);if(hash({subject:m.subject,from:m.from,date:m.date,folders:m.folders,replyTo:m.replyTo})!==p.snapshot)fail('mailbox_message_changed',409);}await this.store.claim(user,'proposal',proposalId);try{const result=p.action==='draft'?{status:'draft_saved',draftId:await this.store.put(user,'draft',{payload:p,preview:proposal.preview},{ttl:30*86400000})}:await provider.mutate(p,connection.email);await this.store.put(user,'proposal',{...proposal,result},{id:proposalId,state:'complete',ttl:86400000});return{...result,action:p.action};}catch(e){await this.store.put(user,'proposal',{...proposal,result:{status:'unknown',reconciliationRequired:true}},{id:proposalId,state:'unknown',ttl:86400000});fail('mailbox_outcome_unknown_check_before_retry',409);}}
 async analyze(user,{connectionId,messageIds,attachmentId,question='สรุปใจความ สิ่งที่ต้องทำ และกำหนดเวลา',provider:preferredProvider}){if(preferredProvider==='local'&&!require('../localAiAccess').localAiAllowed(user))fail('local_access_denied',403);if(preferredProvider!=null&&!['gemini-live','local'].includes(preferredProvider))fail('invalid_mail_ai_provider');if(this.env.USER_MAILBOX_AI_POLICY_VERIFIED!=='1'||!this.complete)fail('mailbox_ai_not_enabled',503);if(!Array.isArray(messageIds)||!messageIds.length||messageIds.length>10||!messageIds.every(identifier)||!string(question,1000))fail('invalid_mail_analysis');await this.requireAgent(user,connectionId);const {provider}=await this.client(user,connectionId);const sources=[];for(const id of messageIds){const m=await provider.read(id);let text=m.text;if(attachmentId){if(messageIds.length!==1||!identifier(attachmentId)||!this.extract)fail('invalid_mail_attachment');const a=await provider.attachment(id,attachmentId);text=await this.extract(a);sources.push({messageId:id,attachmentId,name:a.name,subject:m.subject,text});}else sources.push({messageId:id,subject:m.subject,from:m.from,date:m.date,text,truncated:m.truncated||false});}if(JSON.stringify(sources).length>100000)fail('mailbox_analysis_too_large',413);const result=await this.complete({user,provider:preferredProvider,question,sources});if(!result?.ok)fail('mailbox_analysis_failed',503);return{text:result.text,sources:sources.map(({text,...s})=>s),provider:result.provider,truncated:!!result.sourceTruncated||sources.some(s=>s.truncated)};}
 async disconnect(user,purpose){if(purpose==='agent'){for(const c of await this.store.list(user,'connection'))if(c.purpose==='agent')await this.store.remove(user,'connection',c.id);}else if(purpose==null){await this.store.purge(user);}else fail('invalid_mailbox_purpose');return{disconnected:true};}
}
function hashBuffer(v){return createHash('sha256').update(v).digest('base64url');}
module.exports={UserMailboxService,addresses};
