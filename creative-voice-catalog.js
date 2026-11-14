/* Shared, bounded commands for the user's current Creative workspace. */
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.PanthoriumCreativeVoiceCatalog = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const kinds = { 'รูปภาพ':'image', 'รูป':'image', 'ภาพ':'image', 'photoshop':'image', 'วิดีโอ':'video', 'วีดีโอ':'video', 'วิดิโอ':'video', 'capcut':'video', 'เอกสาร':'document', 'เวิร์ด':'document', 'word':'document', 'ตาราง':'spreadsheet', 'สมุดงาน':'spreadsheet', 'เอ็กเซล':'spreadsheet', 'excel':'spreadsheet', 'งานนำเสนอ':'presentation', 'นำเสนอ':'presentation', 'สไลด์':'presentation', 'พาวเวอร์พอยต์':'presentation', 'powerpoint':'presentation' };
  const digits = '๐๑๒๓๔๕๖๗๘๙', words = {ศูนย์:0,หนึ่ง:1,เอ็ด:1,สอง:2,ยี่:2,สาม:3,สี่:4,ห้า:5,หก:6,เจ็ด:7,แปด:8,เก้า:9};
  function number(value) {
    const s = String(value).replace(/[๐-๙]/g, c => digits.indexOf(c)).replace(/\s/g, '');
    if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
    if (s === 'ครึ่ง') return .5;
    if (Object.hasOwn(words, s)) return words[s];
    const m = /^(หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า)?(ร้อย|พัน)(.*)$/.exec(s);
    if (m) { const rest=m[3]?number(m[3]):0; return Number.isFinite(rest)?(words[m[1]]||1)*(m[2]==='ร้อย'?100:1000)+rest:NaN; }
    const tens = /^(หนึ่ง|สอง|ยี่|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า)?สิบ(หนึ่ง|เอ็ด|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า)?$/.exec(s);
    return tens ? (words[tens[1]]||1)*10+(words[tens[2]]||0) : NaN;
  }
  const letters = {เอ:'A',บี:'B',ซี:'C',ดี:'D',อี:'E',เอฟ:'F',จี:'G',เอช:'H',ไอ:'I',เจ:'J',เค:'K',แอล:'L',เอ็ม:'M',เอ็น:'N',โอ:'O',พี:'P',คิว:'Q',อาร์:'R',เอส:'S',ที:'T',ยู:'U',วี:'V',ดับเบิลยู:'W',เอ็กซ์:'X',วาย:'Y',แซด:'Z'};
  function cell(value) {
    let s=value.trim().toUpperCase().replace(/\s/g,'');
    for (const key of Object.keys(letters).sort((a,b)=>b.length-a.length)) if (s.startsWith(key)) { s=letters[key]+number(s.slice(key.length)); break; }
    s=s.replace(/[๐-๙]/g,c=>digits.indexOf(c));
    const m=/^([A-Z]{1,2})([1-9]\d{0,3})$/.exec(s);
    return m && [...m[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)<=40 && +m[2]<=1000 ? s : null;
  }
  const invalid = text => ({error:'creative_voice_invalid',text});
  const value = (action, raw, min, max, extra={}) => {const n=number(raw);return Number.isFinite(n)&&n>=min&&n<=max&&(!['font_size','select'].includes(action)||Number.isInteger(n))?{action,value:n,...extra}:invalid(`ระบุตัวเลขตั้งแต่ ${min} ถึง ${max}`);};
  function parse(input) {
    if (typeof input !== 'string' || input.length>4000) return null;
    const raw=input.normalize('NFC').trim().replace(/^(?:ช่วย|กรุณา|please\s+)\s*/i,'');
    const text=raw.replace(/(?:\s*(?:ให้หน่อย|หน่อย|นะครับ|นะคะ|ครับ|ค่ะ|please))+[.!?。]*$/i,'').replace(/[.!?。]+$/,'').trim();
    const neg=/^(?:อย่า|ห้าม|ไม่ต้อง)\s*(.+)$/.exec(text);
    if (neg) return parse(neg[1]) ? {error:'voice_command_negated',text:'รับทราบ ยังไม่ดำเนินการ'} : null;
    let m;
    if (/^(?:คำสั่งเสียงสร้างสรรค์|วิธีสั่งงานด้วยเสียง|สั่งอะไรได้บ้างในหน้านี้|creative voice help)$/i.test(text)) return {action:'help'};
    if (/^(?:ปิดตัวอย่าง(?:คำสั่งเสียง)?|ซ่อนคำสั่งเสียง)$/.test(text)) return {action:'help_close'};
    if (/^(?:ยืนยัน|ยืนยันคำสั่ง|ยืนยันคำสั่งนี้|confirm)$/i.test(text)) return {action:'confirm'};
    if (/^(?:ยกเลิก|ยกเลิกคำสั่ง|ยกเลิกคำสั่งนี้|cancel)$/i.test(text)) return {action:'cancel'};
    if ((m=/^(?:เปิด|ไปที่|สลับไป|open\s+)\s*(?:หน้า|ตัวแก้ไข|หมวด(?:หมู่)?)?\s*(.+)$/i.exec(text)) && kinds[m[1].toLowerCase()]) return {action:'open',kind:kinds[m[1].toLowerCase()]};
    if ((m=/^(?:สร้าง|เริ่ม)\s*(.+?)\s*(?:ใหม่|เปล่า)$/.exec(text)) && kinds[m[1].toLowerCase()]) return {action:'new',kind:kinds[m[1].toLowerCase()]};
    // Dictated payloads retain case, punctuation, spacing and polite words.
    if (/^(?:เปิดไฟล์ที่เลือก|เปิดในพื้นที่ทำงาน)$/.test(text)) return {action:'open_selected'};
    if ((m=/^(?:เปิดไฟล์|แก้ไขไฟล์)(?:ชื่อ)?\s+(.+)$/is.exec(raw))) return {action:'open_file',text:m[1].trim()};
    if ((m=/^(?:เพิ่มข้อความ|ใส่ข้อความ|เพิ่มย่อหน้า|เพิ่มกล่องข้อความ|เพิ่มคำบรรยาย)(?:ว่า)?\s+(.+)$/is.exec(raw))) return {action:'text',text:m[1].trim()};
    if ((m=/^(?:เปลี่ยนข้อความ(?:ที่เลือก)?เป็น|แก้ข้อความ(?:ที่เลือก)?เป็น|แทนข้อความ(?:ที่เลือก)?ด้วย)\s+(.+)$/is.exec(raw))) return {action:'replace_text',text:m[1].trim()};
    if ((m=/^(?:เพิ่มสไลด์|สร้างสไลด์)(?:หัวข้อ|ชื่อ)?\s+(.+)$/is.exec(raw))) return {action:'add_slide',text:m[1].trim()};
    if ((m=/^(?:เพิ่มชีต|เพิ่มชีท|เพิ่มแผ่นงาน)(?:ชื่อ)?\s+(.+)$/is.exec(raw))) return {action:'add_sheet',text:m[1].trim()};
    if ((m=/^(?:ตั้งชื่อ(?:งาน|โปรเจกต์)?|เปลี่ยนชื่อ(?:งาน|โปรเจกต์)?เป็น)\s+(.+)$/is.exec(raw))) return {action:'rename',text:m[1].trim()};
    if((m=/^(?:เปลี่ยน|ปรับ|ตั้ง)?สี(?:ข้อความ|เลเยอร์|รูปร่าง)?(?:เป็น)?\s*(.+)$/.exec(text))){
      const colors={แดง:'#ff0000',เขียว:'#008000',น้ำเงิน:'#0000ff',ฟ้า:'#00bfff',เหลือง:'#ffff00',ส้ม:'#ffa500',ม่วง:'#800080',ชมพู:'#ffc0cb',ขาว:'#ffffff',ดำ:'#000000',เทา:'#808080',น้ำตาล:'#a52a2a',ทอง:'#ffd700'};
      const color=Object.hasOwn(colors,m[1])?colors[m[1]]:(/^#[0-9a-f]{6}$/i.test(m[1])?m[1].toLowerCase():null);
      return color?{action:'layer_color',value:color}:invalid('ระบุชื่อสี เช่น แดง ฟ้า ขาว ดำ หรือรหัสสี #RRGGBB');
    }
    if ((m=/^(?:ใส่สูตร(?:ใน)?|ตั้งสูตร(?:ใน)?)\s*(?:เซลล์)?\s*(.+?)\s*(?:เป็น|เท่ากับ|ว่า)\s+(.+)$/is.exec(raw))) {const address=cell(m[1]);return address?{action:'set_formula',cell:address,text:m[2].trim()}:invalid('ระบุเซลล์ที่จะใส่สูตร เช่น ใส่สูตร B3 เป็น =SUM(B1:B2)');}
    if ((m=/^(?:ใส่(?:ค่า|ข้อความ)?(?:ใน)?|เปลี่ยน(?:ค่า)?(?:ใน)?|ตั้งค่า)\s*(?:เซลล์)?\s*(.+?)\s*(?:เป็น|เท่ากับ|ว่า)\s+(.+)$/is.exec(raw))) {const address=cell(m[1]);return address?{action:'set_cell',cell:address,text:m[2].trim()}:invalid('ระบุเซลล์ A1 ถึง AN1000 เช่น เปลี่ยน B2 เป็น 500');}
    if ((m=/^(?:เลือก|ไปที่)\s*(?:เซลล์)\s*(.+)$/i.exec(text))) {const address=cell(m[1]);return address?{action:'select_cell',cell:address}:invalid('เลือกเซลล์ในช่วง A1 ถึง AN1000');}
    if ((m=/^เลือก\s*(เลเยอร์|คลิป|ย่อหน้า|สไลด์|ชีต|ชีท|แผ่นงาน)\s*(?:ที่)?\s*(.+)$/.exec(text))) return value('select',m[2],1,2000,{target:({เลเยอร์:'layer',คลิป:'clip',ย่อหน้า:'paragraph',สไลด์:'slide',ชีต:'sheet',ชีท:'sheet',แผ่นงาน:'sheet'})[m[1]]});
    const simple = [
      ['undo',/^(?:ย้อนกลับ|เลิกทำ|ยกเลิกการแก้ไขล่าสุด|undo)$/i],['redo',/^(?:ทำซ้ำ|ทำใหม่|redo)$/i],
      ['save',/^(?:บันทึก|บันทึกภาพ|บันทึกรูปภาพ|บันทึกงาน|บันทึกไฟล์|บันทึกฉบับใหม่|บันทึกฉบับแก้ไข|เซฟ|เซฟงาน|save)$/i],
      ['export',/^(?:ส่งออก|ส่งออกไฟล์|ส่งออกวิดีโอ|ส่งออกเอ็มพีโฟร์|ส่งออก\s*MP4|export\s*MP4)$/i],
      ['download_png',/^(?:ดาวน์โหลดภาพ|ดาวน์โหลด\s*PNG|ส่งออก\s*PNG)$/i],['project',/^(?:เก็บโปรเจกต์|บันทึกโปรเจกต์)$/],
      ['bold',/^(?:ตัวหนา|ทำตัวหนา|ปรับตัวหนา)$/],['italic',/^(?:ตัวเอียง|ทำตัวเอียง)$/],['underline',/^(?:ขีดเส้นใต้|เส้นใต้)$/],
      ['play',/^(?:เล่นวิดีโอ|เล่นคลิป|เล่นตัวอย่าง|play video)$/i],['pause',/^(?:พักวิดีโอ|หยุด(?:เล่น)?วิดีโอ|หยุด(?:เล่น)?คลิป|pause video)$/i],
      ['split',/^(?:แยกคลิป|แบ่งคลิป|ตัดแบ่งคลิป)$/],['duplicate_clip',/^(?:สำเนาคลิป|ทำสำเนาคลิป)$/],['delete_clip',/^(?:ลบคลิป|ลบคลิปที่เลือก)$/],
      ['delete_layer',/^(?:ลบเลเยอร์|ลบเลเยอร์ที่เลือก)$/],['duplicate_layer',/^(?:สำเนาเลเยอร์|ทำสำเนาเลเยอร์)$/],
      ['next_slide',/^(?:สไลด์ถัดไป|หน้าถัดไป)$/],['previous_slide',/^(?:สไลด์ก่อนหน้า|หน้าก่อนหน้า)$/],
      ['present',/^(?:เริ่มนำเสนอ|แสดงสไลด์|นำเสนอสไลด์)$/],['stop_present',/^(?:จบนำเสนอ|หยุดนำเสนอ|ออกจากการนำเสนอ)$/]
    ];
    for(const [action,re] of simple) if(re.test(text)) return {action};
    if((m=/^(เปิด|แสดง|ปิด|ซ่อน)(?:แผง)?(?:เลเยอร์|คุณสมบัติ|ปรับแต่ง|ปรับคลิป|คำบรรยาย)$/.exec(text)))return {action:'panel',value:['เปิด','แสดง'].includes(m[1])};
    if(/^(?:พอดี|ซูมพอดี|ซูมให้พอดี|พอดีหน้าจอ|ขยายพอดีหน้าจอ)$/.test(text))return {action:'fit'};
    if((m=/^(?:เลื่อน|ย้าย)เลเยอร์(ขึ้น|ลง)$/.exec(text)))return {action:'layer_order',value:m[1]==='ขึ้น'?'up':'down'};
    if((m=/^(แสดง|ซ่อน)เลเยอร์ที่เลือก$/.exec(text)))return {action:'layer_visibility',value:m[1]==='แสดง'};
    if((m=/^(?:ย้าย|เลื่อน)เลเยอร์(?:ไป)?(?:ทาง)?(ซ้าย|ขวา|ขึ้น|ลง)\s*(.+?)(?:\s*พิกเซล)?$/.exec(text)))return value('move_layer',m[2],0,4096,{direction:m[1]});
    if((m=/^(?:ปรับ|ตั้ง)?(?:ความ)?(กว้าง|สูง)(?:เลเยอร์)?(?:เป็น)?\s*(.+?)(?:\s*พิกเซล)?$/.exec(text)))return value('layer_size',m[2],1,4096,{dimension:m[1]==='กว้าง'?'width':'height'});
    if((m=/^ครอป(?:รูปภาพ|ภาพ)?\s*ซ้าย\s*(.+?)\s*บน\s*(.+?)\s*กว้าง\s*(.+?)\s*สูง\s*(.+?)(?:\s*พิกเซล)?$/.exec(text))){
      const [x,y,width,height]=m.slice(1).map(number);
      return [x,y,width,height].every(n=>Number.isInteger(n)&&n>=0&&n<=4096)&&width>=16&&height>=16?{action:'crop_image',x,y,width,height}:invalid('ระบุพื้นที่ครอปเป็นจำนวนเต็ม ขนาดอย่างน้อย 16 พิกเซล และไม่เกิน 4096 พิกเซล');
    }
    if((m=/^(?:ขนาด(?:ตัว)?อักษร|ปรับ(?:ขนาด)?(?:ตัว)?อักษร(?:เป็น)?)\s*(.+)$/.exec(text)))return value('font_size',m[1],8,96);
    if((m=/^(?:ซูม|ขยายภาพ)\s*(.+?)(?:\s*เปอร์เซ็นต์|\s*%)?$/.exec(text)))return value('zoom',m[1],10,200);
    if(/^(?:สว่างขึ้น|เพิ่มความสว่าง)$/.test(text))return {action:'brightness_delta',value:10};
    if(/^(?:มืดลง|ลดความสว่าง)$/.test(text))return {action:'brightness_delta',value:-10};
    if((m=/^(?:ปรับ)?(?:ความสว่าง|ความทึบ)(?:เป็น)?\s*(.+?)(?:\s*เปอร์เซ็นต์|\s*%)?$/.exec(text)))return value(text.includes('ความสว่าง')?'brightness':'opacity',m[1],0,text.includes('ความสว่าง')?200:100);
    if((m=/^หมุน(?:รูปภาพ|รูป|ภาพ|เลเยอร์)?(?:ไปทาง)?\s*(ซ้าย|ขวา)?\s*(.*?)\s*(?:องศา)?$/.exec(text))&&(m[1]||m[2]))return value('rotate',m[2]||'90',0,360,{direction:m[1]==='ซ้าย'?-1:1});
    if(/^(?:พลิก|กลับ)(?:ภาพ|เลเยอร์)?(?:แนวนอน|ซ้ายขวา|ซ้ายขวา)$/.test(text))return {action:'flip',value:'horizontal'};
    if(/^(?:พลิก|กลับ)(?:ภาพ|เลเยอร์)?(?:แนวตั้ง|บนล่าง)$/.test(text))return {action:'flip',value:'vertical'};
    for(const [label,tool] of [['พู่กัน','paint'],['ยางลบ','erase'],['ครอป','crop'],['ย้าย','move'],['สี่เหลี่ยม','rect'],['รูปร่าง','rect'],['วงรี','ellipse'],['ข้อความ','text']])if(new RegExp('^(?:เลือก|ใช้|เพิ่ม)?(?:เครื่องมือ)?'+label+'(?:รูป|ภาพ)?$').test(text))return {action:'image_tool',value:tool};
    if((m=/^(?:ปรับ)?ความเร็ว(?:คลิป|วิดีโอ)?(?:เป็น)?\s*(.+?)\s*(?:เท่า|x)?$/i.exec(text)))return value('speed',m[1],.5,2);
    if((m=/^(?:ปรับ)?(?:ระดับเสียง|เสียงคลิป)(?:เป็น)?\s*(.+?)(?:\s*เปอร์เซ็นต์|\s*%)?$/.exec(text)))return value('volume',m[1],0,100);
    if((m=/^(?:ไปที่|เลื่อนไป|ตั้งจุดเล่น(?:ที่)?|เลื่อนจุดเล่น(?:ไป)?)\s*(?:วินาที(?:ที่)?\s*)?(.+?)\s*(?:วินาที)?$/.exec(text))&&Number.isFinite(number(m[1])))return value('seek',m[1],0,120);
    if((m=/^(?:ตั้ง|ปรับ)?(?:จุด)?(เริ่ม|จบ)(?:คลิป)?(?:ที่)?\s*(.+?)\s*วินาที$/.exec(text)))return value(m[1]==='เริ่ม'?'clip_start':'clip_end',m[2],0,86400);
    if(/^(?:เปิด|ใส่)เฟด(?:เข้าออก|เข้าและออก)?$/.test(text))return {action:'fade',value:true};
    if(/^(?:ปิด|เอา)เฟด(?:ออก)?$/.test(text))return {action:'fade',value:false};
    if((m=/^(?:สัดส่วน(?:วิดีโอ)?|วิดีโอ)(?:เป็น)?\s*(แนวตั้ง|แนวนอน|จัตุรัส|สี่เหลี่ยมจัตุรัส|9:16|16:9|1:1)$/.exec(text)))return {action:'aspect',value:({'แนวตั้ง':'vertical','9:16':'vertical','แนวนอน':'widescreen','16:9':'widescreen'})[m[1]]||'square'};
    if((m=/^จัด(?:ข้อความ)?(?:ชิด|กึ่ง)?\s*(ซ้าย|ขวา|กลาง)$/.exec(text)))return {action:'align',value:({ซ้าย:'left',ขวา:'right',กลาง:'center'})[m[1]]};
    return null;
  }
  const needsConfirmation = command => ['save','export','download_png','project','new'].includes(command?.action);
  const toAction = (command,id='') => 'studio_command:'+encodeURIComponent(command)+(id?'#'+id:'');
  const fromAction = action => {try {return typeof action==='string'&&action.startsWith('studio_command:')?parse(decodeURIComponent(action.slice(15).split('#')[0])):null;}catch(_){return null;}};
  return Object.freeze({parse,number,cell,needsConfirmation,toAction,fromAction});
});
