(function() {
  "use strict";
  const root="/api/marketing";
  const json=(method,body)=>({method,body:JSON.stringify(body)});
  const features={feed:"Feed",short:"Short",watch:"Watch",live:"Live",tv:"TV",market:"Market",
    community:"Community",talk:"Chat",packages:"แพ็กเกจ",offers:"ดูข้อเสนอ", "offer-open":"เลือกข้อเสนอ"};
  const runLabels={running:"กำลังร่าง",ready:"มีร่างให้ตรวจ",resource_wait:"พักรอทรัพยากรเครื่อง",retry_wait:"รอลองอีกครั้ง"};
  let owner, consent, seen;
  function session(id) {
    if (id!==owner) { owner=id; consent=null; seen=new Set(); }
  }
  async function preferences(v,api) {
    session(v.uid);
    if (!consent) {
      const pending=api(v,root+"/preferences").then(r=>r.preferences);
      consent=pending;
      try { return await pending; } catch(e) { if (consent===pending) consent=null; throw e; }
    }
    return consent;
  }
  async function observe(v,feature,api) {
    if (!Object.hasOwn(features,feature)) return;
    try {
      if (!(await preferences(v,api)).analytics || owner!==v.uid) return;
      const key=new Date(Date.now()+7*3600000).toISOString().slice(0,10)+":"+feature;
      if (seen.has(key)) return;
      const current=seen; current.add(key);
      try { await api(v,root+"/events",json("POST",{feature})); } catch { current.delete(key); }
    } catch { /* An optional counter must not interrupt Chat. */ }
  }
  function room({v,r,card,text,el,button,api,write,refresh,status}) {
    const panel=el("section",null,{"aria-label":"ผู้ช่วย Panthorium"});
    card.append(panel);
    if (v.uid===r.supportAdminId) {
      const opener=el("details"), body=el("div");
      opener.append(el("summary","ผู้ช่วยตอบลูกค้า"),body); panel.append(opener);
      for (const [label,draft] of [
        ["รับเรื่อง","สวัสดีครับ แอดมิน Panthorium รับเรื่องแล้วครับ รบกวนแจ้งรายละเอียดเพิ่มเติมได้ในแชตนี้"],
        ["สอบถามอุปกรณ์","รบกวนแจ้งรุ่นอุปกรณ์และขั้นตอนที่พบปัญหา เพื่อให้แอดมินตรวจสอบได้ตรงจุดครับ"],
      ]) body.append(button(v,label,()=>{ text.value=draft; text.focus(); }));
      return;
    }
    for (const [label,topic] of [["สอบถามแพ็กเกจ","plans"],["เช็กโปรโมชันปัจจุบัน","promotion"]])
      panel.append(button(v,label,async()=>{
        await write(v,"support-answer",{recordId:r.id,topic}); await refresh();
      }));
    panel.append(button(v,"คุยกับแอดมิน",()=>{text.focus(); status(v,"พิมพ์ข้อความแล้วกดส่ง แอดมินจะได้รับในห้องนี้");}));
    const options=el("div"); panel.append(options);
    async function settings() {
      const {preferences:p}=await api(v,root+"/preferences");
      session(v.uid); consent=p; options.replaceChildren();
      for (const [key,label] of [["offers","รับข้อเสนอในห้องนี้"],["analytics","ช่วยวิเคราะห์การใช้หมวดต่าง ๆ แบบรวมกลุ่ม"]]) {
        const toggle=button(v,label+" · "+(p[key]?"เปิด":"ปิด"),async()=>{
          const result=await api(v,root+"/preferences",json("PUT",{key,value:!p[key]}));
          consent=result.preferences; seen.clear(); await settings();
        });
        toggle.setAttribute("role","switch"); toggle.setAttribute("aria-checked",String(p[key])); options.append(toggle);
      }
      if (p.offers) {
        const list=el("div"), show=async()=>{
          const {items}=await api(v,root+"/offers"); list.replaceChildren();
          if (!items.length) list.append(el("p","ขณะนี้ยังไม่มีข้อเสนอที่เปิดรับ"));
          observe(v,"offers",api);
          for (const item of items) {
            const entry=el("article",null,{class:"social-card"});
            entry.append(el("strong",item.title),el("p",item.text),el("small","สิ้นสุด "+new Date(item.ends).toLocaleString("th-TH")),
              button(v,item.action==="contact"?"ขอนัดกับแอดมิน":"ดูแพ็กเกจ",async()=>{
                const fresh=await api(v,root+"/offers");
                if (!fresh.items.some(x=>x.campaignId===item.campaignId)) { await show(); return; }
                observe(v,"offer-open",api);
                if (item.action==="contact") { text.value="สนใจ"+item.title+" รบกวนแอดมินแจ้งเวลาที่สะดวก"; text.focus(); }
                else { observe(v,"packages",api); window.PanthoriumBilling?.open(); }
              }));
            list.append(entry);
          }
        };
        options.append(button(v,"ข้อเสนอสำหรับคุณ",show),list);
      }
    }
    settings().catch(()=>{ if (options.isConnected) options.append(button(v,"โหลดการตั้งค่าข้อเสนออีกครั้ง",settings)); });
  }
  const localTime=date=>new Date(+date-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
  async function admin({v,el,button,input,select,section,api,status}) {
    const card=section(v,"การตลาดหลังบ้าน"), body=el("div"); card.append(body);
    async function render() {
      const data=await api(v,root+"/admin"); if (!card.isConnected) return;
      body.replaceChildren();
      body.append(el("h4","แผนการตลาดจาก Qwen 2B"));
      const run=data.runs[0];
      body.append(el("p",run?run.day+" · "+(runLabels[run.status]||run.status):
        data.worker?"รอรอบวิเคราะห์เมื่อเครื่องมีทรัพยากรพอ":"ตัวรันบนโน้ตบุ๊กยังไม่พร้อม"));
      const brief=data.runs.find(x=>x.brief)?.brief;
      if (brief) for (const [label,value] of [["เป้าหมาย",data.objectives[brief.objective]],["กลุ่มที่ควรทดลอง",brief.audience],
        ["ช่องทาง",brief.channel],["วิธีทดลอง",brief.experiment]]) body.append(el("p",label+" · "+value));
      if (data.worker) body.append(button(v,"ตรวจรอบงานวันนี้",async()=>{ await api(v,root+"/admin/run",json("POST",{})); await render(); }));
      body.append(button(v,"รีเฟรช",render),el("h4","กิจกรรมใน 7 วันล่าสุด"));
      for (const metric of data.counts) body.append(el("p",features[metric.feature]+" · "+metric.people+" บัญชี"));
      if (!data.counts.length) body.append(el("p","ยังไม่มีหมวดที่มีผู้ร่วมวิเคราะห์ถึง 5 บัญชี"));
      body.append(el("h4","ค้นหาช่องทางเข้าถึงลูกค้า"));
      const query=input(body,"คำค้นแหล่งสาธารณะ","text",brief?.searchQuery || ""), results=el("div");
      body.append(button(v,"ค้นหา",async()=>{
        const {results:items}=await api(v,root+"/admin/discover",json("POST",{query:query.value})); results.replaceChildren();
        if (!items.length) results.append(el("p","ไม่พบแหล่งสาธารณะที่อ่านฟรีสำหรับคำค้นนี้"));
        for (const item of items) {const link=el("a",item.title,{href:item.url,target:"_blank",rel:"noopener noreferrer"}); const line=el("p");line.append(link);results.append(line);}
      }),results,el("h4","เผยแพร่ข้อเสนอในห้อง Panthorium"));
      const product=select(body,"แพ็กเกจหรือโปรโมชัน",data.products.map(p=>[p.id,p.name]),data.products.some(p=>p.id===brief?.product)?brief.product:undefined);
      const goal=select(body,"เป้าหมาย",Object.entries(data.objectives),brief?.objective);
      const start=input(body,"เวลาเริ่ม","datetime-local",localTime(new Date()));
      const end=input(body,"เวลาสิ้นสุด","datetime-local",localTime(new Date(Date.now()+86400000)));
      const limit=input(body,"จำนวนบัญชีสูงสุด","number","100"), preview=el("p"); limit.min="1";limit.max="100000";
      function terms() {
        const p=data.products.find(p=>p.id===product.value);
        if (!p) return;
        if (p.endsAt && Date.parse(end.value)>Date.parse(p.endsAt)) end.value=localTime(new Date(p.endsAt));
        preview.textContent=p.name+" · "+(p.amountSatang/100).toLocaleString("th-TH")+" บาท · "+p.terms;
      }
      product.addEventListener("change",terms); terms(); body.append(preview);
      let id=crypto.randomUUID(), previous="";
      body.append(button(v,"อนุมัติและตั้งเวลาเผยแพร่",async()=>{
        const draft={product:product.value,objective:goal.value,starts:new Date(start.value).toISOString(),ends:new Date(end.value).toISOString(),limit:Number(limit.value)};
        const signature=JSON.stringify(draft); if (previous && previous!==signature) id=crypto.randomUUID(); previous=signature;
        await api(v,root+"/admin/campaigns",json("POST",{id,...draft})); await render();
      }),el("h4","ข้อเสนอที่อนุมัติแล้ว"));
      if (!data.campaigns.length) body.append(el("p","ยังไม่มีข้อเสนอที่อนุมัติ"));
      for (const c of data.campaigns) {
        const line=el("div",null,{class:"social-card"}), until=new Date(c.ends), since=new Date(c.starts);
        const state=c.stopped?"หยุดแล้ว":until<=new Date()?"สิ้นสุดแล้ว":since>new Date()?"ตั้งเวลาแล้ว":"กำลังแสดง";
        line.append(el("strong",(data.products.find(p=>p.id===c.product)?.name||c.product)+" · "+state),
          el("p",since.toLocaleString("th-TH")+" – "+until.toLocaleString("th-TH")+" · แสดงแล้ว "+c.reached+"/"+c.reach_limit+" บัญชี"));
        if (!c.stopped && +until>Date.now()) line.append(button(v,"หยุดข้อเสนอนี้",async()=>{
          await api(v,root+"/admin/campaigns/"+encodeURIComponent(c.id)+"/stop",json("POST",{})); await render();
        }));
        body.append(line);
      }
      status(v,"");
    }
    await render();
  }
  window.PanthoriumMarketing=Object.freeze({room,admin,observe});
})();
