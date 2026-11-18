(function () {
  'use strict';
  const catalog = window.PanthoriumScreenVoiceCatalog;
  if (!catalog) return;
  const user = () => { try { return OS.state?.user; } catch { return null; } };
  const identity = () => JSON.stringify([user()?.sub || user()?.id, user()?.roles, user()?.permissions]);
  const account = () => !!(user()?.sub || user()?.id) && !String(user()?.sub || user()?.id).startsWith('guest:') && !user()?.roles?.includes('guest') && user()?.permissions?.includes('chat');
  const blocked = 'script,style,noscript,iframe,webview,[hidden],[aria-hidden="true"],[data-private],[data-sensitive],[data-no-ai],input[type="password"],input[type="hidden"]';
  const fields = 'input:not([type="hidden"]),textarea,select,[contenteditable="true"]';
  const controlSelector = 'button,a[href],summary,input,textarea,select,[contenteditable="true"],[role="button"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]';
  const norm = value => String(value || '').normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  let pending = null, lastIdentity = identity();
  const failure = (error, text) => ({ok:false,error,text});
  function visible(el) {
    if (!el?.isConnected || el.closest('[inert]')) return false;
    for (let node=el;node;node=node.parentElement) {
      const style=getComputedStyle(node);
      if (node.hidden || node.getAttribute('aria-hidden')==='true' || style.display==='none' || style.visibility==='hidden' || style.opacity==='0') return false;
      if(node.parentElement?.tagName==='DETAILS'&&!node.parentElement.open&&node!==node.parentElement.querySelector(':scope > summary')) return false;
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
    // A tab-specific catalog entry wins over its generic container.
    return roots.sort((a,b)=>b.level-a.level || Number(b.root.classList.contains('is-focused'))-Number(a.root.classList.contains('is-focused')) || b.app.selector.length-a.app.selector.length)[0] || null;
  }
  function label(el) {
    const labelText=node=>{const copy=node.cloneNode(true);copy.querySelectorAll(fields+','+blocked).forEach(child=>child.remove());return copy.textContent;};
    const labelled=(el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent || '').join(' ');
    return (el.getAttribute('aria-label') || labelled || Array.from(el.labels || []).map(labelText).join(' ') || el.getAttribute('placeholder') || el.getAttribute('title') || (el.matches('button,a,summary,[role]') ? el.textContent : el.name) || '').replace(/\s+/g,' ').trim().slice(0,160);
  }
  const checked = el => el.matches('input[type="checkbox"],input[type="radio"]') ? el.checked : el.getAttribute('aria-checked') === 'true';
  const switchLike = el => el.matches('input[type="checkbox"],input[type="radio"],[role="switch"],[role="checkbox"],[role="radio"],[role="menuitemcheckbox"],[role="menuitemradio"]');
  function controls(root) {
    return Array.from(root.querySelectorAll(controlSelector)).filter(el=>visible(el)&&!sensitive(el)&&!el.matches(':disabled')&&el.getAttribute('aria-disabled')!=='true').map(el=>({el,label:label(el),kind:switchLike(el)?'switch':el.matches('[role="tab"]')?'tab':el.matches(fields)?'field':'button'})).filter(item=>item.label);
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
    const items=controls(root).slice(0,200).map(({el,label,kind},i)=>({number:i+1,label,kind,...(kind==='switch'?{checked:checked(el)}:{}),...(el.tagName==='SELECT'?{options:Array.from(el.options).filter(o=>!o.disabled&&!o.parentElement?.disabled).slice(0,40).map(o=>o.label)}:{})}));
    return {ok:true,appId:app.id,title:app.label,text:textOf(root),controls:items};
  }
  function fingerprint(root) {
    // Kept in memory only. Binding approval to all visible form values also
    // catches property-only changes that a MutationObserver would miss.
    return JSON.stringify([textOf(root),controls(root).map(({el,label,kind})=>[label,kind,el.value ?? '',switchLike(el)?checked(el):null,el.getAttribute('href'),el.readOnly,el.getAttribute('aria-selected'),el.tagName==='SELECT'?Array.from(el.options).map(o=>[o.value,o.label,o.disabled,!!o.parentElement?.disabled]):null])]);
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
    const phrase=norm(command).replace(/(?:นะครับ|นะคะ|ครับ|ค่ะ|คะ|please)$/u,'');
    if(['ยืนยัน','ยืนยันคำสั่ง','confirm','ยกเลิก','cancel'].includes(phrase)) {
      if(!userInitiated) return failure('screen_confirmation_user_required','รอผู้ใช้พูดยืนยันหรือยกเลิก');
      const proposal=pending;clear();
      if(!proposal) return failure('screen_confirmation_missing','ไม่มีคำสั่งหน้าจอรอยืนยัน');
      if(['ยกเลิก','cancel'].includes(phrase)) return {ok:true,text:'ยกเลิกคำสั่งหน้าจอแล้ว'};
      const {root,el,intent}=proposal;
      if(!account()||identity()!==proposal.owner||Date.now()>proposal.expiresAt||active()?.root!==root||!visible(el)||el.matches(':disabled')||el.getAttribute('aria-disabled')==='true'||sensitive(el)||fingerprint(root)!==proposal.fingerprint) return failure('screen_changed','หน้าต่างหรือข้อมูลเปลี่ยนแล้ว กรุณาสั่งใหม่เพื่อตรวจรายละเอียดอีกครั้ง');
      if(intent.action==='toggle') {
        if(checked(el)!==intent.checked) el.click();
        return {ok:true,text:`ส่งคำสั่ง${intent.checked?'เปิด':'ปิด'}สวิตช์ ${proposal.label} แล้ว โปรดตรวจสถานะในหน้าต่าง`,dispatched:true};
      }
      if(intent.action==='fill'||intent.action==='select') {
        if(el.isContentEditable) el.textContent=intent.value;
        else {
          if(el.tagName==='SELECT') {
            const option=Array.from(el.options).filter(o=>!o.disabled&&!o.parentElement?.disabled&&(norm(o.label)===norm(intent.value)||o.value===intent.value));
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
    if(intent.action==='help') {
      if(!account()||window.PanthoriumCloudApps?.voiceContext?.()) return failure('active_window_unavailable','เข้าสู่บัญชีและออกจากแอปเฉพาะก่อนดูคำสั่งระบบ');
      const apps=(window.PanthoriumWindowCatalog?.apps||[]).filter(app=>!app.native&&!app.virtual&&!app.external&&window.PanthoriumWindowCatalog.allowed(app,user()));
      return {ok:true,text:'พูด เปิด ตามด้วยชื่อหน้าต่าง แล้วสั่ง อ่านหน้านี้, แสดงปุ่ม, เลื่อนลง, กดปุ่ม ตามด้วยชื่อหรือหมายเลข, เลือกแท็บ ตามด้วยชื่อ, เปิดสวิตช์ หรือ ปิดสวิตช์ ตามด้วยชื่อ, กรอกช่อง ชื่อช่อง ว่า ข้อความ, เลือกค่า ตัวเลือก ในช่อง ชื่อช่อง หรือ ล้างช่อง ชื่อช่อง\nคำสั่งที่เปลี่ยนข้อมูลจะแสดงรายละเอียดให้พูด ยืนยัน หรือ ยกเลิก\nหน้าต่างที่บัญชีนี้ใช้ได้: '+apps.map(app=>app.label).join(', ')};
    }
    const current=active();
    if(!current) return failure('active_window_unavailable','ไม่พบหน้าต่างที่บัญชีนี้สั่งงานได้');
    const {root,app}=current;
    if(app.external) return failure('external_page_unavailable','หน้าต่างนี้เป็นทางเปิดแอปภายนอก ยังควบคุมเนื้อหาในแท็บนั้นไม่ได้');
    if(['read','summarize','list'].includes(intent.action)) {
      const screen=await snapshot({external:intent.action!=='list'});
      if(!screen.ok) return screen;
      if(intent.action==='list') return {ok:true,text:screen.controls.length?screen.controls.map(c=>`${c.number}. ${{field:'ช่อง',switch:'สวิตช์',tab:'แท็บ',button:'ปุ่ม'}[c.kind]} ${c.label}${c.kind==='switch'?(c.checked?' (เปิด)':' (ปิด)'):''}${c.options?.length?' — '+c.options.join(', '):''}`).join('\n'):'ไม่พบปุ่มหรือช่องที่สั่งงานได้',screen};
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
    if(['fill','select','focus'].includes(intent.action)&&kind!=='field') return failure('screen_field_required','รายการนี้ไม่ใช่ช่องกรอกข้อมูล');
    if(intent.action==='select'&&el.tagName!=='SELECT') return failure('screen_field_required','รายการนี้ไม่ใช่ช่องตัวเลือก');
    if(intent.action==='toggle'&&kind!=='switch') return failure('screen_switch_required','รายการนี้ไม่ใช่สวิตช์หรือตัวเลือก');
    if(intent.action==='toggle'&&!intent.checked&&el.matches('input[type="radio"],[role="radio"],[role="menuitemradio"]')) return failure('screen_switch_required','ให้เลือกตัวเลือกอื่นในกลุ่มแทนการปิดรายการนี้');
    if(intent.action==='tab'&&kind!=='tab'&&!el.matches('button')) return failure('screen_tab_required','รายการนี้ไม่ใช่แท็บหรือปุ่ม');
    if(intent.action==='focus') {el.focus();return {ok:true,text:`เลือกช่อง ${label} แล้ว`};}
    if(['fill','select'].includes(intent.action)&&(el.readOnly||el.tagName==='INPUT'&&!['text','search','email','tel','url','number','date','time','datetime-local','range','color'].includes(el.type))) return failure('screen_field_unavailable','ช่องนี้ไม่รองรับการกรอกด้วยเสียง');
    if(['fill','select'].includes(intent.action)&&el.tagName==='SELECT'&&Array.from(el.options).filter(o=>!o.disabled&&!o.parentElement?.disabled&&(norm(o.label)===norm(intent.value)||o.value===intent.value)).length!==1) return failure('screen_option_ambiguous','ไม่พบตัวเลือกที่ตรงกันเพียงรายการเดียว');
    if(intent.action==='fill'&&el.tagName==='INPUT') {
      const probe=el.cloneNode();probe.value=intent.value;
      if(probe.value!==intent.value||(intent.value&&!probe.checkValidity())) return failure('screen_value_invalid','ค่าที่สั่งไม่ตรงชนิดหรือช่วงที่ช่องนี้อนุญาต');
    }
    // Never automate a secret-bearing form or another feature's approval UI.
    if((el.form?.querySelector('input[type="password"],input[autocomplete="one-time-code"]'))||el.closest('dialog,[data-approval],#panthorium-screen-confirmation')||/ยืนยัน|อนุมัติ|confirm|approve/i.test(label)) return failure('screen_protected_control','รายการนี้ต้องใช้ขั้นตอนยืนยันของหน้าต่างนั้น');
    if(intent.action==='toggle'&&checked(el)===intent.checked) return {ok:true,text:`สวิตช์ ${label} ${intent.checked?'เปิด':'ปิด'}อยู่แล้ว`,alreadySet:true};
    pending={root,el,intent,label,owner:identity(),fingerprint:fingerprint(root),expiresAt:Date.now()+60000};
    const values=controls(root).filter(item=>item.kind==='field').map(item=>`${item.label}: ${item.el.value || ''}`).join('\n').slice(0,2000);
    const operation=intent.action==='toggle'?`${intent.checked?'เปิด':'ปิด'}สวิตช์ ${label}`:['fill','select'].includes(intent.action)?`กรอกช่อง ${label} เป็น ${intent.value||'(ว่าง)'}`:`กด${intent.action==='tab'?'แท็บ':'ปุ่ม'} ${label}`;
    const text=`${operation} ใน ${app.label}${values?'\nข้อมูลในฟอร์มขณะนี้:\n'+values:''}\nพูด ยืนยัน เพื่อดำเนินการ หรือ ยกเลิก`;
    review(text);
    return {ok:true,text,confirmationRequired:true};
  }
  window.PanthoriumScreenVoice={execute,snapshot,active,hasPending:()=>!!pending,clear};
  window.addEventListener('panthorium:auth-changed',()=>{const next=identity();if(next!==lastIdentity){clear();lastIdentity=next;}});
  window.addEventListener('panthorium:cloud-app-context',clear);
  window.addEventListener('pagehide',clear);
})();
