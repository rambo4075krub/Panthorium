/* Account-scoped Panthorium editor; original files are immutable, saves create copies. */
(function () {
  'use strict';
  const ID='studio-editor', UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const titles={image:'แก้ไขรูปภาพ',document:'Panthorium Documents',spreadsheet:'Panthorium Sheets',presentation:'Panthorium Slides'};
  const os=()=>{try{return typeof OS!=='undefined'?OS:window.OS;}catch(_){return null;}};
  const identity=()=>JSON.stringify([os()?.state?.user?.sub||os()?.state?.user?.id,os()?.state?.user?.roles,os()?.state?.user?.permissions]);
  const allowed=()=>{const u=os()?.state?.user;return !!u && !String(u.sub||u.id||'').startsWith('guest:') && !u.roles?.includes('guest') && !!window.PanthoriumWindowCatalog?.allowed?.(window.PanthoriumWindowCatalog.apps.find(a=>a.id==='studio-document'),u);};
  let view=null;
  const current=v=>view===v && v.root.isConnected && v.owner===identity() && allowed();
  const el=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
  const button=(text,fn,attrs={})=>{const n=el('button',text,{type:'button',...attrs});n.onclick=fn;return n;};
  const messages={editor_formula_unsupported:'สูตรนี้ยังไม่อยู่ในชุดที่รองรับ กรุณาดูรายการสูตรในหน้าตาราง',editor_formula_shared_readonly:'สูตรแบบ shared/array ต้องแก้ในโปรแกรมที่รองรับสูตรชนิดนี้',invalid_office_style:'รูปแบบไม่ถูกต้อง',editor_cell_empty:'เพิ่มข้อมูลในเซลล์ก่อนจัดรูปแบบ',editor_geometry_unsupported:'กล่องข้อความนี้ยังปรับตำแหน่งไม่ได้',editor_source_changed:'ต้นฉบับเปลี่ยนแล้ว กรุณาเปิดไฟล์ใหม่ก่อนบันทึก',editor_formula_cell_readonly:'เซลล์สูตรคำนวณถูกเก็บไว้และยังแก้ไขจากหน้านี้ไม่ได้',editor_office_unsupported:'โครงสร้างไฟล์นี้ยังเปิดแก้ไขไม่ได้ ใช้โปรแกรม Office สำหรับไฟล์นี้',editor_file_too_complex:'ไฟล์มีขนาดหรือโครงสร้างเกินขอบเขตตัวแก้ไข',editor_crop_out_of_bounds:'พื้นที่ครอปต้องอยู่ภายในภาพ',editor_changes_too_large:'มีการแก้ไขมากเกินไป กรุณาแบ่งบันทึกเป็นช่วง',editor_cell_out_of_range:'รองรับเซลล์ A1 ถึง AN1000',studio_plugin_disabled:'ปลั๊กอินนี้ตั้งเป็น Never ให้เปลี่ยนเป็น Auto ก่อนบันทึก',account_changed:'บัญชีเปลี่ยนแล้ว',file_not_found:'ไม่พบไฟล์ในบัญชีนี้'};
  function report(v,text,error=false){if(current(v)){v.status.textContent=messages[text]||text;v.status.style.color=error?'#ffadad':'#ffca9b';}}
  async function api(v,url,options={},raw=false){
    if(!current(v))throw Error('account_changed');
    const send=()=>fetch(String(os()?.config?.backendUrl||'').replace(/\/$/,'')+url,{...options,signal:v.abort.signal,credentials:'include',cache:'no-store',headers:{...(options.body?{'Content-Type':'application/json'}:{}),Authorization:'Bearer '+(os()?.config?.accessToken||''),...options.headers}});
    let r=await send();if(r.status===401 && current(v) && await window.PanthoriumAuth?.refreshSession?.().catch(()=>false))r=await send();
    if(!current(v))throw Error('account_changed');if(raw && r.ok)return r;
    const data=await r.json();if(!current(v))throw Error('account_changed');if(!r.ok||data.ok===false)throw Error(data.error||'HTTP '+r.status);return data;
  }
  function cleanup(v){if(!v)return;clearTimeout(v.draftTimer);v.abort.abort();if(v.url)URL.revokeObjectURL(v.url);v.ops=[];v.redo=[];v.data=null;if(view===v)view=null;}
  function close(){const v=view;cleanup(v);if(typeof closeWindow==='function')closeWindow(ID);else document.querySelector('.window[data-id="studio-editor"]')?.remove();}
  function controls(v){if(!current(v))return;v.save.disabled=v.busy||!v.ops.length;v.undo.disabled=v.busy||!v.ops.length;v.redoButton.disabled=v.busy||!v.redo.length;v.count.textContent=v.ops.length+' การแก้ไขที่ยังไม่บันทึก';}
  function change(v,op){if(!current(v)||v.busy||v.finished)return;if(v.ops.length>=200)return report(v,'บันทึกฉบับนี้ก่อน แล้วแก้ไขต่อได้สูงสุดครั้งละ 200 รายการ',true);v.ops.push(op);v.redo=[];v.retry=null;controls(v);scheduleDraft(v);}
  function scheduleDraft(v){
    clearTimeout(v.draftTimer);if(!current(v)||!v.draftReady||v.finished||v.draftConflict)return;
    v.draftTimer=setTimeout(()=>persistDraft(v).catch(()=>{}),1500);
  }
  async function persistDraft(v){
    if(!current(v)||!v.draftReady||v.draftConflict)return;
    if(v.draftPromise){await v.draftPromise;if(!current(v))return;}
    if(v.busy&&!v.finished)return;
    const snapshot=JSON.stringify({version:v.draftVersion,revision:v.data.revision,operations:v.ops,name:v.name.value});
    v.draftPromise=(async()=>{try{const saved=await api(v,'/api/studio/editor/'+v.data.file.id+'/draft',{method:'PUT',body:snapshot});if(!current(v))return;v.draftVersion=saved.version;v.draftStatus.textContent=v.ops.length?'เก็บฉบับร่างบนบัญชีแล้ว · ยังไม่ได้สร้างไฟล์ฉบับแก้ไข':'ไม่มีการแก้ไขค้าง';}
      catch(e){if(current(v)){if(e.message==='editor_draft_conflict')v.draftConflict=true;v.draftStatus.textContent=e.message==='editor_draft_conflict'?'ฉบับร่างเปลี่ยนจากหน้าต่างอื่น จึงหยุดเก็บอัตโนมัติ · คุณยังบันทึกเป็นไฟล์ฉบับใหม่ได้':'ยังเก็บฉบับร่างไม่ได้ กรุณาบันทึกไฟล์ก่อนปิด';}throw e;}
      finally{v.draftPromise=null;}})();return v.draftPromise;
  }
  async function loadDraft(v){
    try{const draft=await api(v,'/api/studio/editor/'+v.data.file.id+'/draft');if(!current(v))return;v.draftVersion=draft.version;v.draftReady=true;
      if(draft.data&&draft.data.revision===v.data.revision){
        v.body.inert=true;v.save.disabled=true;const banner=el('div',null,{class:'se-toolbar'});v.saved.append(banner);banner.append(el('span','พบฉบับร่างที่ยังไม่ได้บันทึกเป็นไฟล์'),button('กู้คืนฉบับร่าง',()=>{v.ops=draft.data.operations;v.name.value=draft.data.name;v.body.inert=false;banner.remove();render(v);v.draftStatus.textContent='กู้คืนแล้ว · บันทึกเมื่อพร้อม';}),button('เริ่มจากต้นฉบับ',()=>{v.body.inert=false;banner.remove();persistDraft(v).catch(()=>{});controls(v);}));
      }else v.draftStatus.textContent=draft.data?'ต้นฉบับเปลี่ยน จึงไม่กู้ฉบับร่างเก่าอัตโนมัติ':'ฉบับร่างจะเก็บอัตโนมัติหลังหยุดแก้ไข';
    }catch(e){if(current(v))v.draftStatus.textContent='ฉบับร่างอัตโนมัติยังไม่พร้อม · ใช้ปุ่มบันทึกฉบับแก้ไข';}
  }
  function model(v){const d=JSON.parse(JSON.stringify(v.data));for(const op of v.ops){if(op.type==='set_cell'){const s=d.sheets[op.sheet],c=s.cells.find(c=>c.cell===op.cell);if(c)c.value=op.value;else s.cells.push({cell:op.cell,value:op.value});}if(op.type==='set_text')d.blocks.find(b=>b.index===op.index).text=op.value;}return d;}
  function col(n){let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
  function colIndex(s){return [...s.match(/^[A-Z]+/)[0]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;}
  function renderSheet(v,d){
    const nav=el('div',null,{class:'se-toolbar'}),select=el('select',null,{'aria-label':'ชีต'});
    d.sheets.forEach((s,i)=>select.append(el('option',s.name,{value:i})));select.value=String(v.sheet);select.onchange=()=>{v.sheet=Number(select.value);v.page=0;render(v);};nav.append(select);
    const sheet=d.sheets[v.sheet],lookup=new Map(sheet.cells.map(c=>[c.cell,c])),maxRow=Math.min(1000,Math.max(10,...sheet.cells.map(c=>Number(c.cell.match(/\d+/)[0])))),width=Math.min(40,Math.max(4,...sheet.cells.map(c=>colIndex(c.cell)+1)));
    nav.append(button('← แถวก่อนหน้า',()=>{v.page=Math.max(0,v.page-1);render(v);}),el('span','แถว '+(v.page*50+1)+'–'+Math.min(1000,v.page*50+50)),button('แถวถัดไป →',()=>{v.page=Math.min(19,v.page+1);render(v);}));v.body.append(nav);
    const table=el('table'),head=el('tr');head.append(el('th','#'));for(let c=0;c<width;c++)head.append(el('th',col(c)));table.append(head);
    for(let r=v.page*50+1;r<=Math.min(1000,Math.max(maxRow,v.page*50+10),v.page*50+50);r++){
      const row=el('tr');row.append(el('th',r));for(let c=0;c<width;c++){
        const ref=col(c)+r,item=lookup.get(ref),td=el('td'),input=el('input',null,{'aria-label':sheet.name+' '+ref,'data-cell':ref});input.value=String(item?.value??'');input.maxLength=2000;input.readOnly=!!item?.formula;
        if(item?.formula)input.title='สูตรคำนวณ · เก็บสูตรเดิมไว้';
        input.onchange=()=>{const value=typeof item?.value==='number' && input.value.trim()!=='' && Number.isFinite(Number(input.value))?Number(input.value):input.value;change(v,{type:'set_cell',sheet:v.sheet,cell:ref,value});};td.append(input);row.append(td);
      }table.append(row);
    }const scroll=el('div',null,{class:'se-grid'});scroll.append(table);v.body.append(scroll);
    const extra=el('form',null,{class:'se-toolbar'}),ref=el('input',null,{placeholder:'เช่น B2 หรือ E20','aria-label':'ตำแหน่งเซลล์',required:''}),value=el('input',null,{placeholder:'ค่าใหม่','aria-label':'ค่าเซลล์',maxlength:'2000'}),type=el('select',null,{'aria-label':'ชนิดค่า'});type.append(el('option','ข้อความ',{value:'text'}),el('option','ตัวเลข',{value:'number'}));extra.append(ref,value,type,el('button','ตั้งค่าเซลล์',{type:'submit'}));extra.onsubmit=e=>{e.preventDefault();const cell=ref.value.trim().toUpperCase();if(!/^[A-Z]{1,2}[1-9][0-9]{0,3}$/.test(cell)||colIndex(cell)>39||Number(cell.match(/\d+/)[0])>1000)return report(v,'editor_cell_out_of_range',true);if(lookup.get(cell)?.formula)return report(v,'editor_formula_cell_readonly',true);if(type.value==='number'&&(!value.value.trim()||!Number.isFinite(Number(value.value))))return report(v,'กรอกตัวเลขที่ถูกต้อง',true);change(v,{type:'set_cell',sheet:v.sheet,cell,value:type.value==='number'?Number(value.value):value.value});render(v);};v.body.append(extra,el('p','เพิ่มข้อมูลได้ด้วยตำแหน่งเซลล์ A1–AN1000 · เก็บสูตร รูปแบบ ชีต และภาพเดิมไว้ · เซลล์สูตรแสดงค่าที่บันทึกไว้ล่าสุดและเป็นแบบอ่านอย่างเดียว'));
  }
  function renderText(v,d){
    let page=0;for(const block of d.blocks){if(block.page!==page){page=block.page;v.body.append(el('h3',d.pluginId==='presentation'?'สไลด์ '+page:'ข้อความในเอกสาร'));}const label=el('label','ข้อความ '+(block.index+1)),input=el('textarea',null,{'data-text-index':block.index,rows:'3',maxlength:'6000'});input.value=block.text;input.onchange=()=>change(v,{type:'set_text',index:block.index,value:input.value});label.append(input);v.body.append(label);}
    if(d.pluginId==='document'){
      for(const [i,op]of v.ops.entries())if(op.type==='append_paragraph'){const label=el('label','ย่อหน้าใหม่'),input=el('textarea',null,{rows:'3',maxlength:'6000'});input.value=op.value;input.onchange=()=>{v.ops[i]={type:'append_paragraph',value:input.value};v.retry=null;controls(v);};label.append(input);v.body.append(label);}
      v.body.append(button('＋ เพิ่มย่อหน้า',()=>{change(v,{type:'append_paragraph',value:'ย่อหน้าใหม่'});render(v);}));
    }
    v.body.append(el('p','แก้ข้อความโดยคงภาพ ตาราง และเลย์เอาต์เดิมไว้ ข้อความที่แก้ใช้รูปแบบตัวอักษรจากช่วงแรกของย่อหน้านั้น'));
  }
  async function draw(v){
    if(!current(v))return;let bitmap=v.image;if(!bitmap)return;
    let canvas=document.createElement('canvas');canvas.width=bitmap.naturalWidth;canvas.height=bitmap.naturalHeight;canvas.getContext('2d').drawImage(bitmap,0,0);
    for(const op of v.ops){const next=document.createElement('canvas'),rotate=op.type==='rotate',swap=rotate&&op.degrees!==180;next.width=op.type==='crop'?op.width:swap?canvas.height:canvas.width;next.height=op.type==='crop'?op.height:swap?canvas.width:canvas.height;const ctx=next.getContext('2d');
      if(op.type==='crop')ctx.drawImage(canvas,op.x,op.y,op.width,op.height,0,0,op.width,op.height);
      else if(rotate){ctx.translate(next.width/2,next.height/2);ctx.rotate(op.degrees*Math.PI/180);ctx.drawImage(canvas,-canvas.width/2,-canvas.height/2);}
      else if(op.type==='flip'){ctx.translate(op.axis==='horizontal'?next.width:0,op.axis==='vertical'?next.height:0);ctx.scale(op.axis==='horizontal'?-1:1,op.axis==='vertical'?-1:1);ctx.drawImage(canvas,0,0);}
      else if(op.type==='brightness'){ctx.drawImage(canvas,0,0);const pixels=ctx.getImageData(0,0,next.width,next.height);for(let i=0;i<pixels.data.length;i+=4)for(let k=0;k<3;k++)pixels.data[i+k]+=op.amount*255;ctx.putImageData(pixels,0,0);}
      canvas=next;
    }v.canvas.width=canvas.width;v.canvas.height=canvas.height;v.canvas.getContext('2d').drawImage(canvas,0,0);v.dim.textContent=canvas.width+' × '+canvas.height+' px';
  }
  function renderImage(v){
    const bar=el('div',null,{class:'se-toolbar'});for(const [label,op]of [['หมุน 90°',{type:'rotate',degrees:90}],['กลับซ้าย–ขวา',{type:'flip',axis:'horizontal'}],['กลับบน–ล่าง',{type:'flip',axis:'vertical'}],['สว่างขึ้น',{type:'brightness',amount:0.1}],['มืดลง',{type:'brightness',amount:-0.1}]])bar.append(button(label,()=>{change(v,op);draw(v);}));
    v.canvas=el('canvas');v.dim=el('p');v.body.append(bar,v.canvas,v.dim);
    const crop=el('form',null,{class:'se-toolbar'}),inputs={};for(const [key,label]of [['x','ซ้าย (px)'],['y','บน (px)'],['width','กว้าง (px)'],['height','สูง (px)']]){const l=el('label',label),i=el('input',null,{type:'number',min:key==='x'||key==='y'?'0':'1',max:'16384',required:'','aria-label':label});i.value=key==='x'||key==='y'?'0':'';inputs[key]=i;l.append(i);crop.append(l);}crop.append(el('button','ครอป',{type:'submit'}));crop.onsubmit=e=>{e.preventDefault();const op={type:'crop'};for(const [k,i]of Object.entries(inputs))op[k]=Number(i.value);if(op.x+op.width>v.canvas.width||op.y+op.height>v.canvas.height)return report(v,'พื้นที่ครอปต้องอยู่ภายในภาพ',true);change(v,op);draw(v);};v.body.append(crop,el('p','ตัวอย่างบนหน้าจออาจมีสีต่างจากไฟล์ที่ประมวลผลเล็กน้อย · บันทึกเป็น PNG'));
    draw(v);
  }
  function render(v){if(!current(v)||!v.data)return;v.body.replaceChildren();if(window.PanthoriumOfficeSuite?.render({v,change,rerender:render,el,button,report,scheduleDraft})){controls(v);return;}const d=model(v);if(d.sheets)renderSheet(v,d);else if(d.blocks)renderText(v,d);else if(d.pluginId==='image')renderImage(v);controls(v);}
  async function save(v){
    if(!current(v)||v.busy||!v.ops.length)return;clearTimeout(v.draftTimer);v.busy=true;controls(v);v.body.inert=true;v.name.disabled=true;
    try{
      if(v.draftPromise)await v.draftPromise.catch(()=>{});
      const body=v.retry||(v.retry={pluginId:v.data.pluginId,sourceFileIds:[v.data.file.id],input:{prompt:'แก้ไขไฟล์และบันทึกฉบับใหม่',name:v.name.value,edit:{fileId:v.data.file.id,revision:v.data.revision,operations:JSON.parse(JSON.stringify(v.ops))}},idempotencyKey:'editor:'+crypto.randomUUID(),confirmed:true});
      const data=await api(v,'/api/studio/jobs',{method:'POST',body:JSON.stringify(body)});if(!current(v))return;
      window.PanthoriumCreativeStudio?.showJob(data.job);
      if(data.job.status==='completed'){
        v.ops=[];v.redo=[];v.retry=null;const file=data.job.files.find(f=>f.pluginId===v.data.pluginId)||data.job.files[0];
        report(v,'บันทึกแล้ว: '+file.name+' · ต้นฉบับยังอยู่');v.saved.replaceChildren(button('เปิดฉบับแก้ไขต่อ',()=>open(file.id)),button('ดูผลงานทั้งหมด',()=>window.PanthoriumCreativeStudio?.showJob(data.job)));
        // Freeze the completed editor until the saved copy is opened explicitly.
        v.body.inert=true;v.finished=true;await persistDraft(v).catch(()=>{});
      } else if(['failed','blocked','needs_review'].includes(data.job.status)) {v.retry=null;report(v,data.job.error||'บันทึกไม่สำเร็จ กรุณาตรวจรายการงาน',true);}
      else report(v,'รับงานแล้ว ติดตามผลในรายการงานก่อนส่งซ้ำ');
    }catch(e){if(current(v))report(v,e.message,true);}finally{if(current(v)){v.busy=false;if(!v.finished)v.body.inert=false;v.name.disabled=!!v.finished;controls(v);}}
  }
  async function voice(v){
    if(!current(v)||!v.data)return;
    if(v.finished)return report(v,'เปิดฉบับแก้ไขต่อก่อนสั่งงานด้วยเสียง',true);
    if(v.ops.length)return report(v,'บันทึกการแก้ไขด้วยมือก่อน เพื่อให้คำสั่งเสียงใช้ไฟล์ฉบับเดียวกัน',true);
    const live=window.PanthoriumLiveVoice;if(!live)return report(v,'ระบบเสียงยังไม่พร้อม กรุณาเปิด Sentinel AI',true);
    if(!live.isActive())await live.toggle('studio-editor');
    if(current(v))live.sendText?.('บริบทที่ผู้ใช้เลือก: กำลังแก้ไขไฟล์ '+JSON.stringify(v.data.file.name)+' fileId='+v.data.file.id+' ประเภท='+v.data.pluginId+' ให้ใช้ studio.editor อ่านไฟล์นี้ก่อนแก้ไข และรอฟังคำสั่งเสียงถัดไปจากผู้ใช้ การบันทึกต้องผ่านการยืนยันตามปกติ');
  }
  async function open(fileId){
    if(!UUID.test(fileId||'')||!allowed())return false;
    if(view&&current(view)&&view.data?.file.id===fileId){window.PanthoriumWindowManager?.restore?.(ID);return view.root;}
    if(view?.ops.length&&!window.confirm('มีการแก้ไขที่ยังไม่บันทึก ต้องการปิดแล้วเปิดไฟล์อื่นหรือไม่?'))return false;
    close();if(typeof createWindow!=='function')return false;
    createWindow(ID,'แก้ไขผลงาน',`<section data-studio-editor><style>
      [data-studio-editor]{box-sizing:border-box;height:100%;overflow:auto;padding:22px;background:var(--bg,#10151d);color:var(--text,#eef1f5);font:14px/1.5 system-ui}[data-studio-editor] *{box-sizing:border-box}[data-studio-editor] header,[data-studio-editor] .se-toolbar{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-bottom:16px}[data-studio-editor] h1{font-size:25px;margin:0 0 5px}[data-studio-editor] button,[data-studio-editor] input,[data-studio-editor] select,[data-studio-editor] textarea{font:inherit;color:inherit;background:#18212d;border:1px solid #445063;border-radius:7px;padding:9px}[data-studio-editor] button{cursor:pointer;min-height:40px}[data-studio-editor] button:disabled{opacity:.45;cursor:default}[data-studio-editor] button[data-save]{background:#ec995f;color:#15110e;font-weight:700}[data-studio-editor] label{display:block;margin:12px 0}[data-studio-editor] textarea{display:block;width:100%;resize:vertical;margin:5px 0 15px;line-height:1.65}[data-studio-editor] .se-grid{overflow:auto;max-height:460px}[data-studio-editor] table{border-collapse:collapse}[data-studio-editor] th{background:#293244;position:sticky;top:0;padding:6px}[data-studio-editor] td{padding:0;border:1px solid #394455}[data-studio-editor] td input{width:140px;border:0;border-radius:0;padding:8px}[data-studio-editor] input[readonly]{color:#9cacc4;background:#263244}[data-studio-editor] canvas{max-width:100%;max-height:520px;object-fit:contain;background:repeating-conic-gradient(#aaa 0% 25%,#fff 0% 50%) 0 0/20px 20px}[data-studio-editor] p{color:#b7c2d1}[data-studio-editor] :focus-visible{outline:2px solid #ffb679;outline-offset:2px}[data-studio-editor] [data-status]{min-height:24px;white-space:pre-wrap}[data-studio-editor] .se-toolbar label{margin:0}[data-studio-editor] .se-toolbar input[type=number]{width:100px}@media(max-width:600px){[data-studio-editor]{padding:12px}[data-studio-editor] header{align-items:stretch}[data-studio-editor] button{flex:1}}
      </style><header><div><small>CREATIVE STUDIO / EDITOR</small><h1 data-title>กำลังเปิดไฟล์…</h1><span data-file></span></div></header><p>แก้ไขด้วยมือ หรือเปิดไมค์แล้วบอก Sentinel เช่น “เปลี่ยน B2 เป็น 500” “แก้ข้อความหัวข้อแรก” หรือ “หมุนภาพ 90 องศา”</p><div class="se-toolbar"><button data-voice type="button">🎙 สั่งแก้ไขด้วยเสียง</button><button data-ai type="button">เปิด Sentinel AI</button><button data-undo type="button">ย้อนกลับ</button><button data-redo type="button">ทำซ้ำ</button><span data-count></span></div><div data-body></div><label>ชื่อฉบับแก้ไข<input data-name maxlength="130"></label><div class="se-toolbar"><button data-save type="button">บันทึกฉบับแก้ไข</button><button data-close type="button">ปิด</button></div><p data-draft-status role="status"></p><p data-status role="status" aria-live="polite"></p><div data-saved class="se-toolbar"></div></section>`,{width:1180,height:820,onClose:()=>cleanup(view)});
    const root=document.querySelector('.window[data-id="studio-editor"] [data-studio-editor]');if(!root)return false;
    const q=s=>root.querySelector('[data-'+s+']'),v=view={root,owner:identity(),abort:new AbortController(),ops:[],redo:[],sheet:0,page:0,body:q('body'),status:q('status'),draftStatus:q('draft-status'),name:q('name'),save:q('save'),undo:q('undo'),redoButton:q('redo'),count:q('count'),saved:q('saved')};
    v.save.onclick=()=>save(v);v.undo.onclick=()=>{if(v.ops.length)v.redo.push(v.ops.pop());v.retry=null;render(v);scheduleDraft(v);};v.redoButton.onclick=()=>{if(v.redo.length)v.ops.push(v.redo.pop());v.retry=null;render(v);scheduleDraft(v);};v.name.onchange=()=>{v.retry=null;scheduleDraft(v);};q('voice').onclick=()=>voice(v);q('ai').onclick=()=>{if(typeof openSentinel==='function')openSentinel();};q('close').onclick=()=>{if(!v.ops.length||window.confirm('ปิดโดยไม่บันทึกการแก้ไขหรือไม่?'))close();};controls(v);
    root.addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey)||e.altKey)return;const key=e.key.toLowerCase();if(key==='s'){e.preventDefault();document.activeElement?.blur();save(v);}else if(key==='z'&&!e.target.isContentEditable&&!['INPUT','TEXTAREA'].includes(e.target.tagName)){e.preventDefault();(e.shiftKey?v.redoButton:v.undo).click();}});
    try{const data=await api(v,'/api/studio/editor/'+encodeURIComponent(fileId));if(!current(v))return false;
      if(data.pluginId==='video'){close();window.PanthoriumMediaStudio?.open({fileId});return true;}
      v.data=data;q('title').textContent=titles[data.pluginId]||'แก้ไขผลงาน';q('file').textContent=data.file.name;v.name.value=data.file.name.replace(/\.[^.]+$/,'')+'-edited';
      if(data.pluginId==='image'){const response=await api(v,'/api/files/'+fileId+'/preview',{},true),blob=await response.blob();if(!current(v))return false;v.url=URL.createObjectURL(blob);v.image=new Image();v.image.onload=()=>{if(!current(v))return;if(v.image.naturalWidth*v.image.naturalHeight>16777216)return report(v,'ภาพมีขนาดเกิน 16 ล้านพิกเซล',true);render(v);};v.image.onerror=()=>report(v,'อ่านภาพไม่สำเร็จ',true);v.image.src=v.url;}
      else render(v);
      if(['document','spreadsheet','presentation'].includes(data.pluginId))await loadDraft(v);
    }catch(e){if(current(v))report(v,e.message,true);}return root;
  }
  window.PanthoriumStudioEditor=Object.freeze({open,close});
  window.addEventListener('panthorium:auth-changed',()=>{if(view&&(!allowed()||view.owner!==identity()))close();});
  window.addEventListener('pagehide',()=>cleanup(view));
})();
