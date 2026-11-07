(function(){
'use strict';
const ID='user-mailbox',os=()=>typeof OS==='undefined'?null:OS,el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;};
const uid=()=>String(os()?.state?.user?.sub||os()?.state?.user?.id||'');
const allowed=()=>!!uid()&&!uid().startsWith('guest:')&&!os()?.state?.user?.roles?.includes('guest');
let epoch=0,lastUser='',checked='',root=null,status=null,connectionId='',current=null,folder='',nextCursor=null,speechEpoch=0,agentConnectionId='',oauthPending=false,renderEpoch=0,detailEpoch=0,listEpoch=0;
async function api(path,method='GET',body){
 const user=uid(),e=epoch;let r;
 try{r=await fetch(os().config.backendUrl.replace(/\/$/,'')+'/api/mailbox/'+path,{method,headers:{Authorization:'Bearer '+os().config.accessToken,'Content-Type':'application/json'},...(typeof AbortSignal?.timeout==='function'?{signal:AbortSignal.timeout(path==='analyze'?120000:90000)}:{}),...(body?{body:JSON.stringify(body)}:{})});}
 catch{throw Error(path==='confirm'?'mailbox_confirmation_status_unknown':'mailbox_unavailable');}
 const d=await r.json().catch(()=>{throw Error(path==='confirm'?'mailbox_confirmation_status_unknown':'mailbox_unavailable');});
 if(e!==epoch||user!==uid())throw Error('บัญชีเปลี่ยนแล้ว กรุณาเปิดใหม่');
 if(!r.ok)throw Error(d.error||'mailbox_unavailable');return d;
}
function button(label,fn){const b=el('button',label);b.type='button';let busy=false;b.onclick=async()=>{if(busy||b.disabled)return;busy=true;b.disabled=true;try{await run(fn);}finally{busy=false;if(!b.dataset.locked)b.disabled=false;}};return b;}
function currentDetail(view,generation){return root===view&&view?.isConnected&&generation===detailEpoch;}
function clearDetail(text='เลือกอีเมลเพื่ออ่าน'){detailEpoch++;stop();pane()?.replaceChildren(el('p',text));}
function note(text){const n=root?.querySelector('[role=status]');if(n)n.textContent=text;}
async function run(fn){const e=epoch,user=uid();try{await fn();}catch(error){if(e!==epoch||user!==uid())return;const messages={
 local_access_denied:'บัญชีนี้ไม่มีสิทธิ์ใช้บริการ AI ภายใน กรุณาเลือก Sentinel AI',unsupported_mail_provider:'ฟังก์ชันนี้ใช้ได้เฉพาะบัญชีที่มีกล่อง Gmail เท่านั้น',mailbox_gmail_required:'ต้องเปิดใช้งาน Gmail ของบัญชีนี้ก่อนจึงจะใช้ฟังก์ชันอีเมลได้',
 mailbox_agent_connection_required:'กรุณาเชื่อมต่อ AI และเสียงในหน้ากล่องอีเมลก่อน',mailbox_agent_not_configured:'บริการ AI และเสียงยังอยู่ระหว่างตั้งค่า',mailbox_ai_not_enabled:'บริการ AI และเสียงยังอยู่ระหว่างตั้งค่า',
 mailbox_verified_email_required:'บัญชี Panthorium ต้องมีอีเมลที่ยืนยันแล้ว กรุณาตรวจสอบอีเมลในบัญชีหรือติดต่อผู้ดูแล',mailbox_registration_email_mismatch:'กรุณาเชื่อมต่อ Gmail เดียวกับอีเมลที่ใช้สมัคร Panthorium',mailbox_provider_not_configured:'ระบบยังตั้งค่าการเชื่อมต่อ Gmail ไม่ครบ',
 mailbox_reconnect_required:'การเชื่อมต่อ Gmail หมดอายุหรือถูกเพิกถอน กรุณากดตรวจการเชื่อมต่อแล้วเชื่อมใหม่',mailbox_permission_or_request_error:'กรุณาตรวจว่าบัญชีเปิดใช้งาน Gmail และอนุญาตสิทธิ์ครบ แล้วกดตรวจการเชื่อมต่อเพื่อเชื่อมใหม่',mailbox_rate_limited:'Gmail จำกัดจำนวนคำขอชั่วคราว กรุณารอสักครู่แล้วลองใหม่',
 mailbox_unavailable:'เชื่อมต่อบริการอีเมลไม่สำเร็จ กรุณาลองใหม่ สถานะนี้ไม่ได้หมายความว่ากล่องอีเมลว่าง',mailbox_provider_error:'Gmail ไม่พร้อมให้บริการชั่วคราว กรุณาลองใหม่',
 mailbox_record_not_found:'รายการหรือคำขอยืนยันหมดอายุแล้ว กรุณาเปิดอีเมลและตรวจรายละเอียดใหม่',mailbox_record_already_used:'คำขอนี้ถูกดำเนินการหรืออยู่ระหว่างตรวจสอบแล้ว กรุณาตรวจสถานะใน Gmail ก่อนทำรายการใหม่',
 mailbox_message_changed:'อีเมลมีการเปลี่ยนแปลง กรุณาเปิดใหม่และทบทวนคำสั่งอีกครั้ง',mailbox_source_folder_required:'กรุณาเลือกป้ายต้นทางที่มีอยู่ในอีเมลและปลายทางที่แตกต่างกัน',mailbox_use_trash_or_restore:'กรุณาใช้ปุ่มลบลงถังขยะหรือกู้คืนสำหรับรายการนี้',mailbox_folder_not_found:'ไม่พบป้ายปลายทาง กรุณาตรวจการเชื่อมต่อแล้วเลือกใหม่',
 mailbox_outcome_unknown_check_before_retry:'ยังยืนยันผลรายการไม่ได้ กรุณาตรวจใน Gmail ก่อนทำใหม่ ระบบจะไม่ส่งคำสั่งซ้ำอัตโนมัติ',mailbox_confirmation_status_unknown:'การเชื่อมต่อขาดระหว่างยืนยัน กรุณาตรวจผลใน Gmail ก่อนทำใหม่ ระบบจะไม่ส่งคำสั่งซ้ำอัตโนมัติ',
 invalid_mail_recipients:'กรุณาระบุอีเมลผู้รับให้ถูกต้อง และใช้เครื่องหมายจุลภาคคั่นแต่ละคน',invalid_mail_content:'กรุณาระบุผู้รับ หัวข้อ และเนื้อหาให้ครบ',mailbox_reply_recipient_mismatch:'ผู้รับตอบกลับไม่ตรงกับอีเมลต้นฉบับ กรุณาตรวจรายละเอียดใหม่',invalid_mail_attachment:'ไฟล์แนบไม่ถูกต้องหรือมีขนาดรวมเกิน 6 MiB',too_many_mail_attachments:'แนบไฟล์เดิมได้ไม่เกิน 5 ไฟล์',
 mailbox_analysis_failed:'ยังสรุปอีเมลไม่ได้ กรุณาตรวจเครดิตหรือความพร้อมของบริการแล้วลองใหม่',mailbox_analysis_too_large:'ข้อมูลมากเกินไป กรุณาเลือกสรุปทีละฉบับหรือทีละไฟล์',mailbox_attachment_too_large:'ไฟล์แนบใหญ่เกิน 6 MiB จึงยังวิเคราะห์ไม่ได้',mailbox_attachment_not_found:'ไม่พบไฟล์แนบ กรุณาเปิดอีเมลต้นฉบับใหม่',mailbox_attachment_type_unsupported:'ยังไม่รองรับไฟล์ชนิดนี้ กรุณาใช้ PDF ที่มีข้อความ หรือ DOCX/XLSX/PPTX/TXT/CSV/MD/JSON',mailbox_scanned_pdf_requires_ocr:'ไฟล์ PDF นี้เป็นภาพสแกนหรือมีข้อความไม่เพียงพอ จึงยังสรุปเนื้อหาไม่ได้',mailbox_attachment_timeout:'ไฟล์ใช้เวลาอ่านนานเกินไป กรุณาเลือกไฟล์ขนาดเล็กลง',mailbox_attachment_text_too_large:'ข้อความในไฟล์มากเกินไป กรุณาแบ่งเป็นไฟล์ย่อย',mailbox_active_attachment_unsupported:'ไม่รองรับไฟล์ที่มีมาโครหรือโปรแกรมฝังตัว',
 authentication_required:'กรุณาเข้าสู่ระบบก่อนเชื่อมต่ออีเมล',invalid_or_expired_token:'การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'
 };note(messages[error.message]||(/^mailbox_|^invalid_mail/.test(error.message)?'ไม่สามารถดำเนินการอีเมลนี้ได้ กรุณาตรวจรายละเอียดแล้วลองใหม่':error.message));}}
function stop(){speechEpoch++;window.speechSynthesis?.cancel();}
function speak(text){stop();if(!window.speechSynthesis)return note('อุปกรณ์นี้ไม่มีระบบอ่านออกเสียง โปรดใช้โหมดสนทนาเสียง');const generation=speechEpoch,chunks=String(text).match(/[\s\S]{1,220}(?:\s|$)|[\s\S]{1,220}/g)||[];let i=0;function next(){if(generation!==speechEpoch||i>=chunks.length)return;const u=new SpeechSynthesisUtterance(chunks[i++]);u.lang='th-TH';u.onend=next;window.speechSynthesis.speak(u);}next();}
function pane(){return root.querySelector('[data-detail]');}
function reviewText(p){
 const labels={send:['ส่งอีเมลนี้หรือไม่','ยืนยันส่งอีเมล'],reply:['ตอบกลับอีเมลนี้หรือไม่','ยืนยันตอบกลับ'],draft:['บันทึกฉบับร่างนี้หรือไม่','ยืนยันบันทึกฉบับร่าง'],trash:['ย้ายอีเมลนี้ลงถังขยะหรือไม่','ยืนยันย้ายลงถังขยะ'],restore:['กู้คืนอีเมลนี้จากถังขยะหรือไม่','ยืนยันกู้คืน'],move:['ย้ายป้ายของอีเมลนี้หรือไม่','ยืนยันย้ายอีเมล'],mark_read:['ทำเครื่องหมายว่าอ่านแล้วหรือไม่','ยืนยันว่าอ่านแล้ว'],mark_unread:['ทำเครื่องหมายว่ายังไม่อ่านหรือไม่','ยืนยันว่ายังไม่อ่าน']};
 const [fallbackTitle,confirm]=labels[p.action]||['ดำเนินการอีเมลนี้หรือไม่','ยืนยันดำเนินการ'],rows=[];
 const title=window.PanthoriumActionPresentation?.describe({toolId:'mailbox.write',args:p}).question||fallbackTitle;
 const add=(label,value)=>{if(value!==undefined&&value!==null&&value!=='')rows.push([label,String(value)]);};
 add('บัญชี Gmail',p.account);add('จาก',p.from);add('วันที่',p.date);add('หัวข้อ',p.subject||'(ไม่มีหัวข้อ)');if(p.originalSubject&&p.originalSubject!==p.subject)add('หัวข้ออีเมลต้นฉบับ',p.originalSubject);
 for(const [key,label]of [['to','ถึง'],['cc','สำเนา (Cc)'],['bcc','สำเนาลับ (Bcc)']])if(p[key]?.length)add(label,p[key].join(', '));
 add('เนื้อหา',p.text);add('ป้ายต้นทาง',p.sourceFolder);add('ป้ายปลายทาง',p.folder);
 if(['send','reply','draft'].includes(p.action))add('ไฟล์แนบ',p.attachments?.length?p.attachments.map(a=>a.name+' ('+a.bytes+' ไบต์)').join('\n'):'ไม่มี');
 if(p.action==='trash')add('ผลการลบ','ย้ายลงถังขยะ ยังสามารถกู้คืนได้');
 return{title,confirm,rows,spoken:[title,...rows.map(([label,value])=>label+': '+value)].join('\n')};
}
async function review(input){
 const view=root,generation=++detailEpoch;stop();const data=await api('prepare','POST',input);if(!currentDetail(view,generation))return;
 const d=pane(),text=reviewText(data.preview);d.replaceChildren(el('h2',text.title));
 for(const [label,value]of text.rows){const section=el('section'),body=el('p',value);body.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65';section.append(el('strong',label),body);d.append(section);}
 d.append(el('small','คำขอนี้หมดอายุภายใน 10 นาที กรุณาตรวจรายละเอียดก่อนยืนยัน'));
 const cancel=button('ยกเลิก',()=>clearDetail('ยกเลิกแล้ว ยังไม่ได้ดำเนินการ'));
 const confirm=button(text.confirm,async()=>{
  confirm.dataset.locked='true';cancel.dataset.locked='true';cancel.disabled=true;stop();note('กำลังดำเนินการ…');
  const r=await api('confirm','POST',{proposalId:data.proposalId});if(!currentDetail(view,generation))return;
  clearDetail();await list();
  if(root===view&&view.isConnected)note(r.status==='accepted'?'Gmail รับคำขอส่งแล้ว ยังไม่ได้ยืนยันว่าผู้รับได้รับ':r.status==='draft_saved'?'บันทึกฉบับร่างใน Panthorium แล้ว':'ดำเนินการสำเร็จ');
 });
 d.append(button('อ่านรายละเอียดให้ฟัง',()=>speak(text.spoken)),confirm,cancel);
}
function compose(message=null,draft=null){
 clearDetail();const d=pane();d.replaceChildren(el('h2',message?'ตอบกลับอีเมล':'เขียนอีเมล'));const fields={};
 for(const [key,label,value]of [['to','ถึง',message?.replyTo||''],['cc','สำเนา (Cc)',''],['bcc','สำเนาลับ (Bcc)',''],['subject','หัวข้อ',message?'Re: '+message.subject:''],['text','เนื้อหา','']]){const l=el('label',label),input=el(key==='text'?'textarea':'input');input.value=draft?(Array.isArray(draft[key])?draft[key].join(', '):draft[key]||''):value;input.setAttribute('aria-label',label);fields[key]=input;l.append(input);d.append(l);}
 const selected=[];
 for(const a of draft?.attachments||message?.attachments||[]){
  const ref={messageId:draft?a.messageId:message.id,attachmentId:draft?a.attachmentId:a.id};
  if(!ref.messageId||!ref.attachmentId){d.append(el('p','กรุณาแนบไฟล์จากต้นฉบับใหม่: '+a.name));continue;}
  const label=el('label','แนบไฟล์เดิม: '+a.name),cb=el('input');cb.type='checkbox';cb.checked=!!draft;if(cb.checked)selected.push(ref);
  cb.onchange=()=>{const i=selected.findIndex(x=>x.attachmentId===ref.attachmentId&&x.messageId===ref.messageId);if(cb.checked&&i<0)selected.push(ref);else if(i>=0)selected.splice(i,1);};label.prepend(cb);d.append(label);
 }
 function payload(action){const p={connectionId,action,...Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,['to','cc','bcc'].includes(k)?v.value.split(',').map(x=>(/<([^<>]+)>/.exec(x)?.[1]||x).trim()).filter(Boolean):v.value])),attachments:selected};if(action==='reply'){p.messageId=message.id;p.expectedSubject=message.subject;}return p;}
 d.append(button('ตรวจและส่ง',()=>review(payload(message?'reply':'send'))),button('บันทึกฉบับร่าง',()=>review(payload('draft'))));
}
async function analyze(message,attachmentId){
 const view=root,generation=detailEpoch;note('กำลังวิเคราะห์ด้วย AI ตามบริการและเครดิตของบัญชี…');
 const r=await api('analyze','POST',{connectionId:agentConnectionId,messageIds:[message.id],provider:root.querySelector('[data-ai-provider]')?.value||undefined,...(attachmentId?{attachmentId}:{})});if(!currentDetail(view,generation))return;
 const d=pane();d.append(el('h3','ผลวิเคราะห์'),el('pre',r.text),el('small','อ้างอิง: '+r.sources.map(x=>x.name||x.subject).join(', ')),button('ฟังผลสรุป',()=>speak(r.text)));note(r.truncated?'ข้อมูลบางส่วนถูกตัด กรุณาเปิดต้นฉบับประกอบ':'วิเคราะห์เสร็จแล้ว');
}
async function read(id){
 clearDetail('กำลังเปิดอีเมล…');const view=root,generation=detailEpoch,selectedConnection=connectionId;
 const r=await api('read?'+new URLSearchParams({action:'get',connectionId:selectedConnection,messageId:id}));if(!currentDetail(view,generation))return;
 current=r.message;const m=current,d=pane();d.replaceChildren(el('h2',m.subject||'(ไม่มีหัวข้อ)'),el('p','จาก '+m.from+' · '+m.date),el('pre',m.text));if(m.truncated)d.append(el('p','เนื้อหายาวเกินขอบเขตที่แสดง กรุณาเปิดต้นฉบับใน Gmail ประกอบ'));
 const base={connectionId:selectedConnection,messageId:m.id,expectedSubject:m.subject};
 d.append(button('อ่านให้ฟัง',()=>speak(m.subject+' จาก '+m.from+' '+m.text)),button('พักเสียง',()=>window.speechSynthesis?.pause()),button('อ่านต่อ',()=>window.speechSynthesis?.resume()),button('หยุด',stop),button('ตอบกลับ',()=>compose(m)),button('อ่านแล้ว',()=>review({...base,action:'mark_read'})),button('ยังไม่อ่าน',()=>review({...base,action:'mark_unread'})),button('ลบลงถังขยะ',()=>review({...base,action:'trash'})),button('กู้คืน',()=>review({...base,action:'restore'})));
 if(status.aiEnabled&&agentConnectionId)d.append(button('สรุปด้วย AI',()=>analyze(m)));
 for(const a of m.attachments||[]){d.append(el('p',a.name+' · '+a.size+' ไบต์'));if(status.aiEnabled&&agentConnectionId)d.append(button('วิเคราะห์ '+a.name,()=>analyze(m,a.id)));}
 const folders=await api('read?'+new URLSearchParams({action:'folders',connectionId:selectedConnection}));if(!currentDetail(view,generation))return;
 const mutable=folders.items.filter(f=>f.id==='INBOX'||/^Label_/.test(f.id)),sources=mutable.filter(f=>(m.folders||[]).includes(f.id));
 if(sources.length&&mutable.length>1){
  const source=el('select'),destination=el('select');source.setAttribute('aria-label','ป้ายต้นทาง');destination.setAttribute('aria-label','โฟลเดอร์ปลายทาง');
  for(const f of sources){const o=el('option',f.name);o.value=f.id;source.append(o);}if(sources.some(f=>f.id===folder))source.value=folder;
  const choices=()=>{destination.replaceChildren();for(const f of mutable.filter(f=>f.id!==source.value)){const o=el('option',f.name);o.value=f.id;destination.append(o);}};source.onchange=choices;choices();
  const sourceLabel=el('label','ย้ายจากป้าย'),destinationLabel=el('label','ไปยังป้าย');sourceLabel.append(source);destinationLabel.append(destination);d.append(sourceLabel,destinationLabel,button('ย้าย',()=>review({...base,action:'move',folderId:destination.value,sourceFolderId:source.value})));
 }
}
async function list(cursor=''){
 const view=root,generation=++listEpoch,selectedConnection=connectionId,query=root.querySelector('[data-search]')?.value||'';
 note('กำลังค้นหาอีเมล…');const r=await api('read?'+new URLSearchParams({action:'list',connectionId:selectedConnection,query,folderId:folder,cursor,limit:'20'}));
 if(root!==view||!view.isConnected||generation!==listEpoch||selectedConnection!==connectionId)return;
 const l=root.querySelector('[data-list]');if(!l)return;l.replaceChildren();
 for(const m of r.items){const b=button((m.unread?'● ':'')+(m.subject||'(ไม่มีหัวข้อ)')+'\n'+m.from,()=>read(m.id));b.className='mail-item';l.append(b);}
 nextCursor=r.nextCursor;if(nextCursor)l.append(button('หน้าถัดไป',()=>list(nextCursor)));if(!r.items.length)l.append(el('p','ไม่พบอีเมลที่ตรงกับการค้นหาหรือป้ายที่เลือก'));note('แสดง '+r.items.length+' ฉบับ'+(r.complete?'':' · ยังมีหน้าถัดไป'));
}
async function connectMailbox(provider,content,purpose='standard'){
 if(provider!=='google')throw Error('unsupported_mail_provider');
 const desktop=window.panthoriumDesktop?.isElectron===true;
 const android=window.Capacitor?.getPlatform?.()==='android'||/\bPanthoriumAndroid\b/i.test(navigator.userAgent);
 if(desktop&&typeof window.panthoriumDesktop.openMailboxOAuth!=='function')throw Error('กรุณาอัปเดต Panthorium Browser ก่อนเชื่อมอีเมล');
 const popup=desktop||android?null:window.open('about:blank','_blank');if(popup)popup.opener=null;
 try{
  const r=await api('connect','POST',{provider,purpose});
  if(desktop){const result=await window.panthoriumDesktop.openMailboxOAuth(r.url);if(!result?.ok)throw Error('เปิดเบราว์เซอร์เพื่อเชื่อมอีเมลไม่สำเร็จ');}
  else if(android){window.location.assign(r.url);}
  else if(popup){popup.location.href=r.url;}
  else{const a=el('a','เปิดหน้าอนุญาตเชื่อมต่อ');a.href=r.url;a.target='_blank';a.rel='noopener noreferrer';content.append(a);}
  oauthPending=true;
  note('อนุญาตในเบราว์เซอร์แล้วกลับมากดตรวจการเชื่อมต่อ');
 }catch(e){popup?.close();throw e;}
}
function renderAgentConsent(content,active){
 const section=el('section');section.setAttribute('aria-label','อีเมลด้วย AI และเสียง');section.append(el('h2','AI และคำสั่งเสียง'));
 if(!status.aiEnabled||!status.agentProviders?.includes(active.provider))section.append(el('p','กำลังเตรียมบริการ AI และคำสั่งเสียง คุณยังอ่าน ค้นหา ส่ง และจัดการอีเมลด้วยปุ่มได้ตามปกติ'));
 else if(!agentConnectionId){
  section.append(el('p','เชื่อมต่อเพิ่มเติมเพื่อให้ Sentinel อ่าน สรุป วิเคราะห์ไฟล์แนบ และจัดการอีเมลตามคำสั่งเสียงของคุณ'));
  section.append(button('เชื่อมต่อ AI และเสียง',()=>{
   section.replaceChildren(el('h3','อนุญาตการใช้อีเมลกับ AI และเสียง'),el('p','Sentinel AI ประมวลผลอีเมลและไฟล์แนบที่คุณสั่งใช้งานผ่าน Google Cloud หรือระบบภายในเฉพาะบัญชีที่ได้รับสิทธิ์ ไม่ใช้ฝึกโมเดลทั่วไป การส่ง ตอบกลับ ลบ หรือย้าย ต้องทบทวนและยืนยันแต่ละคำสั่ง คุณถอนการเชื่อมต่อ AI ได้ภายหลัง'));
   section.append(button('ดำเนินการต่อไปยังผู้ให้บริการ',()=>connectMailbox(active.provider,content,'agent')),button('ยกเลิก',render));
  }));
 }else{
  section.append(el('p','เชื่อมต่อ AI และเสียงแล้ว ลองพูด “สรุปอีเมลล่าสุดของฉัน” หรือ “ค้นหาอีเมลจาก…”'));
  const label=el('label','ผู้ประมวลผลสรุปอีเมล'),select=el('select');select.dataset.aiProvider='';
  for(const [value,text]of [['','Sentinel AI · อัตโนมัติ'],['gemini-live','Sentinel AI · ใช้เครดิตของบัญชี'],...(status.localAiAllowed ? [['local','Qwen 4B · สิทธิ์บริการภายใน']] : [])]){const o=el('option',text);o.value=value;select.append(o);}label.append(select);section.append(label);
  section.append(button('ถอนเฉพาะการเชื่อมต่อ AI และเสียง',()=>{section.replaceChildren(el('p','หยุดการเข้าถึงอีเมลผ่าน AI และเสียง? กล่องอีเมลปกติยังใช้ได้'));section.append(button('ยืนยันถอนการเชื่อมต่อ AI',async()=>{await api('connection?purpose=agent','DELETE');stop();await render();}),button('ยกเลิก',render));}));
 }
 content.append(section);
}
async function render(){
 const view=root,generation=++renderEpoch;const loaded=await api('status');if(root!==view||!view?.isConnected||generation!==renderEpoch)return;
 status=loaded;detailEpoch++;listEpoch++;stop();connectionId='';agentConnectionId='';current=null;
 const content=root.querySelector('[data-content]');content.replaceChildren();note('');
 content.append(el('p','ฟังก์ชันอีเมลรองรับเฉพาะ Gmail รวมถึง Google Workspace ที่เปิดใช้งาน Gmail โดยต้องตรงกับอีเมลที่ใช้สมัคร Panthorium ผู้ที่ไม่มีกล่อง Gmail ไม่สามารถใช้ฟังก์ชันนี้ได้'));
 if(!status.enabled){content.append(el('h2','ยังไม่พร้อมเชื่อมต่ออีเมล'),el('p','ระบบยังตั้งค่าการเชื่อมต่อ Gmail ไม่ครบ จึงยังตรวจสอบหรืออ่านอีเมลของคุณไม่ได้'),el('p','สถานะนี้ไม่ได้หมายความว่ากล่องอีเมลของคุณว่าง'),button('ตรวจสอบอีกครั้ง',render));return;}
 const connections=(status.connections||[]).filter(c=>c.provider==='google'),active=connections.find(c=>!c.reconnectRequired&&c.purpose!=='agent');
 if(!active){
  content.append(el('h2',connections.length?'เชื่อมต่ออีเมลอีกครั้ง':'เชื่อมต่ออีเมลที่ใช้สมัคร'),el('p',status.email),el('p','อนุญาตให้ Panthorium อ่าน ค้นหา ส่ง ตอบกลับ และจัดการ Gmail ของบัญชีนี้ คุณถอนการเชื่อมต่อได้ภายหลัง การสรุปด้วย AI จะประมวลผลเนื้อหาที่เลือกเมื่อคุณสั่งใช้งาน'));
  if(status.providers?.includes('google'))content.append(button('เชื่อม Gmail / Google Workspace',()=>connectMailbox('google',content)));
  else content.append(el('p','ผู้ดูแลยังไม่ได้ตั้งค่าการเชื่อมต่อ Gmail'));
  content.append(button('ตรวจการเชื่อมต่อ',render),button('ไว้ภายหลัง',()=>{if(typeof closeWindow==='function')closeWindow(ID);}));return;
 }
 connectionId=active.id;agentConnectionId=connections.find(c=>c.purpose==='agent'&&c.email.toLowerCase()===active.email.toLowerCase()&&!c.reconnectRequired)?.id||'';
 content.append(el('p',active.email));renderAgentConsent(content,active);
 const bar=el('nav'),search=el('input');search.dataset.search='';search.placeholder='ค้นหาผู้ส่งหรือหัวข้อ';search.setAttribute('aria-label','ค้นหาอีเมล');
 const searchMail=()=>{clearDetail();return list();};search.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();run(searchMail);}};
 bar.append(search,button('ค้นหา',searchMail),button('ตรวจการเชื่อมต่อ',render),button('เขียนอีเมล',()=>compose()),button('ฉบับร่าง',async()=>{
  clearDetail('กำลังเปิดฉบับร่าง…');const detail=detailEpoch,r=await api('drafts');if(!currentDetail(view,detail))return;const d=pane();d.replaceChildren(el('h2','ฉบับร่างใน Panthorium'));if(!r.items.length)d.append(el('p','ยังไม่มีฉบับร่าง'));for(const x of r.items)d.append(button(x.subject||'(ไม่มีหัวข้อ)',()=>compose(null,x)));
 }),button('ถอนการเชื่อมต่อ',()=>{
  clearDetail();const d=pane();d.replaceChildren(el('p','ถอนการเชื่อมต่อและลบฉบับร่างที่เก็บใน Panthorium? อีเมลต้นฉบับยังคงอยู่'));d.append(button('ยืนยันถอนการเชื่อมต่อ',async()=>{await api('connection','DELETE');stop();await render();}),button('ยกเลิก',()=>clearDetail()));
 }));content.append(bar);
 const folderSelect=el('select');folderSelect.setAttribute('aria-label','กล่องอีเมล');const all=el('option','อีเมลทั้งหมด ยกเว้นสแปมและถังขยะ');all.value='';folderSelect.append(all);
 const layout=el('div');layout.className='mail-layout';const l=el('section');l.dataset.list='';l.setAttribute('aria-label','รายการอีเมล');const d=el('article','เลือกอีเมลเพื่ออ่าน');d.dataset.detail='';layout.append(l,d);content.append(layout);
 const fs=await api('read?'+new URLSearchParams({action:'folders',connectionId}));if(root!==view||!view.isConnected||generation!==renderEpoch)return;
 for(const f of fs.items){const o=el('option',f.name);o.value=f.id;folderSelect.append(o);}if(!fs.items.some(f=>f.id===folder))folder='';folderSelect.value=folder;
 folderSelect.onchange=()=>{folder=folderSelect.value;clearDetail();run(()=>list());};bar.append(folderSelect);
 await list();
}
async function open(){if(!allowed())return false;if(os()?.windows?.has(ID)){window.PanthoriumWindowManager?.restore?.(ID);return true;}createWindow(ID,'✉ อีเมลของฉัน','<div data-user-mailbox><style>[data-user-mailbox]{padding:20px;background:#101a2a;color:#edf4ff;height:100%;overflow:auto;font:14px system-ui}[data-user-mailbox] nav{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}[data-user-mailbox] button,[data-user-mailbox] input,[data-user-mailbox] select,[data-user-mailbox] textarea{font:inherit;padding:10px;border-radius:8px;background:#20314c;color:inherit;border:1px solid #516582;margin:3px;max-width:100%;box-sizing:border-box}[data-user-mailbox] button{cursor:pointer}[data-user-mailbox] button:disabled{opacity:.6;cursor:wait}[data-user-mailbox] pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.65}[data-user-mailbox] .mail-layout{display:grid;grid-template-columns:minmax(200px,1fr) minmax(260px,2fr);gap:16px}[data-user-mailbox] .mail-item{display:block;width:100%;text-align:left;white-space:pre-wrap}[data-user-mailbox] label{display:grid;gap:4px}[data-user-mailbox] textarea{min-height:180px}[data-user-mailbox] [role=status]{color:#b9dfff}[data-user-mailbox] article{min-width:0}@media(max-width:700px){[data-user-mailbox] .mail-layout{grid-template-columns:1fr}}</style><h1>อีเมลของฉัน</h1><p role="status" aria-live="polite"></p><div data-content></div></div>');root=document.querySelector('[data-user-mailbox]');await run(render);return true;}
async function authChanged(){const user=uid();if(user!==lastUser){epoch++;stop();root?.replaceChildren();if(os()?.windows?.has(ID)&&typeof closeWindow==='function')closeWindow(ID);root=null;checked='';lastUser=user;folder='';connectionId='';agentConnectionId='';renderEpoch++;detailEpoch++;listEpoch++;oauthPending=false;current=null;status=null;}const menu=document.getElementById('sm-apps');if(!allowed()){menu?.querySelector('[data-app-id="'+ID+'"]')?.remove();return;}if(menu&&!menu.querySelector('[data-app-id="'+ID+'"]')){const b=button('✉ อีเมล',open);b.className='sm-app';b.dataset.appId=ID;menu.append(b);}if(checked===user)return;checked=user;try{const s=await api('status');if(s.enabled&&s.onboardingRequired){if(typeof toast==='function')toast(s.connections.length?'กรุณาเชื่อมต่ออีเมลอีกครั้ง':'กรุณาเชื่อมต่ออีเมลที่ใช้สมัคร Panthorium');await open();}}catch{checked='';}}
function refreshAfterConsent(){if(oauthPending&&root?.isConnected&&document.visibilityState!=='hidden'){oauthPending=false;run(render);}}
window.addEventListener('focus',refreshAfterConsent);document.addEventListener('visibilitychange',refreshAfterConsent);window.addEventListener('pageshow',refreshAfterConsent);
window.PanthoriumUserMailbox={open,refresh:()=>run(render),stop,authChanged};window.addEventListener('panthorium:auth-changed',()=>run(authChanged));window.addEventListener('pagehide',stop);let tries=0;const timer=setInterval(()=>{if(allowed()||++tries>30){clearInterval(timer);run(authChanged);}},1000);
})();
