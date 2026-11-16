(function () {
  'use strict';
  const catalog = window.PanthoriumScreenVoiceCatalog;
  if (!catalog) return;
  const user = () => { try { return OS.state?.user; } catch { return null; } };
  const identity = () => JSON.stringify([user()?.sub || user()?.id, user()?.roles, user()?.permissions]);
  const account = () => !!(user()?.sub || user()?.id) && !String(user()?.sub || user()?.id).startsWith('guest:') && !user()?.roles?.includes('guest') && user()?.permissions?.includes('chat');
  const blocked = 'script,style,noscript,iframe,webview,[hidden],[aria-hidden="true"],[data-private],[data-sensitive],[data-no-ai],input[type="password"],input[type="hidden"]';
  const fields = 'input:not([type="hidden"]),textarea,select,[contenteditable="true"]';
  const norm = value => String(value || '').normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  let pending = null, lastIdentity = identity();
  const failure = (error, text) => ({ok:false,error,text});
  function visible(el) {
    if (!el?.isConnected || el.closest('[inert]')) return false;
    for (let node=el;node;node=node.parentElement) {
      const style=getComputedStyle(node);
      if (node.hidden || node.getAttribute('aria-hidden')==='true' || style.display==='none' || style.visibility==='hidden' || style.opacity==='0') return false;
    }
    return true;
  }
  function sensitive(el) {
    return !!el.closest(blocked) || /password|passwd|secret|token|api.?key|credit.?card|cvv|cvc|otp|รหัสผ่าน|รหัสยืนยัน/i.test([el.type,el.name,el.id,el.autocomplete,el.getAttribute('aria-label'),...Array.from(el.labels||[]).map(item=>item.textContent)].join(' '));
  }
  function active() {
    if (!account() || window.PanthoriumCloudApps?.voiceContext?.()) return null;
    const apps=window.PanthoriumWindowCatalog;
    const roots=(apps?.apps || []).flatMap(app=>{
      if (!app.selector || app.virtual || app.native || !apps.allowed(app,user())) return [];
      const root=document.querySelector(app.selector);
      if (!visible(root)) return [];
      let level=0;
      for(let el=root;el;el=el.parentElement) level=Math.max(level,parseInt(getComputedStyle(el).zIndex,10)||0);
      return [{app,root,level}];
    });
    return roots.sort((a,b)=>b.level-a.level || Number(b.root.classList.contains('is-focused'))-Number(a.root.classList.contains('is-focused')))[0] || null;
  }
  function label(el) {
    const labelled=(el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent || '').join(' ');
    return (el.getAttribute('aria-label') || labelled || Array.from(el.labels || []).map(item=>item.textContent).join(' ') || el.getAttribute('placeholder') || el.getAttribute('title') || (el.matches('button,a,[role="button"],[role="tab"]') ? el.textContent : el.name) || '').replace(/\s+/g,' ').trim().slice(0,160);
  }
  function controls(root) {
    return Array.from(root.querySelectorAll('button,a[href],input,textarea,select,[contenteditable="true"],[role="button"],[role="tab"]')).filter(el=>visible(el)&&!sensitive(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true').map(el=>({el,label:label(el),kind:el.matches(fields)?'field':'button'})).filter(item=>item.label).slice(0,80);
  }
  function textOf(root) {
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const pieces=[];let node,total=0;
    while((node=walker.nextNode())&&total<6000) {
      const el=node.parentElement;
      if (!el || el.closest(blocked+','+fields) || !visible(el) || sensitive(el)) continue;
      const value=node.textContent.replace(/\s+/g,' ').trim();
      if(value){pieces.push(value);total+=value.length+1;}
    }
    for(const field of root.querySelectorAll(fields)) {
      if(total>=6000)break;
      if(!visible(field)||sensitive(field))continue;
      const value=String(field.value ?? field.textContent ?? '').trim();
      if(value){const entry=(label(field)||'ข้อความที่แก้ไขอยู่')+': '+value;pieces.push(entry);total+=entry.length+1;}
    }
    return pieces.join('\n').slice(0,6000);
  }
  async function snapshot({external=false}={}) {
    const current=active();
    if(!current) return failure('active_window_unavailable','ไม่พบหน้าต่างที่บัญชีนี้อ่านได้ กรุณาเปิดหน้าต่างใน Panthorium ก่อน');
    const {app,root}=current,owner=identity();
    if(app.external) return failure('external_page_unavailable','หน้านี้เปิดในแท็บหรือแอปภายนอก จึงยังอ่านหรือควบคุมเนื้อหาจาก Panthorium ไม่ได้');
    if(app.id==='browser'&&external) {
      const result=await window.PanthoriumBrowser?.readCurrentPage?.();
      if(owner!==identity()||active()?.root!==root) return failure('screen_changed','หน้าต่างหรือบัญชีเปลี่ยนแล้ว กรุณาสั่งใหม่');
      return result || failure('external_page_unavailable','อ่านได้เมื่อเปิดเว็บภายใน Panthorium Browser Desktop');
    }
    const items=controls(root).map(({label,kind},i)=>({number:i+1,label,kind}));
    return {ok:true,appId:app.id,title:app.label,text:textOf(root),controls:items};
  }
  function fingerprint(root) {
    // Kept in memory only. Binding approval to all visible form values also
    // catches property-only changes that a MutationObserver would miss.
    return JSON.stringify([textOf(root),controls(root).map(({el,label,kind})=>[label,kind,el.value ?? '',el.checked ?? null,el.getAttribute('href')])]);
  }
  function clear() { pending=null;document.getElementById('panthorium-screen-confirmation')?.remove(); }
  function review(text) {
    document.getElementById('panthorium-screen-confirmation')?.remove();
    const panel=document.createElement('aside');panel.id='panthorium-screen-confirmation';panel.setAttribute('role','status');
    panel.style.cssText='position:fixed;z-index:2147483000;top:70px;left:5%;right:5%;padding:16px;border:1px solid #5ab9c8;border-radius:12px;background:#101827;color:#fff;white-space:pre-wrap;max-height:45vh;overflow:auto';
    const description=document.createElement('div');description.textContent=text;panel.append(description);
    for(const [name,command] of [['ยืนยัน','ยืนยัน'],['ยกเลิก','ยกเลิก']]) {const b=document.createElement('button');b.textContent=name;b.onclick=()=>execute(command,{userInitiated:true});panel.append(b);}
    document.body.append(panel);
  }
  async function execute(command,{userInitiated=false}={}) {
    const phrase=norm(command);
    if(['ยืนยัน','ยืนยันคำสั่ง','confirm','ยกเลิก','cancel'].includes(phrase)) {
      if(!userInitiated) return failure('screen_confirmation_user_required','รอผู้ใช้พูดยืนยันหรือยกเลิก');
      const proposal=pending;clear();
      if(!proposal) return failure('screen_confirmation_missing','ไม่มีคำสั่งหน้าจอรอยืนยัน');
      if(['ยกเลิก','cancel'].includes(phrase)) return {ok:true,text:'ยกเลิกคำสั่งหน้าจอแล้ว'};
      const {root,el,intent}=proposal;
      if(!account()||identity()!==proposal.owner||Date.now()>proposal.expiresAt||active()?.root!==root||!visible(el)||el.disabled||el.getAttribute('aria-disabled')==='true'||sensitive(el)||fingerprint(root)!==proposal.fingerprint) return failure('screen_changed','หน้าต่างหรือข้อมูลเปลี่ยนแล้ว กรุณาสั่งใหม่เพื่อตรวจรายละเอียดอีกครั้ง');
      if(intent.action==='fill') {
        if(el.isContentEditable) el.textContent=intent.value;
        else {
          if(el.tagName==='SELECT') {
            const option=Array.from(el.options).filter(o=>!o.disabled&&(norm(o.label)===norm(intent.value)||o.value===intent.value));
            if(option.length!==1) return failure('screen_option_ambiguous','ไม่พบตัวเลือกที่ตรงกันเพียงรายการเดียว');
            el.value=option[0].value;
          } else {
            const prototype=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,intent.value);
          }
        }
        el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
        return {ok:true,text:`กรอกช่อง ${proposal.label} แล้ว`};
      }
      el.click();
      return {ok:true,text:`กดปุ่ม ${proposal.label} แล้ว โปรดตรวจผลที่หน้าต่าง`,dispatched:true};
    }
    if(pending) return {ok:true,text:'มีคำสั่งหน้าจอรอยืนยัน พูด ยืนยัน หรือ ยกเลิก ก่อน',confirmationRequired:true};
    const intent=catalog.parse(command);
    if(!intent) return null;
    const current=active();
    if(!current) return failure('active_window_unavailable','ไม่พบหน้าต่างที่บัญชีนี้สั่งงานได้');
    const {root,app}=current;
    if(app.external) return failure('external_page_unavailable','หน้าต่างนี้เป็นทางเปิดแอปภายนอก ยังควบคุมเนื้อหาในแท็บนั้นไม่ได้');
    if(['read','summarize','list'].includes(intent.action)) {
      const screen=await snapshot({external:intent.action!=='list'});
      if(!screen.ok) return screen;
      if(intent.action==='list') return {ok:true,text:screen.controls.length?screen.controls.map(c=>`${c.number}. ${c.kind==='field'?'ช่อง':'ปุ่ม'} ${c.label}`).join('\n'):'ไม่พบปุ่มหรือช่องที่สั่งงานได้',screen};
      return {ok:true,text:screen.text || 'หน้านี้ไม่มีข้อความที่อ่านได้',screen,summarize:intent.action==='summarize'};
    }
    if(intent.action==='scroll') {
      const candidates=[root,...root.querySelectorAll('*')].filter(el=>visible(el)&&!el.closest('iframe,webview')&&/(auto|scroll)/.test(getComputedStyle(el).overflowY)&&el.scrollHeight>el.clientHeight+1);
      const el=candidates.sort((a,b)=>b.clientHeight-a.clientHeight)[0];
      if(!el) return failure('screen_scroll_unavailable','หน้าต่างนี้ไม่มีพื้นที่ที่เลื่อนได้');
      const previous=el.scrollTop;
      el.scrollTop=intent.direction==='top'?0:intent.direction==='bottom'?el.scrollHeight:previous+(intent.direction==='up'?-1:1)*Math.max(100,el.clientHeight*.8);
      return {ok:true,text:el.scrollTop===previous?'ถึงขอบหน้าแล้ว':'เลื่อนหน้าแล้ว'};
    }
    const items=controls(root),number=/^(?:(?:ที่|หมายเลข)\s*)?([0-9]+)$/.exec(intent.target);
    const matches=number?items.filter((_,i)=>i===Number(number[1])-1):items.filter(item=>norm(item.label)===norm(intent.target));
    if(matches.length!==1) return failure('screen_target_ambiguous',matches.length?'พบหลายรายการชื่อเดียวกัน พูด แสดงปุ่ม แล้วเลือกหมายเลข':'ไม่พบรายการนี้ พูด แสดงปุ่ม เพื่อฟังชื่อหรือหมายเลข');
    const {el,label,kind}=matches[0];
    if((intent.action==='fill'||intent.action==='focus')&&kind!=='field') return failure('screen_field_required','รายการนี้ไม่ใช่ช่องกรอกข้อมูล');
    if(intent.action==='focus') {el.focus();return {ok:true,text:`เลือกช่อง ${label} แล้ว`};}
    if(intent.action==='fill'&&(el.readOnly||el.tagName==='INPUT'&&!['text','search','email','tel','url','number','date','time','datetime-local'].includes(el.type))) return failure('screen_field_unavailable','ช่องนี้ไม่รองรับการกรอกด้วยเสียง');
    // Never automate a secret-bearing form or another feature's approval UI.
    if((el.form?.querySelector('input[type="password"],input[autocomplete="one-time-code"]'))||el.closest('dialog,[data-approval],#panthorium-screen-confirmation')||/ยืนยัน|อนุมัติ|confirm|approve/i.test(label)) return failure('screen_protected_control','รายการนี้ต้องใช้ขั้นตอนยืนยันของหน้าต่างนั้น');
    pending={root,el,intent,label,owner:identity(),fingerprint:fingerprint(root),expiresAt:Date.now()+60000};
    const values=controls(root).filter(item=>item.kind==='field').map(item=>`${item.label}: ${item.el.value || ''}`).join('\n').slice(0,2000);
    const text=`${intent.action==='fill'?`กรอกช่อง ${label} เป็น ${intent.value}`:`กดปุ่ม ${label}` } ใน ${app.label}${values?'\nข้อมูลในฟอร์มขณะนี้:\n'+values:''}\nพูด ยืนยัน เพื่อดำเนินการ หรือ ยกเลิก`;
    review(text);
    return {ok:true,text,confirmationRequired:true};
  }
  window.PanthoriumScreenVoice={execute,snapshot,active,hasPending:()=>!!pending,clear};
  window.addEventListener('panthorium:auth-changed',()=>{const next=identity();if(next!==lastIdentity){clear();lastIdentity=next;}});
  window.addEventListener('panthorium:cloud-app-context',clear);
  window.addEventListener('pagehide',clear);
})();
