(function(){
  'use strict';
  const os=()=>{try{return typeof OS!=='undefined'?OS:null;}catch{return null;}};
  const account=()=>{const u=os()?.state?.user;const id=String(u?.sub||u?.id||'');return id&&!id.startsWith('guest:')&&!u?.roles?.includes('guest')?id:'';};
  const uuid=()=>crypto.randomUUID();
  const size=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const labels={queued:'รออุปกรณ์',awaiting_confirmation:'รอยืนยัน',running:'กำลังทำงาน',succeeded:'สำเร็จ',failed:'ไม่สำเร็จ',cancel_requested:'กำลังขอหยุด',cancelled:'ยกเลิกแล้ว',expired:'หมดอายุ',unknown:'ต้องตรวจผลบนอุปกรณ์'};
  const scopeLabels={'files.read':'อ่านไฟล์','files.write':'สร้างและแก้ไขไฟล์','files.delete':'ลบไฟล์','chat.sync':'ซิงค์ประวัติแชท','browser.open':'เปิดเว็บไซต์','process.run':'รันโปรแกรมและคำสั่ง','desktop.control':'ดูและควบคุมหน้าจอ (Windows)'};
  const errorText={personal_storage_full:'พื้นที่ของบัญชีเต็มแล้ว กรุณาส่งออกหรือลบข้อมูล หรือเพิ่มแพ็กเกจก่อนบันทึกเพิ่ม',chat_version_conflict:'แชทนี้เปลี่ยนจากอีกอุปกรณ์ กรุณาเปิดข้อมูลล่าสุดก่อนแก้ไข',personal_chat_too_large:'แชทนี้ยาวถึงขีดจำกัดแล้ว กรุณาส่งออกและเริ่มแชทใหม่',chat_vault_unavailable:'อุปกรณ์ที่เก็บแชทยังไม่พร้อม กรุณาตรวจการเชื่อมต่อ',chat_has_active_jobs:'แชทนี้มีงานที่ยังไม่จบ กรุณาหยุดงานก่อนลบ',local_permission_required:'ต้องเปิดสิทธิ์นี้จากคอมพิวเตอร์ปลายทางก่อน',device_permission_denied:'อุปกรณ์ยังไม่ได้อนุญาตความสามารถนี้',secure_device_storage_unavailable:'เครื่องนี้ยังไม่มีพื้นที่เก็บกุญแจที่ปลอดภัย จึงยังเปิดการรับงานไม่ได้',device_already_paired:'เครื่องนี้จับคู่แล้ว ใช้ปุ่มเปิดรับงานหรือยกเลิกการเชื่อมต่อเดิมก่อน',account_changed:'บัญชีเปลี่ยนแล้ว กรุณาเปิดแชทของบัญชีปัจจุบัน',personal_vault_unavailable:'บันทึกประวัติบนอุปกรณ์นี้ไม่ได้ กรุณาเปิดพื้นที่จัดเก็บของเบราว์เซอร์'};
  let dbPromise,active=null,identity='',queue=Promise.resolve(),quota=null,metadata=[],devices=[],jobs=[],pending=0,pollTimer=null,mounted=null,unsaved=null;
  const vaultId=()=>{const key='panthorium-personal-vault-id';let id=localStorage.getItem(key);if(!id){id='browser:'+uuid();localStorage.setItem(key,id);}return id;};
  const key=(uid,id)=>uid+'|'+id;
  const storageKey=suffix=>'panthorium-personal:'+account()+':'+suffix;
  const message=e=>errorText[e?.message]||'ทำรายการไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วลองใหม่';
  function notify(e){const text=typeof e==='string'?e:message(e);if(typeof toast==='function')toast(text,9000);const banner=document.querySelector('.personal-notice');if(banner){banner.textContent=text;banner.hidden=false;}}
  function element(tag,attrs={},children=[]) {const node=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(k==='text')node.textContent=v;else if(k==='class')node.className=v;else if(k.startsWith('on'))node.addEventListener(k.slice(2),v);else if(v!==null&&v!==undefined)node.setAttribute(k,String(v));}for(const child of children)node.append(child);return node;}
  const button=(text,click,attrs={})=>element('button',{type:'button',text,onclick:click,...attrs});
  async function db(){if(!window.indexedDB)throw Error('personal_vault_unavailable');if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open('panthorium-personal-vault-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('chats',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('personal_vault_unavailable'));});return dbPromise;}
  async function store(mode,operation){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('chats',mode),request=operation(tx.objectStore('chats'));let value;request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(Error('personal_vault_unavailable'));tx.onabort=()=>reject(Error('personal_vault_unavailable'));});}
  const getLocal=(uid,id)=>store('readonly',s=>s.get(key(uid,id)));
  const putLocal=thread=>store('readwrite',s=>s.put({...thread,key:key(thread.owner,thread.id)}));
  const removeLocal=(uid,id)=>store('readwrite',s=>s.delete(key(uid,id)));
  async function api(route,{method='GET',body,legacy=false}={}) {
    const uid=account();if(!uid)throw Error('account_required');
    await window.PanthoriumAuth?.ensureSession?.();
    if(uid!==account())throw Error('account_changed');
    const token=window.PanthoriumAuth?.getAccessToken?.()||os()?.config?.accessToken;
    const response=await fetch((window.PanthoriumAuth?.getBackendUrl?.()||'').replace(/\/$/,'')+(legacy?'/api':'/api/remote')+route,{method,credentials:'include',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});
    const data=await response.json();if(uid!==account())throw Error('account_changed');if(!response.ok||!data.ok)throw Error(data.error||'remote_workspace_unavailable');return data;
  }
  function serial(fn){const task=queue.catch(()=>{}).then(fn);queue=task;return task;}
  function assertOwner(uid){if(uid!==account())throw Error('account_changed');}
  function setActive(thread){assertOwner(thread.owner);active=thread;identity=thread.owner;os().config.sessionId=thread.id;localStorage.setItem(storageKey('active'),thread.id);}
  async function ensureActive(){const uid=account();if(!uid)return null;if(active?.owner===uid)return active;
    const id=localStorage.getItem(storageKey('active'));let thread=id?await getLocal(uid,id):null;assertOwner(uid);
    if(!thread)thread={id:'personal-'+uuid(),owner:uid,title:'แชทใหม่',createdAt:Date.now(),updatedAt:Date.now(),messages:[],serverVersion:0,vaultId:localStorage.getItem(storageKey('target'))||vaultId(),channel:'text'};
    setActive(thread);return thread;
  }
  function archive(thread){const {key:ignored,...data}=thread;return data;}
  async function save(thread,{sync=true}={}) {
    assertOwner(thread.owner);const value=archive(thread);const bytes=size(value);
    if(bytes>500*1024)throw Error('personal_chat_too_large');
    const result=await api('/chats/'+thread.id,{method:'PUT',body:{title:thread.title,bytes,version:thread.serverVersion||0,channel:thread.channel,vaultId:thread.vaultId}});
    const prior=await getLocal(thread.owner,thread.id);thread.serverVersion=result.thread.version;thread.updatedAt=result.thread.updatedAt;
    try{await putLocal(thread);}catch(e){
      // Roll back the accounting reservation if the owner's disk write failed.
      try{if(prior)await api('/chats/'+thread.id,{method:'PUT',body:{title:prior.title,bytes:size(archive(prior)),version:thread.serverVersion,channel:prior.channel,vaultId:prior.vaultId}});else await api('/chats/'+thread.id,{method:'DELETE'});}catch{}
      throw e;
    }
    quota=result.quota;metadata=[result.thread,...metadata.filter(t=>t.id!==thread.id)];
    if(active?.id===thread.id)setActive(thread);unsaved=null;renderList();renderQuota();
    if(sync&&thread.vaultId.startsWith('device:')) {
      try{await api('/chats/'+thread.id+'/sync',{method:'POST',body:{content:JSON.stringify(archive(thread))}});}
      catch(e){notify('บันทึกบนอุปกรณ์นี้แล้ว แต่ยังซิงค์ไปเครื่องที่เก็บแชทไม่ได้ กรุณาเปิดแชทนี้แล้วลองซิงค์อีกครั้ง');}
    }
    return thread;
  }
  async function begin(prompt,source='text'){const uid=account(),initial=active?.owner===uid?structuredClone(active):null;return serial(async()=>{assertOwner(uid);const thread=initial?(await getLocal(uid,initial.id)||initial):await ensureActive();if(!thread)return null;const next=structuredClone(thread);
    next.messages.push({id:uuid(),role:'user',content:String(prompt),source,at:Date.now()});
    if(next.title==='แชทใหม่')next.title=String(prompt).trim().replace(/\s+/g,' ').slice(0,80)||'แชทใหม่';
    next.channel=next.messages.every(m=>m.source===source)?source:'mixed';
    try{await save(next);}catch(e){unsaved=next;throw e;}pending++;return {id:next.id,owner:next.owner};});}
  async function finish(ref,result,source='text'){if(!ref)return;return serial(async()=>{try{assertOwner(ref.owner);const thread=await getLocal(ref.owner,ref.id);if(!thread)return;
      if(result?.text)thread.messages.push({id:uuid(),role:'assistant',content:String(result.text),source,at:Date.now(),toolResults:(result.toolResults||[]).filter(r=>r.toolId?.startsWith('remote.')).map(r=>({toolId:r.toolId,ok:r.ok,jobId:r.output?.id||null}))});
      try{await save(thread);}catch(e){unsaved=thread;notify(e);}
      refreshJobs().catch(()=>{});
    }finally{pending=Math.max(0,pending-1);}});}
  function requestHistory(){if(!active||active.owner!==account())return undefined;const list=active.messages.slice();if(list.at(-1)?.role==='user')list.pop();
    const result=[];let bytes=0;for(const m of list.slice(-40).reverse()){const item={role:m.role,content:m.content.slice(-24000)},n=size(item);if(bytes+n>90000)break;bytes+=n;result.unshift(item);}return result;}
  async function recordVoice(input,output){if(!account())return;const ref=await begin(input||'สนทนาด้วยเสียง','voice');await finish(ref,{text:output||''},'voice');}
  async function fresh(){if(pending){notify('รอคำตอบปัจจุบันก่อนเริ่มแชทใหม่');return;}window.PanthoriumLiveVoice?.stop?.();window.PanthoriumHybridVoice?.stop?.();active=null;localStorage.removeItem(storageKey('active'));await ensureActive();renderMessages();renderList();document.getElementById('chat-input')?.focus();}
  async function refresh(){if(!account())return;const uid=account();const [q,t,d]=await Promise.all([api('/quota'),api('/chats'),api('/devices')]);assertOwner(uid);quota=q.quota;metadata=t.chats;devices=d.devices;renderList();renderQuota();await refreshJobs();}
  async function refreshJobs(){if(!account())return;const ref=active&&{id:active.id,owner:active.owner};const result=await api('/jobs'+(ref?'?chatId='+encodeURIComponent(ref.id):''));if(ref&&active?.id!==ref.id)return;jobs=result.jobs;renderJobs();
    if(ref&&!pending)for(const job of jobs.filter(j=>['succeeded','failed','cancelled','unknown'].includes(j.state)&&!['ซิงค์ประวัติแชท','เปิดประวัติแชท'].includes(j.title))) {
      if(active.messages.some(m=>m.jobId===job.id))continue;
      const detail=await api('/jobs/'+job.id);
      await serial(async()=>{assertOwner(ref.owner);const thread=await getLocal(ref.owner,ref.id);if(!thread||thread.messages.some(m=>m.jobId===job.id))return;
        const outputs=detail.job.result?.steps?.map(s=>({op:s.op,output:s.output?.image?{screenshot:true}:s.output}));
        thread.messages.push({id:uuid(),jobId:job.id,role:'assistant',source:'task',at:Date.now(),content:job.title+' · '+(labels[job.state]||job.state)+(outputs?'\n'+JSON.stringify(outputs,null,2).slice(0,18000):'')});
        try{await save(thread);if(active?.id===thread.id)renderMessages();}catch(e){unsaved=thread;notify(e);}
      });
    }
  }
  function renderQuota(){const root=document.querySelector('.personal-quota');if(!root||!quota)return;
    const gib=n=>n>=1024**3?(n/1024**3).toFixed(2)+' GiB':(n/1024**2).toFixed(1)+' MiB';const ratio=quota.limitBytes?Math.min(100,quota.usedBytes/quota.limitBytes*100):100;
    root.dataset.status=quota.status;root.textContent='พื้นที่ '+gib(quota.usedBytes)+' / '+gib(quota.limitBytes)+' · '+quota.plan;
    root.title='ไฟล์และความจำอยู่ในพื้นที่ของคุณ โควต้านี้แยกตามบัญชีและแพ็กเกจ';
    if(quota.status!=='normal')notify(quota.status==='full'?errorText.personal_storage_full:'พื้นที่บัญชีใกล้เต็ม ('+ratio.toFixed(0)+'%) กรุณาสำรองข้อมูลหรือตรวจแพ็กเกจ');
  }
  function renderMessages(){const root=document.getElementById('chat-messages');if(!root||!active)return;root.replaceChildren();
    if(!active.messages.length)root.append(element('div',{class:'msg ai',text:'เริ่มแชทใหม่กับ Sentinel AI พิมพ์หรือพูดเพื่อสั่งงานได้เลย'}));
    for(const m of active.messages)root.append(element('div',{class:'msg '+(m.role==='user'?'user':'ai'),text:(m.source==='voice'?'🎙 ':'')+m.content}));root.scrollTop=root.scrollHeight;
  }
  function renderList(){const root=document.querySelector('.personal-history-list');if(!root)return;const query=document.querySelector('.personal-search')?.value.toLowerCase()||'';root.replaceChildren();
    const list=metadata.filter(t=>t.title.toLowerCase().includes(query));
    if(!list.length)root.append(element('p',{text:'แชทที่บันทึกไว้จะแสดงที่นี่'}));
    for(const t of list){const row=element('div',{class:'personal-thread'+(active?.id===t.id?' active':'')});row.append(button((t.channel!=='text'?'🎙 ':'')+t.title,()=>openThread(t).catch(notify),{class:'personal-thread-title'}));
      row.append(element('small',{text:new Date(t.updatedAt).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'})+(t.vaultId.startsWith('device:')?' · เก็บบนคอม':' · เก็บบนอุปกรณ์นี้')}));
      row.append(button('ส่งออก',()=>exportThread(t).catch(notify)),button('เปลี่ยนชื่อ',()=>rename(t).catch(notify)),button('ลบ',()=>remove(t).catch(notify)));root.append(row);}
  }
  async function retrieve(t){const proposal=await api('/chats/'+t.id+'/retrieve',{method:'POST'});if(proposal.job.state==='awaiting_confirmation'){await reviewJob(proposal.job);throw Error('chat_vault_unavailable');}
    notify('กำลังเรียกประวัติจากอุปกรณ์ของคุณ');const uid=account();
    for(let i=0;i<25;i++){assertOwner(uid);const {job}=await api('/jobs/'+proposal.job.id);if(job.state==='succeeded'){
      const output=job.result?.steps?.find(s=>s.op==='chat.read')?.output;const data=JSON.parse(output?.content||'null');
      if(!data||data.owner!==uid||data.id!==t.id||data.serverVersion!==t.version||!validArchive(data))throw Error('chat_version_conflict');await putLocal(data);return data;
    }if(['failed','expired','cancelled','unknown'].includes(job.state))throw Error('chat_vault_unavailable');await new Promise(resolve=>setTimeout(resolve,1200));}throw Error('chat_vault_unavailable');
  }
  async function localOrRemote(t){let thread=await getLocal(account(),t.id);if((!thread||thread.serverVersion!==t.version)&&t.vaultId.startsWith('device:'))thread=await retrieve(t);if(!thread)throw Error('chat_vault_unavailable');return thread;}
  async function openThread(t){if(pending){notify('รอคำตอบปัจจุบันก่อนเปลี่ยนแชท');return;}window.PanthoriumLiveVoice?.stop?.();const thread=await localOrRemote(t);setActive(thread);renderMessages();renderList();document.querySelector('.personal-history')?.setAttribute('hidden','');await refreshJobs();}
  function download(value,name){const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=element('a',{href:url,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function exportThread(t){const thread=unsaved?.id===t.id?unsaved:await localOrRemote(t);download({format:'panthorium-personal-chat-v1',chat:archive(thread)},'Panthorium-chat-'+t.id+'.json');}
  async function rename(t){const title=prompt('ชื่อแชท',t.title);if(!title?.trim())return;const thread=await localOrRemote(t);thread.title=title.trim().slice(0,120);await serial(()=>save(thread));}
  async function remove(t){if(!confirm('ลบรายการแชทนี้และสำเนาบนเบราว์เซอร์นี้? ไฟล์งาน สำเนาแชทบนคอม และสำเนาที่ส่งออกไว้ยังอยู่'))return;
    await api('/chats/'+t.id,{method:'DELETE'});await removeLocal(account(),t.id);metadata=metadata.filter(x=>x.id!==t.id);if(active?.id===t.id)await fresh();await refresh();}
  function validArchive(t){return t&&/^personal-[0-9a-f-]{36}$/i.test(t.id)&&typeof t.owner==='string'&&typeof t.title==='string'&&t.title.length<=120&&Array.isArray(t.messages)&&t.messages.length<=2000&&size(t)<500*1024&&t.messages.every(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string'&&m.content.length<=100000);}
  async function importChat(file){if(!file||file.size>600*1024)throw Error('personal_chat_too_large');const data=JSON.parse(await file.text());if(data.format!=='panthorium-personal-chat-v1'||!validArchive(data.chat))throw Error('invalid_personal_chat');
    // Import is a new owned copy; a backup cannot overwrite another account/thread.
    const thread={...data.chat,owner:account(),id:'personal-'+uuid(),serverVersion:0,vaultId:localStorage.getItem(storageKey('target'))||vaultId(),createdAt:Date.now(),updatedAt:Date.now()};await serial(()=>save(thread));setActive(thread);renderMessages();}
  async function legacyHistory(){const {sessions}=await api('/conversations?limit=100',{legacy:true});const {body}=dialog('ประวัติก่อนอัปเดต');
    if(!sessions.length)body.append(element('p',{text:'ไม่มีประวัติก่อนอัปเดตของบัญชีนี้'}));
    for(const item of sessions)body.append(button((item.updatedAt?new Date(item.updatedAt).toLocaleString('th-TH')+' · ':'')+item.sessionId,async()=>{try{
      const data=await api('/conversations/'+encodeURIComponent(item.sessionId)+'?limit=100',{legacy:true});const view=dialog('ประวัติก่อนอัปเดต');
      for(const m of data.messages)view.body.append(element('p',{text:(m.role==='user'?'คุณ: ':'Sentinel AI: ')+m.content}));
      view.body.append(button('คัดลอกไปแชทใหม่',async()=>{try{const thread={id:'personal-'+uuid(),owner:account(),title:String(data.messages.find(m=>m.role==='user')?.content||'ประวัติก่อนอัปเดต').slice(0,80),createdAt:Date.now(),updatedAt:Date.now(),serverVersion:0,vaultId:localStorage.getItem(storageKey('target'))||vaultId(),channel:'text',messages:data.messages.map(m=>({id:uuid(),role:m.role,content:m.content,source:'text',at:Date.parse(m.createdAt)||Date.now()}))};await serial(()=>save(thread));setActive(thread);renderMessages();view.node.close();}catch(e){notify(e);}}));
    }catch(e){notify(e);}}));
  }
  function dialog(title){const node=element('dialog',{class:'personal-dialog'}),body=element('div',{class:'personal-dialog-body'});node.append(element('header',{},[element('strong',{text:title}),button('ปิด',()=>node.close())]),body);document.body.append(node);node.addEventListener('close',()=>node.remove(),{once:true});node.showModal();return {node,body};}
  async function devicePanel(){await refresh();const {body}=dialog('อุปกรณ์และพื้นที่ส่วนตัว');body.append(element('p',{text:'ไฟล์งานและความจำเก็บในพื้นที่ของคุณ Panthorium ใช้ข้อมูลชั่วคราวเพื่อส่งงานและแสดงผล'}));
    const select=element('select',{'aria-label':'พื้นที่เก็บประวัติแชทใหม่'});select.append(element('option',{value:vaultId(),text:'อุปกรณ์/เบราว์เซอร์ที่ใช้อยู่'}));for(const d of devices.filter(d=>d.scopes.includes('chat.sync')))select.append(element('option',{value:'device:'+d.id,text:d.name+' · เรียกแชทจากอุปกรณ์อื่นได้เมื่อออนไลน์'}));
    select.value=localStorage.getItem(storageKey('target'))||vaultId();select.onchange=()=>localStorage.setItem(storageKey('target'),select.value);body.append(element('label',{text:'เก็บแชทใหม่ที่'}),select,element('small',{text:'การเปลี่ยนที่เก็บมีผลกับแชทใหม่ สำรองข้อมูลก่อนล้างเบราว์เซอร์หรือเปลี่ยนเครื่อง'}));
    for(const d of devices){const row=element('section',{class:'personal-device'});row.append(element('strong',{text:d.name}),element('p',{text:(d.online?'ออนไลน์':'ออฟไลน์')+' · '+d.platform}),element('small',{text:d.scopes.map(s=>scopeLabels[s]||s).join(' · ')}));
      row.append(button('หยุดการอนุญาตอัตโนมัติ',async()=>{try{await api('/devices/'+d.id,{method:'PATCH',body:{autoScopes:[]}});notify('งานถัดไปจะรอให้ยืนยันก่อน');}catch(e){notify(e);}}),button('ยกเลิกการเชื่อมต่อ',async()=>{if(confirm('ยกเลิกการรับงานระยะไกลของ '+d.name+'?'))try{await api('/devices/'+d.id,{method:'PATCH',body:{revoke:true}});row.remove();}catch(e){notify(e);}}));body.append(row);}
    const native=window.panthoriumDesktop;
    if(native?.connectRemote){const state=await native.remoteStatus();if(state.deviceId){body.append(button(state.enabled?'พักรับงานบนเครื่องนี้':'เปิดรับงานบนเครื่องนี้',async()=>{const r=await native.pauseRemote(state.enabled);r.ok?notify('ปรับการรับงานแล้ว'):notify(Error(r.error));}),button('ถอนการจับคู่เครื่องนี้',async()=>{if(!confirm('ยกเลิกการจับคู่คอมนี้?'))return;const r=await native.disconnectRemote();r.ok?notify('ถอนการจับคู่แล้ว'):notify(Error(r.error));}));}
      else{const name=element('input',{placeholder:'ชื่อเครื่อง เช่น คอมที่บ้าน',value:'คอมของฉัน','aria-label':'ชื่อคอมพิวเตอร์'});const checks={};body.append(name);
        for(const scope of Object.keys(scopeLabels)){const box=element('input',{type:'checkbox'});box.checked=['files.read','files.write','chat.sync','browser.open'].includes(scope);checks[scope]=box;body.append(element('label',{class:'personal-check'},[box,document.createTextNode(scopeLabels[scope])]));}
        const automatic=element('input',{type:'checkbox'});body.append(element('label',{class:'personal-check'},[automatic,document.createTextNode('อนุญาตให้ทำงานตามสิทธิ์ที่เลือกได้อัตโนมัติ')]));
        body.append(button('เชื่อมและเปิดรับงานบนเครื่องนี้',async()=>{const scopes=Object.keys(checks).filter(s=>checks[s].checked);const r=await native.connectRemote({token:window.PanthoriumAuth?.getAccessToken?.()||os()?.config?.accessToken,name:name.value,scopes,autoScopes:automatic.checked?scopes:scopes.filter(s=>['files.read','chat.sync'].includes(s))});if(r.ok&&!r.cancelled){notify('เครื่องนี้พร้อมรับงานแล้ว');await refresh();}else if(!r.cancelled)notify(Error(r.error));}));}}
    else body.append(element('p',{text:'บนคอมที่จะให้ทำงาน ให้เปิด Panthorium Browser รุ่นล่าสุด แล้วเลือก “เชื่อมและเปิดรับงานบนเครื่องนี้” จากหน้านี้'}),button('ดาวน์โหลด Panthorium Browser',()=>{if(typeof openStartMenu==='function')openStartMenu();else window.open('https://github.com/rambo4075krub/Panthorium/releases/tag/staging','_blank','noopener');}));
    const code=element('input',{placeholder:'รหัสจับคู่อุปกรณ์ 12 ตัว',maxlength:'12','aria-label':'รหัสจับคู่'});body.append(code,button('ตรวจและจับคู่ด้วยรหัส',async()=>{try{const info=await api('/pairing/inspect',{method:'POST',body:{code:code.value.trim()}});if(confirm('จับคู่ '+info.name+' ('+info.platform+')\nสิทธิ์: '+info.scopes.map(s=>scopeLabels[s]).join(', ')))await api('/pairing/confirm',{method:'POST',body:{code:code.value.trim()}});await refresh();}catch(e){notify(e);}}));
  }
  function renderJobs(){const root=document.querySelector('.personal-jobs');if(!root)return;root.replaceChildren();const visible=jobs.filter(j=>!['ซิงค์ประวัติแชท','เปิดประวัติแชท'].includes(j.title));if(!visible.length)return;
    root.append(element('summary',{text:'งานในแชทนี้ · '+visible.length}));for(const job of visible.slice(0,20))root.append(button(job.title+' · '+(labels[job.state]||job.state),()=>reviewJob(job).catch(notify),{class:'personal-job'}));
  }
  async function reviewJob(reference){const {job}=await api('/jobs/'+reference.id),{body,node}=dialog(job.title);body.append(element('p',{text:(labels[job.state]||job.state)+' · '+job.deviceName}));
    if(job.steps)body.append(element('pre',{text:JSON.stringify(job.steps,null,2)}));
    if(job.result)body.append(element('pre',{text:JSON.stringify(job.result,null,2)}));else if(!job.resultAvailable&&['succeeded','failed','unknown'].includes(job.state))body.append(element('p',{text:'ผลที่ส่งผ่านระบบกลางมีอายุ 15 นาที ผลที่บันทึกไว้ดูได้ในแชทและไฟล์งานบนเครื่องของคุณ'}));
    if(job.state==='awaiting_confirmation')body.append(button('ยืนยันให้ทำงานตามรายละเอียดนี้',async()=>{try{await api('/jobs/'+job.id+'/approve',{method:'POST',body:{approvalHash:job.approvalHash}});node.close();await refreshJobs();}catch(e){notify(e);}}));
    if(['queued','awaiting_confirmation','running','unknown'].includes(job.state))body.append(button('หยุดงาน',async()=>{try{await api('/jobs/'+job.id+'/cancel',{method:'POST'});node.close();await refreshJobs();}catch(e){notify(e);}}));
  }
  async function mount(){const container=document.querySelector('#chat-messages')?.parentElement;if(!container||!account())return;if(mounted===container)return;mounted=container;container.classList.add('personal-chat');
    const top=element('div',{class:'personal-toolbar'}),history=element('aside',{class:'personal-history',hidden:'','aria-label':'ประวัติแชท Sentinel AI'});
    const search=element('input',{class:'personal-search',type:'search',placeholder:'ค้นหาแชท','aria-label':'ค้นหาประวัติแชท',oninput:renderList});history.append(search,element('div',{class:'personal-history-list'}));
    const importInput=element('input',{type:'file',accept:'.json',hidden:''});importInput.onchange=()=>importChat(importInput.files?.[0]).catch(notify);
    history.append(button('ประวัติก่อนอัปเดต',()=>legacyHistory().catch(notify)),button('นำเข้าข้อมูลแชท',()=>importInput.click()),importInput,button('ส่งออกแชทปัจจุบัน',()=>{if(active)exportThread(active).catch(notify);}));
    top.append(button('รายการแชท',()=>{history.hidden=!history.hidden;}),button('＋ แชทใหม่',()=>fresh().catch(notify)),button('อุปกรณ์ของฉัน',()=>devicePanel().catch(notify)),button('พื้นที่',()=>{renderQuota();devicePanel().catch(notify);}));
    const notice=element('div',{class:'personal-notice',role:'status',hidden:''});const meter=element('div',{class:'personal-quota'});const taskList=element('details',{class:'personal-jobs'});
    container.prepend(top,meter,notice,history,taskList);await ensureActive();if(active.messages.length)renderMessages();await refresh().catch(notify);
    clearInterval(pollTimer);pollTimer=setInterval(()=>{if(account()&&document.getElementById('chat-messages')&&document.visibilityState!=='hidden')refreshJobs().catch(()=>{});},12000);
  }
  async function command(text){const value=String(text).trim().replace(/[.!?]/g,'');if(/^(แชทใหม่|เริ่มแชทใหม่|new chat)$/i.test(value)){await fresh();return {ok:true,text:'เปิดแชทใหม่แล้ว'};}
    if(/^(เปิดรายการแชท|ประวัติแชท|รายการแชท|chat history)$/i.test(value)){if(typeof openSentinel==='function')openSentinel();await mount();const history=document.querySelector('.personal-history');if(history)history.hidden=false;return {ok:true,text:'เปิดรายการแชทแล้ว'};}
    if(/^(เปิดอุปกรณ์ของฉัน|อุปกรณ์ของฉัน|my devices)$/i.test(value)){await devicePanel();return {ok:true,text:'เปิดอุปกรณ์ของฉันแล้ว'};}return null;}
  function install(){if(typeof callAI==='function'&&!callAI.__personalChats){const previous=callAI;const wrapped=async(prompt,options={})=>{
      if(!account()||options.voiceMode||pending)return previous(prompt,options);options={...options,requestId:options.requestId||uuid()};let ref;try{ref=await begin(prompt,options.conversationalVoice?'voice':'text');const result=await previous(prompt,options);if(ref?.owner!==account())return {ok:false,text:errorText.account_changed};await finish(ref,result,options.conversationalVoice?'voice':'text');return result;}
      catch(e){if(ref)pending=Math.max(0,pending-1);notify(e);return {ok:false,text:message(e),error:e.message};}};wrapped.__personalChats=true;wrapped.__panthoriumStreaming=previous.__panthoriumStreaming;callAI=wrapped;}
    const commands=window.PanthoriumVoiceCommands;if(commands&&!commands.execute.__personalChats){const previous=commands.execute;const wrapped=async input=>{const navigation=await command(input);if(navigation)return navigation;if(!account()||pending)return previous(input);let ref;try{ref=await begin(input,'voice');const result=await previous(input);await finish(ref,result,'voice');return result;}catch(e){if(ref)pending=Math.max(0,pending-1);notify(e);return {ok:false,text:message(e)};}};wrapped.__personalChats=true;commands.execute=wrapped;}
  }
  window.PanthoriumChats={mount,begin,finish,recordVoice,ensureActive,requestHistory,newChat:fresh,refresh,command,getSessionId:()=>active?.owner===account()?active.id:null,
    prepareVoice:async()=>{await ensureActive();const state=await api('/quota');if(state.quota.availableBytes<4096)throw Error('personal_storage_full');return active.id;},
    notify,store:{get:getLocal,put:putLocal,validArchive}};
  window.addEventListener('panthorium:auth-changed',()=>{if(identity!==account()){active=null;metadata=[];devices=[];jobs=[];quota=null;unsaved=null;pending=0;identity=account();const messages=document.getElementById('chat-messages');if(messages)messages.replaceChildren();mounted=null;document.querySelectorAll('.personal-toolbar,.personal-quota,.personal-notice,.personal-history,.personal-jobs,.personal-dialog').forEach(n=>n.remove());mount().catch(notify);}install();});
  window.addEventListener('panthorium:ai-done',event=>{if(event.detail?.toolResults?.some(r=>r.toolId?.startsWith('remote.')))refreshJobs().catch(()=>{});});
  install();mount().catch(notify);let retries=0;const timer=setInterval(()=>{install();if(++retries>=12)clearInterval(timer);},250);
})();
