/* Account-scoped Panthorium editor; original files are immutable, saves create copies. */
(function () {
  'use strict';
  const ID='studio-editor', UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const titles={image:'แก้ไขรูปภาพ',document:'Panthorium Documents',spreadsheet:'Panthorium Sheets',presentation:'Panthorium Slides'};
  const os=()=>{try{return typeof OS!=='undefined'?OS:window.OS;}catch(_){return null;}};
  const identity=()=>JSON.stringify([os()?.state?.user?.sub||os()?.state?.user?.id,os()?.state?.user?.roles,os()?.state?.user?.permissions]);
  const allowed=()=>{const u=os()?.state?.user;return !!u && !String(u.sub||u.id||'').startsWith('guest:') && !u.roles?.includes('guest') && !!window.PanthoriumWindowCatalog?.allowed?.(window.PanthoriumWindowCatalog.apps.find(a=>a.id==='studio-document'),u);};
  let view=null;
  const instances=new Set();
  const current=v=>instances.has(v) && v.root.isConnected && v.owner===identity() && allowed();
  const el=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
  const button=(text,fn,attrs={})=>{const n=el('button',text,{type:'button',...attrs});n.onclick=fn;return n;};
  const messages={editor_sheet_not_in_snapshot:'กรุณาบันทึกและเปิดฉบับใหม่ก่อนเลือกชีตที่เพิ่งสร้าง',editor_pivot_ambiguous_headers:'หัวตาราง Pivot ต้องเป็นข้อความที่ไม่ว่างและไม่ซ้ำกัน',editor_pivot_ambiguous_group:'ชื่อกลุ่ม Pivot ต่างกันเฉพาะตัวพิมพ์ กรุณาจัดชื่อให้ชัดเจนก่อน',editor_pivot_numeric_values_required:'ผลรวมและค่าเฉลี่ย Pivot ต้องมีตัวเลขทุกแถวในคอลัมน์ค่า',editor_pivot_derived_dependency_unsupported:'ข้อมูลต้นทางอ้างกลับมายังผล Pivot จึงคำนวณอย่างปลอดภัยไม่ได้',editor_pivot_group_limit:'Pivot รองรับไม่เกิน 998 กลุ่ม',editor_pivot_result_readonly:'ชีตผล Pivot เป็นข้อมูลคำนวณ กรุณาแก้ชีตต้นทาง',editor_imported_pivot_edit_unsupported:'Pivot ที่นำเข้ายังแก้ข้อมูลที่นี่ไม่ได้ เพื่อป้องกันผลสรุปเก่า กรุณาใช้ Excel/LibreOffice',editor_pivot_modified_externally:'Pivot นี้ถูกแก้จากภายนอกและยังอัปเดตอย่างปลอดภัยไม่ได้ กรุณาใช้ Excel/LibreOffice',editor_pivot_sheet_exists:'มีชื่อชีตผล Pivot นี้แล้ว กรุณาใช้ชื่อใหม่',editor_pivot_formula_cycle:'สูตรต้นทางวนกลับหา Pivot จึงยังสร้างหรืออัปเดตไม่ได้',editor_pivot_formula_error:'สูตรต้นทางมีข้อผิดพลาดหรือยังไม่รองรับ',invalid_editor_pivot_range:'ช่วง Pivot ต้องรวมหัวตารางและข้อมูล อยู่ภายใน A1–AN1000',editor_pivot_range_too_large:'ช่วง Pivot รองรับไม่เกิน 10,000 เซลล์',editor_revision_pending:'มีประวัติการแก้ไขค้าง กรุณารับ/ปฏิเสธและบันทึกก่อนจัดรูปแบบ',editor_revision_unsupported:'ข้อความหรือประวัติการแก้ไขนี้มีโครงสร้างที่ยังไม่รองรับ จึงเก็บไว้โดยไม่แก้ไข',editor_revision_not_found:'รหัสการแก้ไขไม่ตรงกับฉบับที่อ่าน กรุณาเปิดไฟล์ใหม่',editor_nested_table_target:'เลือกข้อความในเซลล์ตารางที่รองรับก่อนเพิ่มตารางซ้อน',editor_table_nesting_limit:'รองรับตารางซ้อนสูงสุด 3 ชั้น',editor_table_limit:'เอกสารนี้ถึงขอบเขต 100 ตารางแล้ว',editor_rich_text_protected:'ข้อความนี้มีฟิลด์ ลิงก์ หรือประวัติการแก้ไข ใช้แผง Track Changes สำหรับรายการที่รองรับ หรือโปรแกรม Office ต้นฉบับ',editor_page_text_unsupported:'หัว/ท้ายกระดาษมีหลายส่วนหรือโครงสร้างซับซ้อน จึงเก็บไว้โดยไม่แก้ไข',editor_chart_existing_drawing:'ชีตนี้มีภาพหรือกราฟอยู่แล้ว กรุณาสร้างกราฟในชีตที่ยังไม่มีภาพหรือกราฟ',editor_chart_numeric_values_required:'ช่วงกราฟต้องมีคอลัมน์ชื่อและคอลัมน์ตัวเลขทุกแถว ไม่รวมแถวหัวตาราง',editor_chart_formula_error:'สูตรในช่วงกราฟมีข้อผิดพลาด กรุณาแก้สูตรก่อน',invalid_editor_chart_range:'กราฟรองรับสองคอลัมน์ติดกัน ไม่เกิน 100 แถว ใน A1–AN1000',editor_formula_unsupported:'สูตรนี้ยังไม่อยู่ในชุดที่รองรับ กรุณาดูรายการสูตรในหน้าตาราง',editor_formula_shared_readonly:'สูตรแบบ shared/array ต้องแก้ในโปรแกรมที่รองรับสูตรชนิดนี้',invalid_office_style:'รูปแบบไม่ถูกต้อง',editor_cell_empty:'เพิ่มข้อมูลในเซลล์ก่อนจัดรูปแบบ',editor_geometry_unsupported:'กล่องข้อความนี้ยังปรับตำแหน่งไม่ได้',editor_source_changed:'ต้นฉบับเปลี่ยนแล้ว กรุณาเปิดไฟล์ใหม่ก่อนบันทึก',editor_formula_cell_readonly:'เซลล์สูตรคำนวณถูกเก็บไว้และยังแก้ไขจากหน้านี้ไม่ได้',editor_office_unsupported:'โครงสร้างไฟล์นี้ยังเปิดแก้ไขไม่ได้ ใช้โปรแกรม Office สำหรับไฟล์นี้',editor_file_too_complex:'ไฟล์มีขนาดหรือโครงสร้างเกินขอบเขตตัวแก้ไข',editor_crop_out_of_bounds:'พื้นที่ครอปต้องอยู่ภายในภาพ',editor_changes_too_large:'มีการแก้ไขมากเกินไป กรุณาแบ่งบันทึกเป็นช่วง',editor_cell_out_of_range:'รองรับเซลล์ A1 ถึง AN1000',studio_plugin_disabled:'ปลั๊กอินนี้ตั้งเป็น Never ให้เปลี่ยนเป็น Auto ก่อนบันทึก',account_changed:'บัญชีเปลี่ยนแล้ว',file_not_found:'ไม่พบไฟล์ในบัญชีนี้'};
  function report(v,text,error=false){if(current(v)){v.status.textContent=messages[text]||text;v.status.dataset.error=String(error);v.status.style.color=error?'#ffadad':'#ffca9b';}}
  async function api(v,url,options={},raw=false){
    if(!current(v))throw Error('account_changed');
    const send=()=>fetch(String(os()?.config?.backendUrl||'').replace(/\/$/,'')+url,{...options,signal:v.abort.signal,credentials:'include',cache:'no-store',headers:{...(options.body?{'Content-Type':'application/json'}:{}),Authorization:'Bearer '+(os()?.config?.accessToken||''),...options.headers}});
    let r=await send();if(r.status===401 && current(v) && await window.PanthoriumAuth?.refreshSession?.().catch(()=>false))r=await send();
    if(!current(v))throw Error('account_changed');if(raw && r.ok)return r;
    const data=await r.json();if(!current(v))throw Error('account_changed');if(!r.ok||data.ok===false)throw Error(data.error||'HTTP '+r.status);return data;
  }
  function cleanup(v){if(!v)return;clearTimeout(v.draftTimer);v.panelObserver?.disconnect();v.abort.abort();if(v.url)URL.revokeObjectURL(v.url);v.ops=[];v.redo=[];v.imagePreviews?.clear();v.imageLoading?.clear();v.data=null;instances.delete(v);if(view===v)view=null;}
  function close(target=view){const v=target;if(!v)return;cleanup(v);if(v.container){v.container.replaceChildren();v.options.onClose?.();}else if(typeof closeWindow==='function')closeWindow(ID);else document.querySelector('.window[data-id="studio-editor"]')?.remove();}
  function dispose(container){for(const v of [...instances])if(v.container===container)close(v);}
  function controls(v){if(!current(v))return;v.save.disabled=v.busy||!v.ops.length;v.undo.disabled=v.busy||!v.ops.length;v.redoButton.disabled=v.busy||!v.redo.length;v.count.textContent=v.ops.length+' การแก้ไขที่ยังไม่บันทึก';}
  function change(v,op){if(!current(v)||v.busy||v.finished)return;if(v.ops.length>=200)return report(v,'บันทึกฉบับนี้ก่อน แล้วแก้ไขต่อได้สูงสุดครั้งละ 200 รายการ',true);v.ops.push(op);(v.groups||=[]).push(1);v.redo=[];v.redoGroups=[];v.retry=null;controls(v);scheduleDraft(v);}
  function changeBatch(v,operations){if(!current(v)||v.busy||v.finished)return false;if(new TextEncoder().encode(JSON.stringify({fileId:v.data.file.id,revision:v.data.revision,operations:[...v.ops,...operations]})).length>42000){report(v,'ข้อมูลที่วางใหญ่เกินขอบเขต กรุณาแบ่งเป็นช่วง',true);return false;}if(v.ops.length+operations.length>200){report(v,'แบ่งบันทึกครั้งละไม่เกิน 200 การแก้ไข',true);return false;}for(const op of operations)change(v,op);if(operations.length)v.groups.splice(-operations.length,operations.length,operations.length);return true;}
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
        v.body.inert=true;v.save.disabled=true;const banner=el('div',null,{class:'se-toolbar'});v.saved.append(banner);banner.append(el('span','พบฉบับร่างที่ยังไม่ได้บันทึกเป็นไฟล์'),button('กู้คืนฉบับร่าง',()=>{v.ops=draft.data.operations;v.groups=v.ops.map(()=>1);v.redoGroups=[];v.name.value=draft.data.name;v.body.inert=false;banner.remove();render(v);v.draftStatus.textContent='กู้คืนแล้ว · บันทึกเมื่อพร้อม';}),button('เริ่มจากต้นฉบับ',()=>{v.body.inert=false;banner.remove();persistDraft(v).catch(()=>{});controls(v);}));
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
    const layout=el('div',null,{class:'se-image-layout'}),stage=el('div',null,{class:'se-image-stage'}),surface=el('div',null,{class:'se-image-surface'}),inspector=el('section',null,{class:'se-inspector','aria-label':'เครื่องมือรูปภาพ'});
    const bar=el('div',null,{class:'se-toolbar'});inspector.append(el('h2','ปรับรูปภาพ'),bar);
    for(const [label,op]of [['หมุน 90°',{type:'rotate',degrees:90}],['หมุนซ้าย',{type:'rotate',degrees:270}],['กลับซ้าย–ขวา',{type:'flip',axis:'horizontal'}],['กลับบน–ล่าง',{type:'flip',axis:'vertical'}],['สว่างขึ้น',{type:'brightness',amount:0.1}],['มืดลง',{type:'brightness',amount:-0.1}]])bar.append(button(label,()=>{change(v,op);render(v);}));
    v.canvas=el('canvas',null,{'aria-label':'ตัวอย่างรูปภาพ · ลากเพื่อเลือกพื้นที่ครอป'});v.dim=el('p');const selection=el('div',null,{class:'se-crop-selection',hidden:''});surface.append(v.canvas,selection);stage.append(surface);layout.append(stage,inspector);v.body.append(layout);
    const crop=el('form'),inputs={};for(const [key,label]of [['x','ซ้าย (px)'],['y','บน (px)'],['width','กว้าง (px)'],['height','สูง (px)']]){const l=el('label',label),i=el('input',null,{type:'number',min:key==='x'||key==='y'?'0':'1',step:'1',max:'16384',required:'','aria-label':label});i.value=key==='x'||key==='y'?'0':'';inputs[key]=i;l.append(i);crop.append(l);}
    const showSelection=()=>{const x=Number(inputs.x.value),y=Number(inputs.y.value),width=Number(inputs.width.value),height=Number(inputs.height.value);const valid=[x,y,width,height].every(Number.isInteger)&&x>=0&&y>=0&&width>0&&height>0&&x+width<=v.canvas.width&&y+height<=v.canvas.height;selection.hidden=!valid;if(valid){selection.style.left=x/v.canvas.width*100+'%';selection.style.top=y/v.canvas.height*100+'%';selection.style.width=width/v.canvas.width*100+'%';selection.style.height=height/v.canvas.height*100+'%';}return valid;};
    for(const input of Object.values(inputs))input.oninput=showSelection;
    const pick=box=>{for(const [key,value]of Object.entries(box))inputs[key].value=String(value);showSelection();};
    const presets=el('div',null,{class:'se-toolbar'});for(const [name,ratio]of [['1:1',1],['16:9',16/9],['9:16',9/16]])presets.append(button(name,()=>{const width=Math.min(v.canvas.width,Math.floor(v.canvas.height*ratio)),height=Math.min(v.canvas.height,Math.floor(width/ratio));pick({x:Math.floor((v.canvas.width-width)/2),y:Math.floor((v.canvas.height-height)/2),width,height});},{'aria-label':'เลือกครอป '+name}));
    crop.append(el('button','ครอป',{type:'submit'}));crop.onsubmit=e=>{e.preventDefault();if(!showSelection())return report(v,'พื้นที่ครอปต้องอยู่ภายในภาพ และใช้ขนาดเป็นพิกเซลเต็ม',true);const op={type:'crop'};for(const [k,i]of Object.entries(inputs))op[k]=Number(i.value);change(v,op);render(v);};
    inspector.append(el('h2','ครอปภาพ'),presets,el('p','ลากบนภาพเพื่อเลือกพื้นที่ หรือกำหนดขนาดด้านล่าง'),crop,v.dim,el('p','บันทึกเป็น PNG · เก็บต้นฉบับไว้ สีตัวอย่างอาจต่างจากไฟล์ที่ประมวลผลเล็กน้อย'));
    v.canvas.onpointerdown=e=>{if(e.button!==0||v.busy||v.finished)return;e.preventDefault();const rect=v.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;const point=ev=>({x:Math.round(Math.max(0,Math.min(1,(ev.clientX-rect.left)/rect.width))*v.canvas.width),y:Math.round(Math.max(0,Math.min(1,(ev.clientY-rect.top)/rect.height))*v.canvas.height)}),start=point(e);v.canvas.setPointerCapture?.(e.pointerId);v.canvas.onpointermove=ev=>{const end=point(ev);pick({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)});};const end=()=>{v.canvas.onpointermove=null;v.canvas.onpointerup=null;v.canvas.onpointercancel=null;};v.canvas.onpointerup=end;v.canvas.onpointercancel=end;};
    draw(v);
  }
  function loadImagePreviews(v){v.imagePreviews||=new Map();v.imageLoading||=new Set();for(const op of v.ops.filter(o=>o.type==='insert_image')){if(v.imagePreviews.has(op.fileId)||v.imageLoading.has(op.fileId))continue;v.imageLoading.add(op.fileId);(async()=>{try{const r=await api(v,'/api/files/'+op.fileId+'/preview',{},true),blob=await r.blob();if(blob.size>2*1024*1024||!/^image\/(png|jpeg)$/.test(blob.type))throw Error('editor_image_budget');const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});if(current(v)){v.imagePreviews.set(op.fileId,{dataUrl});if(v.ops.some(o=>o.type==='insert_image'&&o.fileId===op.fileId))render(v);}}catch(e){if(current(v))report(v,'เปิดภาพประกอบไม่สำเร็จ: '+e.message,true);}finally{v.imageLoading.delete(op.fileId);}})();}}
  function render(v){if(!current(v)||!v.data)return;loadImagePreviews(v);v.body.replaceChildren();if(window.PanthoriumOfficeSuite?.render({v,change,changeBatch,api:(...args)=>api(v,...args),rerender:render,el,button,report,scheduleDraft})){controls(v);return;}const d=model(v);if(d.sheets)renderSheet(v,d);else if(d.blocks)renderText(v,d);else if(d.pluginId==='image')renderImage(v);controls(v);}
  async function save(v){
    if(!current(v)||v.busy||!v.ops.length)return;clearTimeout(v.draftTimer);v.busy=true;controls(v);v.body.inert=true;v.name.disabled=true;
    try{
      if(v.draftPromise)await v.draftPromise.catch(()=>{});
      const body=v.retry||(v.retry={pluginId:v.data.pluginId,sourceFileIds:[v.data.file.id],input:{prompt:'แก้ไขไฟล์และบันทึกฉบับใหม่',name:v.name.value,edit:{fileId:v.data.file.id,revision:v.data.revision,operations:JSON.parse(JSON.stringify(v.ops))}},idempotencyKey:'editor:'+crypto.randomUUID(),confirmed:true});
      const data=await api(v,'/api/studio/jobs',{method:'POST',body:JSON.stringify(body)});if(!current(v))return;
      if(v.options.onSaved)v.options.onSaved(data.job);else window.PanthoriumCreativeStudio?.showJob(data.job);
      if(data.job.status==='completed'){
        v.ops=[];v.redo=[];v.retry=null;const file=data.job.files.find(f=>f.pluginId===v.data.pluginId)||data.job.files[0];
        report(v,'บันทึกแล้ว: '+file.name+' · ต้นฉบับยังอยู่');v.saved.replaceChildren(button('เปิดฉบับแก้ไขต่อ',()=>open(file.id,v.options)),button('ดูผลงานทั้งหมด',()=>window.PanthoriumCreativeStudio?.showJob(data.job)));
        // Freeze the completed editor until the saved copy is opened explicitly.
        v.body.inert=true;v.finished=true;await persistDraft(v).catch(()=>{});
      } else if(['failed','blocked','needs_review'].includes(data.job.status)) {v.retry=null;report(v,data.job.error||'บันทึกไม่สำเร็จ กรุณาตรวจรายการงาน',true);}
      else report(v,'รับงานแล้ว ติดตามผลในรายการงานก่อนส่งซ้ำ');
    }catch(e){if(current(v))report(v,e.message,true);}finally{if(current(v)){v.busy=false;if(!v.finished)v.body.inert=false;v.name.disabled=!!v.finished;controls(v);}}
  }
  async function voice(v){
    if(!current(v)||!v.data)return;
    const result=await window.PanthoriumCreativeVoice?.start(v.data.pluginId);
    if(current(v)&&result)report(v,result.text,!result.ok);
  }
  const voiceInstance=container=>[...instances].find(v=>v.container===container&&current(v));
  function voiceSnapshot(container){const v=voiceInstance(container);return v?.data?JSON.stringify({file:v.data.file.id,revision:v.data.revision,ops:v.ops,name:v.name.value,finished:!!v.finished}):null;}
  async function command(container,c){
    const v=voiceInstance(container),ui=window.PanthoriumCreativeVoice;
    if(!v?.data||v.busy||v.finished||v.body.inert)return ui.fail('เปิดไฟล์ที่แก้ไขได้ และกู้คืนหรือทิ้งฉบับร่างที่ค้างก่อนสั่งงาน');
    if(v.root.contains(document.activeElement))document.activeElement.blur();
    v.status.dataset.error='false';
    try{
      if(c.action==='rename'){if(c.text.length>130)return ui.fail('ชื่อยาวได้ไม่เกิน 130 ตัวอักษร');v.name.value=c.text;v.retry=null;scheduleDraft(v);return ui.ok('ตั้งชื่อฉบับแก้ไขแล้ว');}
      if(c.action==='save'){if(!v.ops.length)return ui.fail('ไม่มีการแก้ไขที่ต้องบันทึก');await save(v);return v.status.dataset.error==='true'?ui.fail(v.status.textContent):ui.ok(v.status.textContent);}
      if(c.action==='undo'||c.action==='redo'){await ui.click(c.action==='undo'?v.undo:v.redoButton);return ui.ok(c.action==='undo'?'ย้อนกลับการแก้ไขแล้ว':'ทำซ้ำการแก้ไขแล้ว');}
      return await window.PanthoriumOfficeSuite.command({v,changeBatch,rerender:render},c);
    }catch(e){return ui.fail(e.message);}
  }
  async function open(fileId,options={}){
    if(!UUID.test(fileId||'')||!allowed())return false;
    const previous=[...instances].find(v=>v.container===(options.container||null));
    if(previous&&current(previous)&&previous.data?.file.id===fileId){if(!options.container)window.PanthoriumWindowManager?.restore?.(ID);return previous.root;}
    if(previous?.busy)return false;
    if(previous?.ops.length&&!window.confirm('มีการแก้ไขที่ยังไม่บันทึก ต้องการปิดแล้วเปิดไฟล์อื่นหรือไม่?'))return false;
    if(previous){cleanup(previous);previous.root.remove();}if(!options.container&&typeof createWindow!=='function')return false;
    const html=`<section data-studio-editor data-focus="false" data-menu-open="false"><style>
      [data-studio-editor]{box-sizing:border-box;height:100%;min-height:0;overflow:hidden;display:flex;flex-direction:column;background:var(--bg,#0c1420);color:var(--text,#eef1f5);font:13px/1.5 system-ui;container:editor / inline-size}
      [data-studio-editor] *{box-sizing:border-box;min-width:0}
      [data-studio-editor] button,[data-studio-editor] input,[data-studio-editor] select,[data-studio-editor] textarea{font:inherit;color:inherit;background:#142437;border:1px solid #3a536a;border-radius:7px;padding:7px 10px;max-width:100%}
      [data-studio-editor] button{cursor:pointer;min-height:36px;white-space:nowrap}
      [data-studio-editor] button:disabled{opacity:.45;cursor:default}
      [data-studio-editor] [data-save]{background:#75e6e5!important;color:#08242d!important;font-weight:700;flex:none}
      [data-studio-editor] .se-topbar{display:flex;align-items:center;gap:8px;flex:none;padding:8px 12px;border-bottom:1px solid #87dfff25;background:#101f30}
      [data-studio-editor] .se-file{flex:1;min-width:120px}
      [data-studio-editor] .se-file input{width:100%;padding:4px 7px;border-color:transparent;background:transparent;font-weight:600}
      [data-studio-editor] .se-file small{display:block;font-size:10px;color:#97b5c8;padding-left:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      [data-studio-editor] [data-title]{font-size:11px;color:#97b5c8;flex:none}
      [data-studio-editor] .se-actionbar{display:flex;gap:5px;align-items:center;flex:none;overflow-x:auto;padding:5px 12px;border-bottom:1px solid #87dfff25;scrollbar-width:thin}
      [data-studio-editor] .se-actionbar>*{flex:none}
      [data-studio-editor] .se-actionbar [data-focus]{margin-left:auto}
      [data-studio-editor] .se-actionbar button{min-height:34px;font-size:12px;padding:5px 9px}
      [data-studio-editor] [data-body]{flex:1;min-height:0;overflow:auto;position:relative;display:flex;flex-direction:column}
      [data-studio-editor] .se-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0}
      [data-studio-editor] label{display:block;margin:8px 0}
      [data-studio-editor] textarea{display:block;width:100%;resize:vertical;margin:5px 0;line-height:1.65}
      [data-studio-editor] .se-grid{overflow:auto;flex:1;min-height:180px}
      [data-studio-editor] table{border-collapse:collapse}
      [data-studio-editor] th{background:#23384c;position:sticky;top:0;padding:6px}
      [data-studio-editor] td{padding:0;border:1px solid #394455}
      [data-studio-editor] td input{width:140px;border:0;border-radius:0;padding:8px}
      [data-studio-editor] p{color:#a5bdcf;margin:7px 0;font-size:12px;overflow-wrap:anywhere}
      [data-studio-editor] :focus-visible{outline:2px solid #7be6e8;outline-offset:2px}
      [data-studio-editor] .se-footer{flex:none;padding:5px 12px;border-top:1px solid #87dfff25;background:#101e2d;max-height:28%;overflow:auto;font-size:11px}
      [data-studio-editor] .se-footer-line{display:flex;gap:12px;justify-content:space-between;align-items:center}
      [data-studio-editor] .se-footer p{margin:2px 0;font-size:11px}
      [data-studio-editor] [data-status]:empty,[data-studio-editor] [data-draft-status]:empty,[data-studio-editor] [data-saved]:empty{display:none}
      [data-studio-editor] [data-status]{white-space:pre-wrap}
      [data-studio-editor] .se-help{padding:10px 14px;margin:0;border-bottom:1px solid #87dfff25;background:#14283b}
      [data-studio-editor] [hidden]{display:none!important}
      [data-studio-editor] .se-image-layout{display:grid;grid-template-columns:minmax(0,1fr) 260px;flex:1;min-height:0;overflow:hidden}
      [data-studio-editor] .se-image-stage{display:grid;place-items:center;overflow:auto;min-height:0;padding:24px;background:radial-gradient(ellipse at center,#23394c,#0b121d 75%)}
      [data-studio-editor] .se-image-surface{position:relative;line-height:0;max-width:100%;max-height:100%}
      [data-studio-editor] canvas{display:block;max-width:100%;max-height:calc(100dvh - 280px);width:auto;height:auto;object-fit:contain;touch-action:none;cursor:crosshair;background:repeating-conic-gradient(#aaa 0% 25%,#fff 0% 50%) 0 0/20px 20px;box-shadow:0 12px 32px #0007}
      [data-studio-editor] .se-crop-selection{position:absolute;pointer-events:none;border:2px solid #74ffff;background:#48dfe922;box-shadow:0 0 0 1px #132b3a}
      [data-studio-editor] .se-inspector{overflow:auto;padding:14px;border-left:1px solid #87dfff25;background:#101e2c;min-height:0}
      [data-studio-editor] .se-inspector h2{font-size:13px;color:#a8e8ef;margin:0 0 12px}
      [data-studio-editor] .se-inspector .se-toolbar{gap:7px}
      [data-studio-editor] .se-inspector form{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px}
      [data-studio-editor] .se-inspector form input{width:100%}
      [data-studio-editor] .se-inspector form button{grid-column:1/-1}
      [data-studio-editor][data-panels="false"] :is(.se-inspector,.po-inspector),[data-studio-editor][data-focus="true"] :is(.se-inspector,.po-inspector,.po-nav){display:none}
      [data-studio-editor]:is([data-panels="false"],[data-focus="true"]) .se-image-layout{grid-template-columns:minmax(0,1fr)}
      @container editor (max-width:760px){[data-studio-editor] .se-topbar{padding:6px 8px}[data-studio-editor] [data-title]{display:none}[data-studio-editor] .se-actionbar{padding:5px 8px}[data-studio-editor] .se-footer-line{flex-wrap:wrap;gap:2px}[data-studio-editor] .se-image-layout{grid-template-columns:minmax(0,1fr)}[data-studio-editor] .se-inspector{position:absolute;right:0;top:0;bottom:0;z-index:3;width:min(280px,88%);box-shadow:-10px 0 30px #0008}[data-studio-editor] canvas{max-height:calc(100dvh - 310px)}}

      [data-studio-editor] .se-chrome{display:flex;flex:none;align-items:center;border-bottom:1px solid #87dfff25;background:#101f30}
      [data-studio-editor] .se-chrome .se-topbar{flex:1;border:0;padding-right:4px}
      [data-studio-editor] .se-chrome .se-actionbar{border:0;padding-left:4px}
      [data-studio-editor] .se-chrome [data-title]{display:none}
      @container editor (max-width:1100px){[data-studio-editor] .se-chrome{display:block}[data-studio-editor] .se-chrome .se-topbar{padding:6px 8px}[data-studio-editor] .se-chrome .se-actionbar{padding:5px 8px;border-top:1px solid #87dfff25}}
      [data-studio-editor] .se-menu{display:none}
      @container editor (max-width:760px){[data-studio-editor] .se-menu{display:block;flex:none}[data-studio-editor] .se-chrome .se-actionbar{display:none;position:absolute;top:52px;right:4px;width:min(320px,90%);z-index:12;white-space:normal;flex-wrap:wrap;background:#102330!important;padding:10px;border:1px solid #37576a;box-shadow:0 10px 25px #0009}[data-studio-editor][data-menu-open="true"] .se-chrome .se-actionbar{display:flex}[data-studio-editor] .se-file small{display:none}[data-studio-editor] .se-topbar{min-height:46px}[data-studio-editor] .se-file{min-width:80px}}
      </style>
      <div class="se-chrome"><div class="se-topbar"><span data-title>กำลังเปิดไฟล์…</span><div class="se-file"><input data-name maxlength="130" aria-label="ชื่อฉบับแก้ไข" placeholder="ชื่อผลงาน"><small data-file></small></div><button data-save type="button" title="บันทึกฉบับใหม่ (Ctrl / ⌘ + S)">บันทึกฉบับแก้ไข</button><button type="button" class="se-menu" data-menu aria-expanded="false" aria-label="เมนูแก้ไข">⋯</button></div>
      <div class="se-actionbar" aria-label="เครื่องมือไฟล์"><button data-undo type="button" title="Ctrl / ⌘ + Z">ย้อนกลับ</button><button data-redo type="button" title="Ctrl / ⌘ + Shift + Z">ทำซ้ำ</button><button data-voice type="button">สั่งด้วยเสียง</button><button data-ai type="button">Sentinel AI</button><button data-help type="button" aria-expanded="false" aria-controls="studio-editor-help">วิธีใช้</button><button data-focus type="button" aria-pressed="false">ขยายพื้นที่ทำงาน</button><button data-panels type="button" aria-expanded="true">เครื่องมือเพิ่มเติม</button><button data-editor-close type="button">ปิดไฟล์</button></div></div>
      <p class="se-help" id="studio-editor-help" data-help-text hidden>แก้ไขชิ้นงานตรงกลาง ใช้เครื่องมือด้านข้างเพื่อแทรกและปรับรายละเอียด · Ctrl / ⌘ + S บันทึกฉบับใหม่โดยเก็บต้นฉบับ · Escape ออกจากโหมดขยาย · สั่งด้วยเสียง เช่น “เปลี่ยน B2 เป็น 500” หรือ “หมุนภาพ 90 องศา”</p>
      <div data-body></div><div class="se-footer"><div class="se-footer-line"><span data-count></span><p data-draft-status role="status"></p></div><p data-status role="status" aria-live="polite"></p><div data-saved class="se-toolbar"></div></div></section>`;
    if(options.container)options.container.innerHTML=html;else createWindow(ID,'แก้ไขผลงาน',html,{width:1280,height:820,onClose:()=>{for(const v of [...instances])if(!v.container)cleanup(v);}});
    const root=options.container?options.container.querySelector('[data-studio-editor]'):document.querySelector('.window[data-id="studio-editor"] [data-studio-editor]');if(!root)return false;
    const q=s=>root.querySelector('[data-'+s+']'),v=view={root,container:options.container||null,options,owner:identity(),abort:new AbortController(),ops:[],redo:[],groups:[],redoGroups:[],sheet:0,page:0,body:q('body'),status:q('status'),draftStatus:q('draft-status'),name:q('name'),save:q('save'),undo:q('undo'),redoButton:q('redo'),count:q('count'),saved:q('saved')};instances.add(v);
    q('menu').onclick=()=>{root.dataset.menuOpen=String(root.dataset.menuOpen!=='true');q('menu').setAttribute('aria-expanded',root.dataset.menuOpen);};root.querySelector('.se-actionbar').addEventListener('click',e=>{if(e.target.closest('button')){root.dataset.menuOpen='false';q('menu').setAttribute('aria-expanded','false');}});
    q('help-text').id='studio-help-'+fileId;q('help').setAttribute('aria-controls',q('help-text').id);
    v.save.onclick=()=>save(v);v.undo.onclick=()=>{if(v.ops.length){const n=v.groups.pop()||1;v.redo.push(...v.ops.splice(-n).reverse());v.redoGroups.push(n);}v.retry=null;render(v);scheduleDraft(v);};v.redoButton.onclick=()=>{if(v.redo.length){const n=v.redoGroups.pop()||1;for(let i=0;i<n;i++)v.ops.push(v.redo.pop());v.groups.push(n);}v.retry=null;render(v);scheduleDraft(v);};v.name.onchange=()=>{v.retry=null;scheduleDraft(v);};q('voice').onclick=()=>voice(v);q('ai').onclick=()=>{if(typeof openSentinel==='function')openSentinel();};controls(v);
    const panels = open => { root.dataset.panels=String(open);q('panels').setAttribute('aria-expanded',String(open)); };
    panels(!root.clientWidth || root.clientWidth > 760);
    v.panelsPreference=null;
    if(window.ResizeObserver){v.panelObserver=new ResizeObserver(()=>{if(current(v)&&v.panelsPreference===null)panels(root.clientWidth>760);});v.panelObserver.observe(root);}
    const focus = on => { root.dataset.focus=String(on);q('focus').setAttribute('aria-pressed',String(on));q('focus').textContent=on?'คืนมุมมองปกติ':'ขยายพื้นที่ทำงาน'; };
    q('focus').onclick=()=>focus(root.dataset.focus!=='true');
    q('panels').onclick=()=>{if(root.dataset.focus==='true')focus(false);v.panelsPreference=root.dataset.panels!=='true';panels(v.panelsPreference);};
    q('editor-close').onclick=()=>{if(!v.ops.length||window.confirm('ปิดโดยไม่บันทึกการแก้ไขหรือไม่?'))close(v);};
    q('help').onclick=()=>{q('help-text').hidden=!q('help-text').hidden;q('help').setAttribute('aria-expanded',String(!q('help-text').hidden));};
    root.addEventListener('keydown',e=>{if(e.key==='Escape'&&root.dataset.focus==='true'){focus(false);q('focus').focus();}});
    root.addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey)||e.altKey)return;const key=e.key.toLowerCase();if(key==='s'){e.preventDefault();document.activeElement?.blur();save(v);}else if(key==='z'&&!e.target.isContentEditable&&!['INPUT','TEXTAREA'].includes(e.target.tagName)){e.preventDefault();(e.shiftKey?v.redoButton:v.undo).click();}});
    try{const data=await api(v,'/api/studio/editor/'+encodeURIComponent(fileId));if(!current(v))return false;
      if(data.pluginId==='video'){close(v);window.PanthoriumMediaStudio?.open({fileId});return true;}
      v.data=data;root.dataset.editorKind=data.pluginId;q('title').textContent=titles[data.pluginId]||'แก้ไขผลงาน';q('file').textContent=data.file.name;v.name.value=data.file.name.replace(/\.[^.]+$/,'')+'-edited';
      if(data.pluginId==='image'){const response=await api(v,'/api/files/'+fileId+'/preview',{},true),blob=await response.blob();if(!current(v))return false;v.url=URL.createObjectURL(blob);v.image=new Image();v.image.onload=()=>{if(!current(v))return;if(v.image.naturalWidth*v.image.naturalHeight>16777216)return report(v,'ภาพมีขนาดเกิน 16 ล้านพิกเซล',true);render(v);};v.image.onerror=()=>report(v,'อ่านภาพไม่สำเร็จ',true);v.image.src=v.url;}
      else render(v);
      if(['document','spreadsheet','presentation'].includes(data.pluginId))await loadDraft(v);
    }catch(e){if(current(v))report(v,e.message,true);}return root;
  }
  window.PanthoriumStudioEditor=Object.freeze({command,voiceSnapshot,open:(fileId,options={})=>!options.container&&!options.standalone&&window.PanthoriumCreativeStudio?.editFile?window.PanthoriumCreativeStudio.editFile(fileId):open(fileId,options),close,dispose,isDirty:container=>[...instances].some(v=>v.container===container&&v.ops.length>0)});
  window.addEventListener('panthorium:auth-changed',()=>{for(const v of [...instances])if(!allowed()||v.owner!==identity())close(v);});
  window.addEventListener('pagehide',()=>{for(const v of [...instances])cleanup(v);});
})();
