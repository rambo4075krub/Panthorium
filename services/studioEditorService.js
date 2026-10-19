'use strict';
// Edit owned packages in place, then save a new file. Unchanged Office entries
// (styles, pictures, relationships, formulas, layouts) remain byte-for-byte intact.
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { _internals, OfficeArtifactError } = require('./officeArtifactService');
const { sanitizeFilename } = require('./cloudFilesService');
const { runProcess } = require('./mediaStudioService');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (code, status = 400) => { throw new OfficeArtifactError(status, code); };
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const decode = value => String(value).replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, s => {
  const named = {'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"};
  if (named[s]) return named[s];
  const n = s[2].toLowerCase() === 'x' ? parseInt(s.slice(3,-1),16) : Number(s.slice(2,-1));
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
});
const attr = (xml, key) => decode(xml.split('>')[0].match(new RegExp('(?:^|\\s)' + key + '=["\x27]([^"\x27]*)["\x27]'))?.[1] || '');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const textOf = (xml, tag) => [...xml.matchAll(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'g'))].map(m=>decode(m[1])).join('');
function typeOf(file) {
  return ({docx:'document',xlsx:'spreadsheet',pptx:'presentation',png:'image',jpg:'image',jpeg:'image',webp:'image',mp4:'video',webm:'video'})[String(file.name).split('.').pop().toLowerCase()] || null;
}
function validateEdit(value) {
  if (!value || Object.keys(value).some(k=>!['fileId','revision','operations'].includes(k)) || !UUID.test(value.fileId || '') || !/^[a-f0-9]{64}$/.test(value.revision || '') || !Array.isArray(value.operations) || !value.operations.length || value.operations.length > 200) fail('invalid_editor_request');
  for (const op of value.operations) {
    if (!op || Object.keys(op).some(k=>!['type','sheet','cell','value','index','degrees','axis','x','y','width','height','amount'].includes(k))) fail('invalid_editor_operation');
    const keys = {set_cell:['type','sheet','cell','value'],set_text:['type','index','value'],append_paragraph:['type','value'],rotate:['type','degrees'],flip:['type','axis'],crop:['type','x','y','width','height'],brightness:['type','amount']}[op.type];
    if (!keys || keys.length !== Object.keys(op).length || !keys.every(k=>Object.hasOwn(op,k))) fail('invalid_editor_operation');
    if (['set_cell','set_text','append_paragraph'].includes(op.type) && !(typeof op.value === 'string' && op.value.length <= 6000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(op.value) || op.type === 'set_cell' && typeof op.value === 'number' && Number.isFinite(op.value))) fail('invalid_editor_value');
    if (op.type === 'set_cell' && (!Number.isInteger(op.sheet) || op.sheet < 0 || op.sheet > 31 || !/^[A-Z]{1,2}[1-9][0-9]{0,3}$/.test(op.cell) || op.value.length > 2000)) fail('invalid_editor_cell');
    if (op.type === 'set_text' && (!Number.isInteger(op.index) || op.index < 0 || op.index > 1999)) fail('invalid_editor_text');
    if (op.type === 'rotate' && ![90,180,270].includes(op.degrees) || op.type === 'flip' && !['horizontal','vertical'].includes(op.axis) || op.type === 'brightness' && (!Number.isFinite(op.amount) || Math.abs(op.amount)>1)) fail('invalid_image_edit');
    if (op.type === 'crop' && !['x','y','width','height'].every(k=>Number.isInteger(op[k]) && op[k] >= (['width','height'].includes(k)?1:0) && op[k]<=16384)) fail('invalid_image_edit');
  }
  if (Buffer.byteLength(JSON.stringify(value))>42000) fail('editor_changes_too_large',413);
  return value;
}
function column(ref) { return [...ref.match(/^[A-Z]+/)[0]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0); }
function addressedSheet(xml) {
  let row=0;
  return xml.replace(/<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/g,r=>{
    row=attr(r,'r')?Number(attr(r,'r')):row+1;
    if(!Number.isInteger(row)||row<1||row>1048576)fail('editor_office_unsupported',422);
    if(!attr(r,'r'))r=r.replace('<row',()=>'<row r="'+row+'"');
    let col=0;
    return r.replace(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g,c=>{
      const ref=attr(c,'r');if(ref){if(!/^[A-Z]{1,3}[1-9]\d*$/.test(ref))fail('editor_office_unsupported',422);col=column(ref);return c;}
      col++;let n=col,label='';for(;n;n=Math.floor((n-1)/26))label=String.fromCharCode(65+(n-1)%26)+label;
      return c.replace('<c',()=>'<c r="'+label+row+'"');
    });
  });
}
function relationships(entries, base, filename) {
  const xml=entries[filename]?.toString() || '';
  return Object.fromEntries([...xml.matchAll(/<Relationship\s[^>]*\/?\s*>/g)].filter(m=>!attr(m[0],'TargetMode')).map(m=>[attr(m[0],'Id'),path.posix.normalize(base+'/'+attr(m[0],'Target'))]));
}
function officeModel(entries, pluginId) {
  for (const [name,bytes] of Object.entries(entries)) if (/\.(xml|rels)$/.test(name) && /<!DOCTYPE|<!ENTITY/i.test(bytes.toString())) fail('invalid_office_source');
  if (pluginId === 'spreadsheet') {
    const workbook=entries['xl/workbook.xml']?.toString() || '', rels=relationships(entries,'xl','xl/_rels/workbook.xml.rels');
    const shared=[...(entries['xl/sharedStrings.xml']?.toString() || '').matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m=>textOf(m[1],'t'));
    const sheets=[...workbook.matchAll(/<sheet\s[^>]*\/?\s*>/g)].map(m=>{
      const file=rels[attr(m[0],'r:id')], xml=entries[file]?.toString();
      if (!xml || !file.startsWith('xl/worksheets/')) fail('editor_office_unsupported',422);
      const cells=[];
      for (const match of addressedSheet(xml).matchAll(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)) {
        const cell=attr(match[0],'r'), type=attr(match[0],'t'); if (!/^[A-Z]{1,3}[1-9]\d*$/.test(cell)) fail('editor_office_unsupported',422);
        const raw=textOf(match[0],'v'), formula=/<f\b/.test(match[0]);
        const value=type==='s' ? shared[Number(raw)] ?? '' : type==='inlineStr' ? textOf(match[0],'t') : raw && !type && Number.isFinite(Number(raw)) ? Number(raw) : raw;
        cells.push({cell,value,...(formula?{formula:true}:{})});
      }
      if(cells.length>10000) fail('editor_file_too_complex',413);
      return {name:attr(m[0],'name'),file,cells};
    });
    if (!sheets.length || sheets.length>32) fail('editor_office_unsupported',422);
    return {sheets};
  }
  const blocks=[];
  let files = pluginId==='document' ? ['word/document.xml'] : [];
  if(pluginId==='presentation') {
    const rels=relationships(entries,'ppt','ppt/_rels/presentation.xml.rels');
    files=[...(entries['ppt/presentation.xml']?.toString() || '').matchAll(/<p:sldId\s[^>]*\/?\s*>/g)].map(m=>rels[attr(m[0],'r:id')]);
  }
  if(!files.length || files.length>100) fail('editor_office_unsupported',422);
  const prefix=pluginId==='document'?'w':'a';
  files.forEach((file,page)=>{
    if(!entries[file]) fail('editor_office_unsupported',422);
    let ordinal=0;
    for(const match of entries[file].toString().matchAll(new RegExp('<'+prefix+':p(?:\\s[^>]*)?>[\\s\\S]*?</'+prefix+':p>','g'))) {
      const text=textOf(match[0],prefix+':t');
      if(text) blocks.push({index:blocks.length,page:page+1,file,ordinal,text});
      ordinal++;
    }
  });
  if(blocks.length>2000) fail('editor_file_too_complex',413);
  return {blocks};
}
function patchOffice(entries, pluginId, operations) {
  // Resolve indexes once. Operations cannot shift the meaning of later indexes.
  const model=officeModel(entries,pluginId);
  for(const op of operations) {
    if(op.type==='set_cell' && pluginId==='spreadsheet') {
      const sheet=model.sheets[op.sheet]; if(!sheet || column(op.cell)>40 || Number(op.cell.match(/\d+/)[0])>1000) fail('editor_cell_out_of_range');
      let xml=addressedSheet(entries[sheet.file].toString()); const row=Number(op.cell.match(/\d+/)[0]);
      let old=''; xml.replace(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g,m=>{if(attr(m,'r')===op.cell) old=m;return m;});
      if(old && /<f\b/.test(old)) fail('editor_formula_cell_readonly',409);
      const style=old ? attr(old,'s') : '', value=typeof op.value==='number'?`<v>${op.value}</v>`:`<is><t xml:space="preserve">${escape(op.value)}</t></is>`;
      const cell=`<c r="${op.cell}"${style?` s="${escape(style)}"`:''}${typeof op.value==='number'?'':' t="inlineStr"'}>${value}</c>`;
      if(old) xml=xml.replace(old,()=>cell);
      else {
        let found=false;
        xml=xml.replace(/<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/g,m=>{
          if(Number(attr(m,'r'))!==row)return m; found=true;
          if(m.endsWith('/>'))return m.slice(0,-2)+'>'+cell+'</row>';
          let inserted=false;
          m=m.replace(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g,c=>{if(!inserted && column(attr(c,'r'))>column(op.cell)){inserted=true;return cell+c;}return c;});
          return inserted?m:m.replace('</row>',()=>cell+'</row>');
        });
        if(!found) {
          const rowXml=`<row r="${row}">${cell}</row>`; let inserted=false;
          xml=xml.replace(/<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/g,m=>{if(!inserted && Number(attr(m,'r'))>row){inserted=true;return rowXml+m;}return m;});
          if(!inserted) xml=/<sheetData\s*\/>/.test(xml) ? xml.replace(/<sheetData\s*\/>/,()=>'<sheetData>'+rowXml+'</sheetData>') : xml.replace('</sheetData>',()=>rowXml+'</sheetData>');
        }
        // Dimension is optional. Let Office recompute it, including newly added cells.
        xml=xml.replace(/<dimension\b[^>]*\/>/g,'');
      }
      entries[sheet.file]=Buffer.from(xml);
    } else if(op.type==='set_text' && model.blocks) {
      const block=model.blocks[op.index]; if(!block)fail('editor_text_not_found');
      const prefix=pluginId==='document'?'w':'a'; let index=0;
      const xml=entries[block.file].toString().replace(new RegExp('<'+prefix+':p(?:\\s[^>]*)?>[\\s\\S]*?</'+prefix+':p>','g'),p=>{
        if(index++!==block.ordinal)return p; let first=true;
        return p.replace(new RegExp('<'+prefix+':t(?:\\s[^>]*)?>[\\s\\S]*?</'+prefix+':t>','g'),()=>{const v=first?escape(op.value):'';first=false;return `<${prefix}:t xml:space="preserve">${v}</${prefix}:t>`;});
      }); entries[block.file]=Buffer.from(xml);
    } else if(op.type==='append_paragraph' && pluginId==='document') {
      let xml=entries['word/document.xml'].toString();
      const p='<w:p><w:r><w:t xml:space="preserve">'+escape(op.value)+'</w:t></w:r></w:p>';
      const section=[...xml.matchAll(/<w:sectPr\b[^>]*(?:\/>|>[\s\S]*?<\/w:sectPr>)/g)].at(-1);
      if(section && /^\s*<\/w:body>/.test(xml.slice(section.index+section[0].length)))xml=xml.slice(0,section.index)+p+xml.slice(section.index);
      else xml=xml.replace('</w:body>',()=>p+'</w:body>');entries['word/document.xml']=Buffer.from(xml);
    } else fail('editor_operation_type_mismatch');
  }
  return entries;
}
class StudioEditorService {
  constructor({files}) {this.files=files;}
  async read(user,fileId) {
    const file=await this.files.readOwned(user.sub,fileId), pluginId=typeOf(file); if(!pluginId)fail('editor_file_unsupported',415);
    const model=['document','spreadsheet','presentation'].includes(pluginId)?officeModel(_internals.unzip(file.body),pluginId):{};
    // Internal archive names are not accepted as patch targets from callers.
    if(model.blocks) model.blocks=model.blocks.map(({file,ordinal,...block})=>block);
    if(model.sheets) model.sheets=model.sheets.map(({file,...sheet})=>sheet);
    return {file:{id:file.id,name:file.name,contentType:file.contentType},pluginId,revision:hash(file.body),...model};
  }
  async apply({user,pluginId,input}) {
    const edit=validateEdit(input.edit), file=await this.files.readOwned(user.sub,edit.fileId);
    if(typeOf(file)!==pluginId)fail('editor_operation_type_mismatch');
    if(hash(file.body)!==edit.revision)fail('editor_source_changed',409);
    let body,contentType=file.contentType,extension=String(file.name).split('.').pop().toLowerCase();
    if(['document','spreadsheet','presentation'].includes(pluginId)) body=_internals.zip(patchOffice(_internals.unzip(file.body),pluginId,edit.operations));
    else if(pluginId==='image') {
      const filters=edit.operations.map(op=>{
        if(op.type==='rotate')return op.degrees===90?'transpose=1':op.degrees===270?'transpose=2':'hflip,vflip';
        if(op.type==='flip')return op.axis==='horizontal'?'hflip':'vflip';
        if(op.type==='brightness')return 'eq=brightness='+op.amount;
        if(op.type==='crop')return `crop=${op.width}:${op.height}:${op.x}:${op.y}:exact=1`;
        fail('editor_operation_type_mismatch');
      });
      const dir=await fs.mkdtemp(path.join(os.tmpdir(),'studio-edit-'));
      try {
        const source=path.join(dir,'source.'+extension), target=path.join(dir,'edited.png');await fs.writeFile(source,file.body,{mode:0o600,flag:'wx'});
        const decoded=path.join(dir,'decoded.png'),decoder=({png:'png',jpg:'mjpeg',jpeg:'mjpeg',webp:'webp'})[extension];
        await runProcess(process.env.FFMPEG_PATH || 'ffmpeg',['-hide_banner','-v','error','-xerror','-protocol_whitelist','file,pipe','-f','image2','-pattern_type','none','-c:v',decoder,'-max_pixels','16777216','-i',source,'-frames:v','1','-threads','1',decoded],{timeoutMs:20000,maxOutputBytes:1024});
        const info=_internals.imageInfo({name:'decoded.png',body:await fs.readFile(decoded)});let width=info.width,height=info.height;
        for(const op of edit.operations){
          if(op.type==='crop'){if(op.x+op.width>width||op.y+op.height>height)fail('editor_crop_out_of_bounds');width=op.width;height=op.height;}
          if(op.type==='rotate'&&op.degrees!==180)[width,height]=[height,width];
        }

        await runProcess(process.env.FFMPEG_PATH || 'ffmpeg',['-hide_banner','-v','error','-xerror','-protocol_whitelist','file,pipe','-f','image2','-pattern_type','none','-c:v',({png:'png',jpg:'mjpeg',jpeg:'mjpeg',webp:'webp'})[extension],'-max_pixels','16777216','-i',source,'-vf',filters.join(','),'-frames:v','1','-threads','1',target],{timeoutMs:20000,maxOutputBytes:1024});
        body=await fs.readFile(target); contentType='image/png';extension='png';
      } finally {await fs.rm(dir,{recursive:true,force:true});}
    } else fail('editor_use_media_studio');
    const name=sanitizeFilename(input.name || file.name.replace(/\.[^.]+$/,'')+'-edited').replace(/\.[^.]+$/,'').slice(0,130)+'.'+extension;
    const saved=await this.files.upload(user.sub,name,contentType,body);
    return {files:[saved],summary:'บันทึกฉบับแก้ไขแล้ว โดยเก็บต้นฉบับไว้'};
  }
}
module.exports={StudioEditorService,validateEdit,typeOf,officeModel,patchOffice};
