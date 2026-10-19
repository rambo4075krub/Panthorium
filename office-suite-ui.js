/* Panthorium Documents / Sheets / Slides. Original interface and command model. */
(function(){
  'use strict';
  const css=`
  [data-studio-editor] .po-layout{display:grid;grid-template-columns:190px minmax(0,1fr);gap:18px;align-items:start}
  [data-studio-editor] .po-nav{display:flex;flex-direction:column;gap:8px;max-height:650px;overflow:auto;padding:12px;border:1px solid #3a4658;border-radius:12px}
  [data-studio-editor] .po-nav button{text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  [data-studio-editor] .po-nav button[aria-current=true]{border-color:#efad73;background:#503725}
  [data-studio-editor] .po-paper{background:#fff;color:#20252c;padding:54px;min-height:650px;box-shadow:0 10px 35px #0005;border-radius:3px;overflow-wrap:anywhere}
  [data-studio-editor] .po-paper img{display:block;max-width:100%;max-height:480px;object-fit:contain;margin:20px auto}[data-studio-editor] .po-paper table{width:100%;margin:18px 0;border-collapse:collapse}[data-studio-editor] .po-paper td{border:1px solid #cbd5e1;vertical-align:top;padding:4px}
  [data-studio-editor] .po-block{padding:8px;margin:3px 0;min-height:35px;outline:1px solid transparent;white-space:pre-wrap;cursor:text}
  [data-studio-editor] .po-block:focus{outline:2px solid #db945c;background:#fff9ef}
  [data-studio-editor] .po-block[aria-selected=true]{outline:1px dashed #bc783d}
  [data-studio-editor] .po-tools{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:12px;background:#222d3d;border-radius:12px;margin-bottom:16px}
  [data-studio-editor] .po-tools label{margin:0;font-size:12px}
  [data-studio-editor] .po-tools input[type=number]{width:76px}
  [data-studio-editor] .po-tools input[type=color]{padding:4px;width:44px;height:40px}
  [data-studio-editor] .po-formula{display:flex;gap:9px;align-items:center;margin-bottom:12px}
  [data-studio-editor] .po-formula input{min-width:0;flex:1}
  [data-studio-editor] .po-formula input:first-child{flex:0 0 95px;width:95px}
  [data-studio-editor] .po-sheet{overflow:auto;max-height:520px;border:1px solid #40506a;border-radius:9px}
  [data-studio-editor] .po-sheet th{z-index:1}
  [data-studio-editor] .po-sheet input{background:#fcfcfd;color:#172335;width:140px;border:0;border-radius:0}
  [data-studio-editor] .po-sheet input[data-formula=true]{background:#e8f3ee}
  [data-studio-editor] .po-sheet input:focus{outline:2px solid #d97d38;outline-offset:-2px}
  [data-studio-editor] .po-slide{position:relative;width:100%;aspect-ratio:16/9;background:white;overflow:hidden;border:1px solid #566076;container-type:inline-size;touch-action:none}
  [data-studio-editor] .po-shape{position:absolute;border:1px dashed #bdb7af;overflow:auto;min-width:20px;min-height:20px}
  [data-studio-editor] .po-shape .po-block{padding:1px 6px;min-height:12px;line-height:1.15}
  [data-studio-editor] .po-handle{height:16px;background:#f0c99b;color:#36200f;text-align:center;font-size:10px;line-height:16px;cursor:move;touch-action:none;user-select:none}
  [data-studio-editor] .po-chart{height:170px;display:flex;gap:12px;align-items:end;padding:15px;border-bottom:1px solid #647084;overflow:auto;margin:15px 0}
  [data-studio-editor] .po-bar{background:linear-gradient(#f5b97f,#d67538);min-width:35px;max-width:100px;flex:1;position:relative;color:#fff;text-align:center;font-size:12px}
  [data-studio-editor] .po-bar span{position:absolute;bottom:100%;left:0;right:0}
  [data-studio-editor] .po-note{font-size:12px;color:#bbc4d1}
  [data-studio-editor] .po-present .po-handle{display:none}
  [data-studio-editor] .po-present .po-shape{border:none}
  [data-studio-editor] .po-present{position:fixed;inset:0;z-index:100000;background:#111;display:flex;align-items:center}
  [data-studio-editor] .po-present .po-slide{max-height:100vh}
  @media(max-width:800px){[data-studio-editor] .po-layout{grid-template-columns:1fr}[data-studio-editor] .po-nav{flex-direction:row;max-height:100px}[data-studio-editor] .po-paper{padding:20px}}
  `;
  const core=()=>window.PanthoriumOfficeCore;
  function decorate(node,style={},scale=false){
    node.style.fontWeight=style.bold?'700':'400';node.style.fontStyle=style.italic?'italic':'normal';node.style.textDecoration=style.underline?'underline':'none';
    if(/^[0-9a-f]{6}$/i.test(style.color||''))node.style.color='#'+style.color;
    node.style.fontSize=scale?(style.fontSize||24)/7.5+'cqw':(style.fontSize||12)+'pt';node.style.textAlign=['left','center','right','justify'].includes(style.align)?style.align:'left';
  }
  function applyDraft(data,ops){
    const d=JSON.parse(JSON.stringify(data));
    for(const op of ops){
      if(['set_cell','set_formula','format_cell'].includes(op.type)){const s=d.sheets?.[op.sheet];if(!s)continue;let c=s.cells.find(c=>c.cell===op.cell);if(!c){c={cell:op.cell,value:''};s.cells.push(c);}if(op.type==='format_cell')c.style={...c.style,...op.style};else if(op.type==='set_formula'){c.formula=true;c.formulaText=op.value;}else c.value=op.value;}
      if(op.type==='set_text'){const b=d.blocks?.find(b=>b.index===op.index);if(b)b.text=op.value;}
      if(op.type==='format_text'){const b=d.blocks?.find(b=>b.index===op.index);if(b)b.style={...b.style,...op.style};}
      if(op.type==='move_text'){const b=d.blocks?.find(b=>b.index===op.index);if(b)for(const block of d.blocks.filter(x=>x.page===b.page&&x.shapeIndex===b.shapeIndex))block.geometry={x:op.x,y:op.y,width:op.width,height:op.height};}
      if(op.type==='slide_background'&&d.backgrounds)d.backgrounds[op.page-1]=op.color;
    }
    if(d.sheets)d.sheets=core().calculate(d.sheets);return d;
  }
  function render(ctx){
    const {v,change,rerender,el,button,report}=ctx;if(!['document','spreadsheet','presentation'].includes(v.data.pluginId)||!core())return false;
    const d=applyDraft(v.data,v.ops),kind=d.pluginId;v.body.append(el('style',css));
    const run=op=>{change(v,op);rerender(v);};
    const selected=()=>kind==='spreadsheet'?d.sheets[v.sheet].cells.find(c=>c.cell===v.cell):d.blocks.find(b=>b.index===v.selected);
    if(kind==='spreadsheet'&&!v.cell)v.cell='A1';if(kind!=='spreadsheet'&&v.selected==null)v.selected=d.blocks[0]?.index;
    const tools=el('div',null,{class:'po-tools'}),selection=el('strong',kind==='spreadsheet'?'เซลล์ '+v.cell:'ข้อความ '+((v.selected??-1)+1));tools.append(selection);
    const format=style=>{if(kind==='spreadsheet'){if(!selected())return report(v,'เพิ่มข้อมูลในเซลล์ก่อนจัดรูปแบบ',true);run({type:'format_cell',sheet:v.sheet,cell:v.cell,style});}else if(selected())run({type:'format_text',index:v.selected,style});};
    for(const [label,key]of [['ตัวหนา','bold'],['ตัวเอียง','italic'],['ขีดเส้นใต้','underline']])tools.append(button(label,()=>format({[key]:!selected()?.style?.[key]}),{'aria-pressed':String(!!selected()?.style?.[key])}));
    const size=el('input',null,{type:'number',min:8,max:96,'aria-label':'ขนาดตัวอักษร'});size.value=selected()?.style?.fontSize||12;size.onchange=()=>{const n=Number(size.value);if(Number.isInteger(n)&&n>=8&&n<=96)format({fontSize:n});};tools.append(size);
    const color=el('input',null,{type:'color','aria-label':'สีตัวอักษร'});color.value='#'+(selected()?.style?.color||'20252C');color.onchange=()=>format({color:color.value.slice(1)});tools.append(color);
    const align=el('select',null,{'aria-label':'จัดแนวข้อความ'});for(const [val,title]of [['left','ชิดซ้าย'],['center','กึ่งกลาง'],['right','ชิดขวา'],['justify','เต็มแนว']])align.append(el('option',title,{value:val}));align.value=selected()?.style?.align||'left';align.onchange=()=>format({align:align.value});tools.append(align);v.body.append(tools);
    const selectBlock=index=>{v.selected=index;selection.textContent='ข้อความ '+(index+1);size.value=selected()?.style?.fontSize||12;color.value='#'+(selected()?.style?.color||'20252C');align.value=selected()?.style?.align||'left';for(const [k,label]of [['x','ซ้าย %'],['y','บน %'],['width','กว้าง %'],['height','สูง %']]){const input=v.body.querySelector('[aria-label="'+label+'"]');if(input)input.value=String(Math.round((selected()?.geometry?.[k]||0)*10)/10);}for(const n of v.body.querySelectorAll('[data-text-index]'))n.setAttribute('aria-selected',String(Number(n.dataset.textIndex)===index));};
    function block(b,slide=false){const node=el('div',b.text,{class:'po-block',contenteditable:'plaintext-only',role:'textbox','aria-multiline':'true','aria-label':'ข้อความ '+(b.index+1),'data-text-index':b.index,'aria-selected':String(v.selected===b.index)});decorate(node,b.style,slide);node.onfocus=()=>selectBlock(b.index);node.oninput=()=>{if(node.textContent!==(v.ops.filter(op=>op.type==='set_text'&&op.index===b.index).at(-1)?.value??b.text)){if(node.textContent.length>6000){node.textContent=b.text;return report(v,'ข้อความยาวเกิน 6,000 ตัวอักษร',true);}const last=v.ops.at(-1);if(last?.type==='set_text'&&last.index===b.index){last.value=node.textContent;v.retry=null;ctx.scheduleDraft(v);}else change(v,{type:'set_text',index:b.index,value:node.textContent});}};node.onpaste=e=>{e.preventDefault();const text=e.clipboardData?.getData('text/plain')||'';const range=window.getSelection()?.rangeCount?window.getSelection().getRangeAt(0):null;if(range&&node.contains(range.commonAncestorContainer)){range.deleteContents();const t=document.createTextNode(text);range.insertNode(t);range.setStartAfter(t);range.collapse(true);}else node.textContent+=text;node.dispatchEvent(new Event('input',{bubbles:true}));};return node;}
    if(kind==='spreadsheet'){
      const nav=el('div',null,{class:'po-tools'});d.sheets.forEach((s,i)=>nav.append(button(s.name,()=>{v.sheet=i;v.page=0;rerender(v);},{'aria-current':String(v.sheet===i)})));v.body.append(nav);
      const sheet=d.sheets[v.sheet],lookup=new Map(sheet.cells.map(c=>[c.cell,c]));
      const form=el('form',null,{class:'po-formula'}),address=el('input',null,{'aria-label':'ตำแหน่งเซลล์',value:v.cell}),formula=el('input',null,{'aria-label':'ค่าหรือสูตร',placeholder:'เช่น =SUM(B2:B10) หรือข้อความ',maxlength:2000});const updateBar=c=>{v.cell=c;address.value=c;const item=lookup.get(c);formula.value=item?.formulaText||String(item?.value??'');selection.textContent='เซลล์ '+c;size.value=item?.style?.fontSize||12;color.value='#'+(item?.style?.color||'20252C');align.value=item?.style?.align||'left';};updateBar(v.cell);
      const set=(ref,value)=>{if(!/^[A-Z]{1,2}[1-9]\d{0,3}$/.test(ref)||ref.replace(/\d/g,'').length===2&&ref.replace(/\d/g,'')>'AN'||Number(ref.match(/\d+/)[0])>1000)return report(v,'รองรับ A1–AN1000',true);const old=lookup.get(ref);
        if(value.startsWith('=')){try{core().parse(value);}catch(e){return report(v,'สูตรนี้ยังไม่รองรับ: '+e.message,true);}run({type:'set_formula',sheet:v.sheet,cell:ref,value});}
        else {if(old?.formula)return report(v,'เซลล์นี้เป็นสูตร ให้แก้สูตรโดยเริ่มด้วย =',true);run({type:'set_cell',sheet:v.sheet,cell:ref,value:value.trim()!==''&&Number.isFinite(Number(value))?Number(value):value});}
      };form.append(address,el('span','ƒx'),formula,el('button','ใช้ค่า / สูตร',{type:'submit'}));form.onsubmit=e=>{e.preventDefault();const ref=address.value.trim().toUpperCase();v.cell=ref;set(ref,formula.value);};v.body.append(form);
      const number=el('select',null,{'aria-label':'รูปแบบตัวเลข'});for(const [val,label]of [['general','ทั่วไป'],['integer','จำนวนเต็ม'],['decimal','ทศนิยม 2 ตำแหน่ง'],['percent','เปอร์เซ็นต์']])number.append(el('option',label,{value:val}));number.value=selected()?.style?.numberFormat||'general';number.onchange=()=>format({numberFormat:number.value});tools.append(number);
      const filter=el('input',null,{placeholder:'กรองแถวที่มีข้อความ…','aria-label':'กรองแถว'});filter.value=v.filter||'';filter.onchange=()=>{v.filter=filter.value;rerender(v);};tools.append(filter);
      const table=el('table'),head=el('tr');head.append(el('th','#'));const width=Math.min(40,Math.max(6,...sheet.cells.map(c=>{const letters=c.cell.match(/^[A-Z]+/)[0];return [...letters].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);})));for(let c=1;c<=width;c++)head.append(el('th',core().column(c)));table.append(head);
      for(let r=v.page*50+1;r<=v.page*50+50;r++){
        const cells=Array.from({length:width},(_,i)=>lookup.get(core().column(i+1)+r));if(v.filter&&!cells.some(c=>String(c?.calculated??c?.value??'').toLocaleLowerCase().includes(v.filter.toLocaleLowerCase())))continue;
        const row=el('tr');row.append(el('th',r));for(let c=1;c<=width;c++){const ref=core().column(c)+r,item=lookup.get(ref),td=el('td'),input=el('input',null,{'data-cell':ref,'data-formula':String(!!item?.formula),'aria-label':sheet.name+' '+ref,maxlength:2000});let val=item?.calculated??item?.value??'';if(typeof val==='number'){if(item?.style?.numberFormat==='decimal')val=val.toFixed(2);if(item?.style?.numberFormat==='integer')val=Math.round(val);if(item?.style?.numberFormat==='percent')val=(val*100).toFixed(2)+'%';}input.value=String(val);input.readOnly=!!item?.formula;decorate(input,item?.style);input.onfocus=()=>updateBar(ref);input.onchange=()=>set(ref,input.value);td.append(input);row.append(td);}table.append(row);
      }const scroll=el('div',null,{class:'po-sheet'});scroll.append(table);v.body.append(scroll);
      const paging=el('div',null,{class:'po-tools'});paging.append(button('← ก่อนหน้า',()=>{v.page=Math.max(0,v.page-1);rerender(v);}),el('span','แถว '+(v.page*50+1)+'–'+(v.page*50+50)),button('ถัดไป →',()=>{v.page=Math.min(19,v.page+1);rerender(v);}));v.body.append(paging);
      v.body.append(el('p','สูตร: '+core().supported.join(', ')+' · รองรับอ้างอิงข้ามชีต · สูตรที่ไม่รองรับจะแสดงข้อผิดพลาด ไม่ใช้ค่าเก่าแทนผลใหม่',{class:'po-note'}));
      tools.append(button('ดูกราฟตัวเลขในหน้านี้',()=>{v.chart=!v.chart;rerender(v);}));if(v.chart){const values=sheet.cells.filter(c=>Number(c.cell.match(/\d+/)[0])>=v.page*50+1&&Number(c.cell.match(/\d+/)[0])<=v.page*50+50&&typeof(c.calculated??c.value)==='number').slice(0,20),chart=el('div',null,{class:'po-chart','aria-label':'กราฟวิเคราะห์ชั่วคราว'}),max=Math.max(1,...values.map(c=>Math.abs(c.calculated??c.value)));for(const c of values){const val=c.calculated??c.value,bar=el('div',c.cell,{class:'po-bar'});bar.style.height=Math.max(2,Math.abs(val)/max*110)+'px';bar.append(el('span',val));chart.append(bar);}v.body.append(chart,el('p','กราฟนี้ใช้สำรวจข้อมูลบนหน้าจอ ความสูงแสดงขนาดของค่า · ยังไม่ฝังกราฟลงไฟล์',{class:'po-note'}));}
      return true;
    }
    const layout=el('div',null,{class:'po-layout'}),nav=el('nav',null,{class:'po-nav','aria-label':kind==='document'?'โครงเอกสาร':'สไลด์'}),work=el('div');layout.append(nav,work);v.body.append(layout);
    if(kind==='document'){
      const paper=el('div',null,{class:'po-paper'}),tables=new Map(),media=d.media||[];
      const picture=item=>{if(!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(item.dataUrl||''))return;paper.append(el('img',null,{src:item.dataUrl,alt:'ภาพในเอกสาร',loading:'lazy'}));};
      for(const b of d.blocks){for(const image of media.filter(m=>m.beforeIndex===b.index))picture(image);const n=block(b);
        if(b.table){const key=b.table.index;if(!tables.has(key)){const table=el('table');tables.set(key,{table,rows:new Map()});paper.append(table);}const t=tables.get(key);if(!t.rows.has(b.table.row)){const tr=el('tr');t.rows.set(b.table.row,{tr,cells:new Map()});t.table.append(tr);}const row=t.rows.get(b.table.row);if(!row.cells.has(b.table.column)){const td=el('td');row.cells.set(b.table.column,td);row.tr.append(td);}row.cells.get(b.table.column).append(n);}else paper.append(n);
        nav.append(button(b.text.slice(0,32)||'ย่อหน้า',()=>{n.focus();n.scrollIntoView?.({block:'center'});}));}
      for(const image of media.filter(m=>m.beforeIndex===null))picture(image);work.append(paper);
      for(const [i,op]of v.ops.entries())if(op.type==='append_paragraph'){const input=el('textarea',null,{'aria-label':'ย่อหน้าใหม่',maxlength:6000});input.value=op.value;input.onchange=()=>{v.ops[i]={...op,value:input.value};v.retry=null;ctx.scheduleDraft(v);};paper.append(input);}
      tools.append(button('＋ ย่อหน้า',()=>run({type:'append_paragraph',value:'ย่อหน้าใหม่'})),button('＋ ตารางจากข้อมูล',()=>{const text=window.prompt('วางข้อมูลตาราง: คั่นคอลัมน์ด้วยแท็บ และคั่นแถวด้วยบรรทัดใหม่');if(text!=null){const rows=text.split(/\r?\n/).map(r=>r.split('\t'));if(rows.length>30||rows.some(r=>r.length!==rows[0].length||r.length>10||r.some(c=>c.length>500)))return report(v,'ตารางรองรับ 30 แถว × 10 คอลัมน์ และจำนวนคอลัมน์ต้องตรงกัน',true);run({type:'insert_table',rows});}}));
      for(const op of v.ops.filter(o=>o.type==='insert_table')){const table=el('table');for(const row of op.rows){const tr=el('tr');for(const text of row)tr.append(el('td',text));table.append(tr);}paper.append(table);}
      const find=el('input',null,{'aria-label':'ค้นหาข้อความ',placeholder:'ค้นหา'}),replacement=el('input',null,{'aria-label':'แทนที่ด้วย',placeholder:'แทนที่ด้วย'});tools.append(find,replacement,button('แทนที่ทุกจุด',()=>{if(!find.value)return;const matches=d.blocks.filter(b=>b.text.includes(find.value));if(v.ops.length+matches.length>200)return report(v,'แบ่งแทนที่และบันทึกเป็นช่วง ครั้งละไม่เกิน 200 รายการ',true);for(const b of matches){const value=b.text.split(find.value).join(replacement.value);if(value.length>6000)return report(v,'ผลลัพธ์ยาวเกินขอบเขต',true);}for(const b of matches)change(v,{type:'set_text',index:b.index,value:b.text.split(find.value).join(replacement.value)});rerender(v);}));
      work.append(el('p','แก้ย่อหน้าและตาราง พร้อมภาพ PNG/JPEG ที่ฝังในไฟล์ · การแบ่งหน้า เซลล์ผสาน และรูปแบบขั้นสูงอาจแสดงต่างจากต้นฉบับ',{class:'po-note'}));return true;
    }
    v.slide=Math.min(v.slide||1,d.pageCount||Math.max(1,...d.blocks.map(b=>b.page)));const pages=d.pageCount||Math.max(1,...d.blocks.map(b=>b.page));
    for(let page=1;page<=pages;page++)nav.append(button(page+' · '+(d.blocks.find(b=>b.page===page)?.text||'สไลด์'),()=>{v.slide=page;v.selected=d.blocks.find(b=>b.page===page)?.index;rerender(v);},{'aria-current':String(page===v.slide)}));
    for(const op of v.ops.filter(o=>o.type==='add_slide'||o.type==='reorder_slide'))work.append(el('p',op.type==='add_slide'?'สไลด์ใหม่: '+op.value+' · บันทึกเพื่อเปิดแก้ไข':'ย้ายสไลด์ '+op.page+' ไปตำแหน่ง '+op.toPage+' เมื่อบันทึก'));
    const stage=el('div'),canvas=el('div',null,{class:'po-slide','aria-label':'พื้นที่จัดข้อความสไลด์ '+v.slide});canvas.style.aspectRatio=d.slideSize?d.slideSize.width+'/'+d.slideSize.height:'16/9';canvas.style.backgroundColor='#'+(d.backgrounds?.[v.slide-1]||'FFFFFF');stage.append(canvas);work.append(stage);
    for(const media of (d.media||[]).filter(m=>m.page===v.slide&&m.geometry))if(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(media.dataUrl||'')){const image=el('img',null,{src:media.dataUrl,alt:'ภาพในสไลด์'});image.style.position='absolute';image.style.objectFit='contain';for(const k of ['x','y','width','height'])image.style[({x:'left',y:'top'})[k]||k]=media.geometry[k]+'%';canvas.append(image);}
    const groups=new Map();for(const b of d.blocks.filter(b=>b.page===v.slide)){const key=b.shapeIndex??'block'+b.index;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(b);}
    let fallback=0;for(const blocks of groups.values()){
      const b=blocks[0],g=b.geometry||{x:5,y:5+fallback++*20,width:90,height:18},shape=el('div',null,{class:'po-shape'});for(const k of ['x','y','width','height'])shape.style[({x:'left',y:'top'})[k]||k]=g[k]+'%';
      const handle=el('div','⠿ ลากย้ายกล่องข้อความ',{class:'po-handle'});shape.append(handle);for(const item of blocks)shape.append(block(item,true));canvas.append(shape);
      if(b.geometry)handle.onpointerdown=e=>{e.preventDefault();selectBlock(b.index);const rect=canvas.getBoundingClientRect(),sx=e.clientX,sy=e.clientY;let x=g.x,y=g.y;handle.setPointerCapture?.(e.pointerId);
        handle.onpointermove=ev=>{x=Math.max(0,Math.min(100-g.width,g.x+(ev.clientX-sx)/rect.width*100));y=Math.max(0,Math.min(100-g.height,g.y+(ev.clientY-sy)/rect.height*100));shape.style.left=x+'%';shape.style.top=y+'%';};
        const end=()=>{handle.onpointermove=null;handle.onpointerup=null;handle.onpointercancel=null;if(x!==g.x||y!==g.y)run({type:'move_text',index:b.index,x,y,width:g.width,height:g.height});};handle.onpointerup=end;handle.onpointercancel=end;};
    }
    const geometry=el('form',null,{class:'po-tools'}),inputs={};for(const [k,label]of [['x','ซ้าย %'],['y','บน %'],['width','กว้าง %'],['height','สูง %']]){const lab=el('label',label),input=el('input',null,{type:'number',min:0,max:100,step:0.1,'aria-label':label});input.value=String(Math.round((selected()?.geometry?.[k]||0)*10)/10);lab.append(input);geometry.append(lab);inputs[k]=input;}
    geometry.append(el('button','ใช้ตำแหน่ง / ขนาด',{type:'submit'}));geometry.onsubmit=e=>{e.preventDefault();const target=selected();if(!target?.geometry)return report(v,'กล่องนี้ยังปรับตำแหน่งไม่ได้',true);const g=Object.fromEntries(Object.entries(inputs).map(([k,n])=>[k,Number(n.value)]));if(!Object.values(g).every(Number.isFinite)||g.x<0||g.y<0||g.width<1||g.height<1||g.x+g.width>100||g.y+g.height>100)return report(v,'กล่องข้อความต้องอยู่ภายในสไลด์',true);run({type:'move_text',index:target.index,...g});};work.append(geometry);
    const bg=el('input',null,{type:'color','aria-label':'สีพื้นหลังสไลด์'});bg.value='#'+(d.backgrounds?.[v.slide-1]||'FFFFFF');bg.onchange=()=>run({type:'slide_background',page:v.slide,color:bg.value.slice(1)});tools.append(button('＋ สไลด์',()=>{const value=window.prompt('หัวข้อสไลด์ใหม่');if(value?.trim())run({type:'add_slide',value});}),button('เลื่อนสไลด์ขึ้น',()=>{if(v.slide>1)run({type:'reorder_slide',page:v.slide,toPage:v.slide-1});}),button('เลื่อนสไลด์ลง',()=>{if(v.slide<pages)run({type:'reorder_slide',page:v.slide,toPage:v.slide+1});}),bg,button('＋ กล่องข้อความ',()=>{const value=window.prompt('ข้อความสำหรับกล่องใหม่');if(value?.trim())run({type:'add_slide_text',page:v.slide,value});}));
    for(const op of v.ops.filter(o=>o.type==='add_slide_text'&&o.page===v.slide))work.append(el('p','กล่องใหม่: '+op.value+' · บันทึกแล้วเปิดฉบับใหม่เพื่อจัดตำแหน่ง'));
    tools.append(button('ขยายพื้นที่สไลด์',()=>{stage.classList.add('po-present');const exit=button('ปิดมุมมองขยาย',()=>stage.classList.remove('po-present'));stage.append(exit);exit.focus();exit.onkeydown=e=>{if(e.key==='Escape')stage.classList.remove('po-present');};}));
    work.append(el('p','จัดข้อความ สีพื้นหลัง และดูภาพ PNG/JPEG ในสไลด์ · การครอปภาพ ลำดับซ้อน กราฟ เอฟเฟกต์ และแม่แบบขั้นสูงอาจแสดงต่างจากต้นฉบับ',{class:'po-note'}));return true;
  }
  window.PanthoriumOfficeSuite=Object.freeze({render,applyDraft});
})();
