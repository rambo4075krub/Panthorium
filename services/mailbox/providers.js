'use strict';
const {randomBytes}=require('node:crypto');
const {Parser}=require('htmlparser2');
const {fail}=require('./store');
const enc=encodeURIComponent;
const MAX_BYTES=12*1024*1024;
async function boundedJson(response){if(!response.body)return {};let total=0,chunks=[];for await(const chunk of response.body){total+=chunk.length;if(total>MAX_BYTES){fail('mailbox_response_too_large',413);}chunks.push(chunk);}const text=Buffer.concat(chunks).toString();return text?JSON.parse(text):{};}
async function request(fetcher,url,options={}){const r=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(25000)});if(!r.ok)fail([400,401,403].includes(r.status)?'mailbox_permission_or_request_error':r.status===429?'mailbox_rate_limited':'mailbox_provider_error',[400,401,403,429].includes(r.status)?r.status:502);return boundedJson(r);}
function plainHtml(html){let text='',skip=0;const p=new Parser({onopentag(name){if(['script','style','head'].includes(name))skip++;if(['br','p','div','tr'].includes(name)&&!skip)text+='\n';},ontext(t){if(!skip)text+=t;},onclosetag(name){if(['script','style','head'].includes(name))skip=Math.max(0,skip-1);}},{decodeEntities:true});p.write(String(html||''));p.end();return text;}
const PROVIDERS=Object.freeze({
 google:Object.freeze({authorize:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',scope:'openid email https://www.googleapis.com/auth/gmail.modify',base:'https://gmail.googleapis.com/gmail/v1/users/me'})
});
function requireGmail(provider){if(provider!=='google')fail('unsupported_mail_provider');}
function gmailMessage(m){const headers=Object.fromEntries((m.payload?.headers||[]).map(x=>[x.name.toLowerCase(),x.value]));let parts=[],attachments=[];function walk(p){if(p.filename){attachments.push({id:p.body?.attachmentId||p.partId,partId:p.partId,name:p.filename,mime:p.mimeType,size:p.body?.size||0,inline:!p.body?.attachmentId});}else if(p.body?.data&&['text/plain','text/html'].includes(p.mimeType)){parts.push({mime:p.mimeType,text:Buffer.from(p.body.data,'base64url').toString()});}for(const child of p.parts||[])walk(child);}walk(m.payload||{});const body=parts.some(p=>p.mime==='text/plain')?parts.filter(p=>p.mime==='text/plain').map(p=>p.text).join('\n'):parts.map(p=>plainHtml(p.text)).join('\n');return{id:m.id,threadId:m.threadId,subject:headers.subject||'',from:headers.from||'',to:headers.to||'',cc:headers.cc||'',replyTo:headers['reply-to']||headers.from||'',messageId:headers['message-id']||'',references:headers.references||'',date:headers.date||'',text:body.slice(0,80000),truncated:body.length>80000,unread:(m.labelIds||[]).includes('UNREAD'),folders:m.labelIds||[],attachments};}
function mimeMessage(p,email,reply){const boundary='panthorium_'+randomBytes(16).toString('hex');const lines=[`From: ${email}`,`To: ${p.to.join(', ')}`,`Cc: ${p.cc.join(', ')}`,`Bcc: ${p.bcc.join(', ')}`,`Subject: =?UTF-8?B?${Buffer.from(p.subject).toString('base64')}?=`,`MIME-Version: 1.0`];if(reply?.messageId){for(const [k,v] of [['In-Reply-To',reply.messageId],['References',(reply.references+' '+reply.messageId).trim()]]){if(/[\r\n]/.test(v))fail('invalid_reply_header');lines.push(k+': '+v);}}lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(p.text).toString('base64').match(/.{1,76}/g)?.join('\r\n')||'');for(const a of p.attachments||[]){lines.push(`--${boundary}`,`Content-Type: ${a.mime}`,`Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,'Content-Transfer-Encoding: base64','',(a.content.match(/.{1,76}/g)||[]).join('\r\n'));}lines.push(`--${boundary}--`,'');return Buffer.from(lines.join('\r\n')).toString('base64url');}
class MailProvider {
 constructor({provider,token,fetchImpl=fetch}){requireGmail(provider);this.provider=provider;this.spec=PROVIDERS.google;this.token=token;this.fetch=fetchImpl;}
 api(path,method='GET',body){if(!path.startsWith('/'))fail('invalid_mail_path');return request(this.fetch,this.spec.base+path,{method,headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
 async identity(){const d=await this.api('/profile');if(typeof d.emailAddress!=='string'||!d.emailAddress.includes('@'))fail('mailbox_gmail_required',403);return d.emailAddress;}
 async folders(){const d=await this.api('/labels');return(d.labels||[]).map(x=>({id:x.id,name:x.name}));}
 async list({query='',folder='',cursor='',limit=20}={}){
  const q=new URLSearchParams({maxResults:String(limit)});if(query)q.set('q',query);if(folder)q.set('labelIds',folder);if(['SPAM','TRASH'].includes(folder)||/(?:^|\s)(?:in:anywhere|in:trash|in:spam|label:trash|label:spam)(?:\s|$)/i.test(query))q.set('includeSpamTrash','true');if(cursor)q.set('pageToken',cursor);
  const d=await this.api('/messages?'+q),messages=d.messages||[],items=new Array(messages.length);let next=0,failed=false;
  // Bound simultaneous reads while preserving the order returned by Gmail.
  async function worker(provider){while(!failed&&next<messages.length){const index=next++;try{items[index]=await provider.read(messages[index].id);}catch(e){failed=true;throw e;}}}
  await Promise.all(Array.from({length:Math.min(4,messages.length)},()=>worker(this)));
  return{items:items.map(({text,attachments,...m})=>({...m,preview:text.slice(0,200),hasAttachments:!!attachments.length})),nextCursor:d.nextPageToken||null,complete:!d.nextPageToken};
 }
 async read(id){return gmailMessage(await this.api('/messages/'+enc(id)+'?format=full'));}
 async attachment(messageId,attachmentId){
  const message=await this.read(messageId),a=message.attachments.find(x=>x.id===attachmentId);if(!a)fail('mailbox_attachment_not_found',404);if(a.size>6*1024*1024)fail('mailbox_attachment_too_large',413);if(a.inline)fail('mailbox_inline_attachment_unsupported',422);
  const d=await this.api('/messages/'+enc(messageId)+'/attachments/'+enc(attachmentId)),buffer=Buffer.from(d.data||'','base64url');if(buffer.length>6*1024*1024)fail('mailbox_attachment_too_large',413);return{...a,buffer};
 }
 async mutate(p,email){
  const id=enc(p.messageId||'');
  if(p.action==='send'||p.action==='reply'){const d=await this.api('/messages/send','POST',{raw:mimeMessage(p,email,p.reply),...(p.reply?.threadId?{threadId:p.reply.threadId}:{})});return{status:'accepted',providerMessageId:d.id};}
  if(p.action==='trash'||p.action==='restore')return this.api('/messages/'+id+'/'+(p.action==='trash'?'trash':'untrash'),'POST',{});
  const body=p.action==='mark_read'?{removeLabelIds:['UNREAD']}:p.action==='mark_unread'?{addLabelIds:['UNREAD']}:{addLabelIds:[p.folderId],removeLabelIds:p.sourceFolderId?[p.sourceFolderId]:[]};
  return this.api('/messages/'+id+'/modify','POST',body);
 }
}
module.exports={PROVIDERS,MailProvider,request,plainHtml,gmailMessage,mimeMessage,requireGmail};
