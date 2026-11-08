(function () {
  'use strict';
  const api=()=>typeof OS!=='undefined'?OS:null;
  const account=()=>String(api()?.state?.user?.sub||api()?.state?.user?.id||'');
  const labels={disabled:'หยุดงานหลังบ้านแล้ว',waiting_idle:'รอ 9B ว่างและทรัพยากรพร้อม',waiting_data:'รอข้อมูลที่เพียงพอ',analyzing:'กำลังวิเคราะห์ด้วย 9B',ready:'มีข้อเสนอแนะจาก 9B'};
  const errors={insights_operator_required:'บัญชีนี้ไม่มีสิทธิ์จัดการงานหลังบ้าน',incident_manual_review_required:'เหตุการณ์นี้ต้องตรวจด้วยตนเอง ระบบจะไม่บล็อก IP ส่วนตัวหรือ IP ที่ผู้ดูแลใช้อยู่',incident_plan_expired:'แผนหมดอายุหรือมีข้อมูลเปลี่ยน กรุณาโหลดใหม่',incident_evidence_expired:'ไม่พบเหตุการณ์ที่ยังเข้าเกณฑ์ จึงยังไม่ดำเนินการ',incident_already_handled:'เหตุการณ์นี้มีการดำเนินการแล้ว กรุณาโหลดใหม่',insights_disabled:'หยุดงานหลังบ้านอยู่',action_confirmation_expired:'คำขออนุมัติหมดอายุ กรุณาเตรียมแผนใหม่',action_outcome_unknown:'ยังยืนยันผลไม่ได้ กรุณาตรวจสถานะก่อนสั่งซ้ำ'};
  async function call(path,method='GET',body) {
    const base=String(api()?.config?.backendUrl||'').replace(/\/$/,'');
    const response=await authorizedFetch(base+path,{method,cache:'no-store',headers:{'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    if(!response.ok||data.ok!==true) throw new Error(errors[data.error]||'ยังทำรายการไม่ได้ กรุณาโหลดสถานะล่าสุดแล้วลองอีกครั้ง');
    return data;
  }
  const element=(tag,text,parent)=>{const e=document.createElement(tag);e.textContent=text;if(parent)parent.appendChild(e);return e;};
  async function open() {
    if(!account()||!api()?.state?.user?.permissions?.includes('chat')||api().state.user.roles?.includes('guest'))return false;
    if(api().windows.has('local-insights')){focusWindow('local-insights');return true;}
    createWindow('local-insights','🛡️ ความปลอดภัยและสถิติ','<div data-insights-root style="padding:16px;overflow:auto;height:100%;box-sizing:border-box;color:var(--text);line-height:1.7"><div data-insights-status role="status" aria-live="polite"></div><div data-insights-content></div></div>',{width:650,height:620});
    const root=document.querySelector('.window[data-id="local-insights"] [data-insights-root]'); if(!root)return false;
    const content=root.querySelector('[data-insights-content]'),status=root.querySelector('[data-insights-status]');
    let generation=0;
    const current=(owner,version)=>root.isConnected&&owner===account()&&version===generation;
    function button(parent,text,action) {
      const b=element('button',text,parent);b.type='button';b.style.cssText='margin:5px 6px 5px 0;padding:9px 13px;border:1px solid #467785;border-radius:9px;background:#14323f;color:#fff;font:inherit;cursor:pointer';
      b.addEventListener('click',async()=>{
        const owner=account(),version=generation;b.disabled=true;
        try {await action(()=>current(owner,version));} catch(e){if(current(owner,version))status.textContent=e.message;}
        finally{if(current(owner,version))b.disabled=false;}
      });return b;
    }
    async function load() {
      const owner=account(),version=++generation; content.replaceChildren();status.textContent='กำลังโหลด…';
      try {
        const me=await call('/api/local-insights/me');if(!current(owner,version))return;
        status.textContent='';
        element('h3','สถิติของบัญชีฉัน',content);
        element('p','เก็บจำนวนการใช้ฟังก์ชัน ข้อผิดพลาด และคำขอที่ใช้เวลานาน แยกตามบัญชี สูงสุด 30 วัน ไม่เก็บเนื้อหาแชท อีเมล หรือไฟล์ และไม่ใช้ฝึกน้ำหนักโมเดล',content);
        const label=element('label','',content),toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=me.enabled;label.appendChild(toggle);label.append(' ยินยอมใช้สถิติเพื่อปรับปรุงระบบ');
        toggle.addEventListener('change',async()=>{
          toggle.disabled=true;
          try{await call('/api/local-insights/preferences','PUT',{enabled:toggle.checked});if(current(owner,version))await load();}
          catch(e){if(current(owner,version)){toggle.checked=me.enabled;toggle.disabled=false;status.textContent=e.message;}}
        });
        if(me.counters.length){const list=element('ul','',content);for(const c of me.counters)element('li',`${me.features[c.feature]||c.feature}: ${c.total} คำขอ • ผิดพลาด ${c.errors} • ถูกปฏิเสธ/เกินอัตรา ${c.denied} • เกิน 5 วินาที ${c.slow}`,list);}
        else element('p','ยังไม่มีสถิติที่เปิดให้เก็บ',content);
        button(content,'ลบสถิติและถอนความยินยอม',async valid=>{await call('/api/local-insights/me','DELETE');if(valid())await load();});
        button(content,'โหลดสถานะล่าสุด',load);
        if(!me.operator)return;
        const data=await call('/api/local-insights/operator');if(!current(owner,version))return;
        element('hr','',content);element('h3','งานหลังบ้าน Sentinel AI',content);
        element('p',`${labels[data.workerStatus]||'กำลังตรวจสถานะ'} • ผู้รับแจ้งเตือน ${data.recipients.length} บัญชี • การฝึกโมเดลปิดอยู่`,content);
        element('p','กฎตรวจจับแจ้งเหตุโดยไม่รอ AI ส่วน 9B วิเคราะห์เมื่อโมเดลเปิดอยู่และว่าง งานผู้ใช้มีลำดับก่อน การแจ้งเตือนบนอุปกรณ์ต้องเปิดสิทธิ์รับแจ้งเตือน',content);
        button(content,data.enabled?'หยุด 9B และระงับแผน':'เปิดงานหลังบ้าน',async valid=>{await call('/api/local-insights/control','PUT',{enabled:!data.enabled});if(valid())await load();});
        if(!data.enabled)element('p','การตรวจและแจ้งความเสี่ยงจากกฎยังทำงาน การหยุด 9B ไม่ยกเลิกการบล็อกที่อนุมัติไปแล้ว',content);
        if(data.enabled)button(content,'ขอวิเคราะห์เมื่อเครื่องพร้อม',async valid=>{await call('/api/local-insights/analyze','POST',{});if(valid())status.textContent='รับคำขอแล้ว จะวิเคราะห์เมื่อ 9B เปิดอยู่และว่าง';});
        if(data.report){element('h4','ข้อเสนอแนะของ 9B (ควรตรวจสอบก่อนใช้)',content);element('p',data.report.text,content);element('small','วิเคราะห์เมื่อ '+new Date(data.reportAt).toLocaleString('th-TH'),content);}
        element('h3','เหตุการณ์และแผนรับมือ',content);
        if(!data.incidents.length)element('p','ยังไม่พบเหตุการณ์ที่เข้าเกณฑ์ตรวจจับ',content);
        for(const incident of data.incidents){
          const card=element('article','',content);card.style.cssText='border:1px solid #375062;border-radius:10px;padding:12px;margin:12px 0;overflow-wrap:anywhere';
          element('strong',incident.title||'เหตุการณ์ความปลอดภัย',card);
          element('p',`ระดับ${incident.severity===3?'สูง':'ควรตรวจสอบ'} • ${incident.count} ครั้ง • IP ${incident.ip} • ล่าสุด ${new Date(incident.last_seen).toLocaleString('th-TH')}`,card);
          element('p',incident.advice||'',card);
          const states={blocked:incident.blockActive?'บล็อกชั่วคราวถึง '+new Date(incident.blockExpiresAt).toLocaleTimeString('th-TH'):'การบล็อกของแผนนี้สิ้นสุดแล้ว',already_protected:'มีกฎอื่นป้องกันต้นทางนี้อยู่แล้ว',reverted:'ยกเลิกการบล็อกของแผนนี้แล้ว',observed:'รอตรวจสอบและอนุมัติ'};
          element('p',states[incident.state]||'รอตรวจสอบ',card);
          if(incident.state==='blocked'&&incident.blockActive)button(card,'ยกเลิกการบล็อกของแผนนี้',async valid=>{await call('/api/local-insights/incidents/'+incident.id+'/undo','POST',{});if(valid())await load();});
          if(incident.state==='observed'&&data.enabled)button(card,'ดูแผนเพื่ออนุมัติ',async valid=>{
            const result=await call('/api/local-insights/incidents/'+incident.id+'/plan','POST',{});if(!valid())return;
            card.querySelector('[data-plan]')?.remove();const box=element('section','',card);box.dataset.plan='';
            element('h4',result.plan.summary,box);element('p',result.plan.impact,box);element('p',result.plan.rollback,box);
            if(result.plan.analysisAvailable)element('p','อ่านข้อเสนอแนะของ 9B ด้านบนประกอบการตัดสินใจ แผนนี้จำกัดเฉพาะ IP และระยะเวลาที่ระบุ',box);
            else element('p','แผนเบื้องต้นจากกฎความปลอดภัย การวิเคราะห์ของ 9B ยังไม่พร้อม',box);
            element('small','ยืนยันได้ถึง '+new Date(result.plan.expiresAt).toLocaleTimeString('th-TH'),box);
            const approval=result.approval;
            if(approval.requiresConfirmation){
              button(box,'อนุมัติและบล็อก 10 นาที',async stillValid=>{await call('/api/actions/'+approval.actionId+'/confirm','POST',{approvalHash:approval.approvalHash});if(stillValid())await load();});
              button(box,'ยกเลิกคำขอ',async stillValid=>{await call('/api/actions/'+approval.actionId+'/cancel','POST',{});if(stillValid())await load();});
            } else element('p','คำขอนี้ถูกดำเนินการหรือยกเลิกแล้ว กรุณาโหลดสถานะล่าสุด',box);
          });
        }
      }catch(e){if(current(owner,version))status.textContent=e.message;}
    }
    if(open.authChanged)window.removeEventListener('panthorium:auth-changed',open.authChanged);
    open.authChanged=()=>{generation++;content.replaceChildren();status.textContent='';if(root.isConnected&&account())load();};
    window.addEventListener('panthorium:auth-changed',open.authChanged);
    await load();return true;
  }
  window.PanthoriumLocalInsights={open};
})();
