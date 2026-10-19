'use strict';
// Original Panthorium OOXML operations. Existing package parts are retained.
const {OfficeArtifactError,_internals}=require('./officeArtifactService');
const path=require('node:path');
const core=require('../office-suite-core');
const fail=code=>{throw new OfficeArtifactError(400,code);};
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const attr=(s,k)=>s.split('>')[0].match(new RegExp('(?:^|\\s)'+k+'=["\x27]([^"\x27]*)["\x27]'))?.[1]||'';
const tags=(s,t)=>[...s.matchAll(new RegExp('<'+t+'\\b[^>]*(?:/>|>[\\s\\S]*?</'+t+'>)','g'))].map(m=>m[0]);
const replaceTag=(s,tag,value)=>s.replace(new RegExp('<'+tag+'\\b[^>]*(?:/>|>[\\s\\S]*?</'+tag+'>)','g'),'').replace(/<\/[^>]+>$/,end=>value+end);
const prop=(s,tag,value)=>{
  const re=new RegExp('<'+tag+'\\b[^>]*(?:/>|>[\\s\\S]*?</'+tag+'>)');
  return re.test(s)?s.replace(re,()=>value):s.replace(/>/,()=>'>'+value);
};
const tagval=(s,t,k='w:val')=>attr(tags(s,t)[0]||'',k);
const TYPES=['add_slide','reorder_slide','set_formula','format_text','format_cell','move_text','slide_background','insert_table','add_slide_text'];
const styleKeys=['bold','italic','underline','fontSize','color','align','numberFormat'];
function validateStyle(s,cell=false){
  if(!s||Array.isArray(s)||typeof s!=='object'||!Object.keys(s).length||Object.keys(s).some(k=>!styleKeys.includes(k)||!cell&&k==='numberFormat'))fail('invalid_office_style');
  for(const k of ['bold','italic','underline'])if(s[k]!=null&&typeof s[k]!=='boolean')fail('invalid_office_style');
  if(s.fontSize!=null&&(!Number.isInteger(s.fontSize)||s.fontSize<8||s.fontSize>96))fail('invalid_office_style');
  if(s.color!=null&&!/^[0-9a-f]{6}$/i.test(s.color))fail('invalid_office_style');
  if(s.align!=null&&!['left','center','right','justify'].includes(s.align))fail('invalid_office_style');
  if(s.numberFormat!=null&&!['general','integer','decimal','percent'].includes(s.numberFormat))fail('invalid_office_style');
}
function validateOperation(op){
  if(!TYPES.includes(op?.type))return false;
  const keys={add_slide:['type','value'],reorder_slide:['type','page','toPage'],set_formula:['type','sheet','cell','value'],format_cell:['type','sheet','cell','style'],format_text:['type','index','style'],move_text:['type','index','x','y','width','height'],slide_background:['type','page','color'],insert_table:['type','rows'],add_slide_text:['type','page','value']}[op.type];
  if(Object.keys(op).length!==keys.length||!keys.every(k=>Object.hasOwn(op,k)))fail('invalid_editor_operation');
  if(keys.includes('style'))validateStyle(op.style,op.type==='format_cell');
  if(keys.includes('index')&&(!Number.isInteger(op.index)||op.index<0||op.index>1999))fail('invalid_editor_text');
  if(keys.includes('toPage')&&(!Number.isInteger(op.toPage)||op.toPage<1||op.toPage>100))fail('invalid_editor_page');
  if(keys.includes('page')&&(!Number.isInteger(op.page)||op.page<1||op.page>100))fail('invalid_editor_page');
  if(keys.includes('cell')&&(!Number.isInteger(op.sheet)||op.sheet<0||op.sheet>31||!/^[A-Z]{1,2}[1-9]\d{0,3}$/.test(op.cell)))fail('invalid_editor_cell');
  if(op.type==='set_formula'){if(typeof op.value!=='string'||!op.value.startsWith('='))fail('invalid_editor_formula');try{core.parse(op.value);}catch(e){fail('editor_formula_unsupported');}}
  if(op.type==='move_text'&&!['x','y','width','height'].every(k=>Number.isFinite(op[k])&&op[k]>=(['width','height'].includes(k)?1:0)&&op[k]<=100))fail('invalid_editor_geometry');
  if(op.type==='move_text'&&(op.x+op.width>100||op.y+op.height>100))fail('invalid_editor_geometry');
  if(op.type==='slide_background'&&!/^[0-9a-f]{6}$/i.test(op.color))fail('invalid_office_style');
  if(['add_slide_text','add_slide'].includes(op.type)&&(typeof op.value!=='string'||!op.value.trim()||op.value.length>6000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(op.value)))fail('invalid_editor_value');
  if(op.type==='insert_table'&&(!Array.isArray(op.rows)||!op.rows.length||op.rows.length>30||op.rows.some(r=>!Array.isArray(r)||!r.length||r.length>10||r.length!==op.rows[0].length||r.some(v=>typeof v!=='string'||v.length>500||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)))))fail('invalid_editor_table');
  return true;
}
function textStyle(p,prefix){
  if(prefix==='w')return {bold:!!tags(p,'w:b').length&&tagval(p,'w:b')!=='0',italic:!!tags(p,'w:i').length&&tagval(p,'w:i')!=='0',underline:!!tags(p,'w:u').length&&tagval(p,'w:u')!=='none',fontSize:Number(tagval(p,'w:sz'))/2||12,color:tagval(p,'w:color')||'20252C',align:tagval(p,'w:jc')||'left'};
  const r=tags(p,'a:rPr')[0]||'';return {bold:attr(r,'b')==='1',italic:attr(r,'i')==='1',underline:attr(r,'u')==='sng',fontSize:Number(attr(r,'sz'))/100||24,color:tagval(r,'a:srgbClr','val')||'20252C',align:({l:'left',ctr:'center',r:'right',just:'justify'})[attr(tags(p,'a:pPr')[0]||'','algn')]||'left'};
}
function shapeFor(xml,ordinal){
  const paragraph=[...xml.matchAll(/<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g)][ordinal];if(!paragraph)return null;
  let index=0;for(const m of xml.matchAll(/<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g)){if(paragraph.index>=m.index&&paragraph.index<m.index+m[0].length)return {index,shape:m[0]};index++;}return null;
}
function visualContent(entries,kind,model){
  model.media=[];let bytesUsed=0;
  const files=kind==='document'?['word/document.xml']:model.slideFiles;
  for(const [page,file]of files.entries()){
    const xml=entries[file].toString(),paragraphs=[...xml.matchAll(new RegExp('<'+(kind==='document'?'w':'a')+':p(?:\\s[^>]*)?>[\\s\\S]*?</'+(kind==='document'?'w':'a')+':p>','g'))];
    const rels=tags(entries[file.replace(/\/([^/]+)$/,'/_rels/$1.rels')]?.toString()||'','Relationship');
    if(kind==='document'){
      let tableIndex=0;for(const table of xml.matchAll(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g)){
        if((table[0].match(/<w:tbl\b/g)||[]).length!==1)continue;
        let row=0;for(const tr of table[0].matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g)){let column=0;
          for(const tc of tr[0].matchAll(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g)){const start=table.index+tr.index+tc.index,end=start+tc[0].length;
            for(const b of model.blocks)if(b.file===file&&paragraphs[b.ordinal]?.index>=start&&paragraphs[b.ordinal].index<end)b.table={index:tableIndex,row,column};column++;
          }row++;
        }tableIndex++;
      }
    }
    const pictures=kind==='document'?[...xml.matchAll(/<w:drawing\b[^>]*>[\s\S]*?<\/w:drawing>/g)]:[...xml.matchAll(/<p:pic\b[^>]*>[\s\S]*?<\/p:pic>/g)];
    for(const pic of pictures){
      if(model.media.length>=16||bytesUsed>=4*1024*1024){model.mediaOmitted=true;break;}
      const rid=attr(tags(pic[0],'a:blip')[0]||'','r:embed'),rel=rels.find(r=>attr(r,'Id')===rid&&!attr(r,'TargetMode'));if(!rel)continue;
      const target=attr(rel,'Target'),name=target.startsWith('/')?target.slice(1):path.posix.normalize(path.posix.dirname(file)+'/'+target),body=entries[name];
      if(!body||!/^\w+\/media\//.test(name)||body.length>2*1024*1024||bytesUsed+body.length>4*1024*1024){model.mediaOmitted=true;continue;}
      let info;try{info=_internals.imageInfo({name,body});}catch(_){model.mediaOmitted=true;continue;}
      if(!['image/png','image/jpeg'].includes(info.contentType)){model.mediaOmitted=true;continue;}
      const media={page:page+1,dataUrl:'data:'+info.contentType+';base64,'+body.toString('base64'),width:info.width,height:info.height};
      if(kind==='document')media.beforeIndex=model.blocks.find(b=>b.file===file&&paragraphs[b.ordinal]?.index>pic.index)?.index??null;
      else {const transform=tags(tags(pic[0],'p:spPr')[0]||'','a:xfrm')[0]||'',off=tags(transform,'a:off')[0]||'',ext=tags(transform,'a:ext')[0]||'';
        if(!transform||/<p:grpSp\b/.test(xml)){model.mediaOmitted=true;continue;}
        media.geometry={x:Number(attr(off,'x'))/model.slideSize.width*100,y:Number(attr(off,'y'))/model.slideSize.height*100,width:Number(attr(ext,'cx'))/model.slideSize.width*100,height:Number(attr(ext,'cy'))/model.slideSize.height*100};
      }
      bytesUsed+=body.length;model.media.push(media);
    }
  }
}
function enrich(entries,kind,model){
  if(kind==='spreadsheet'){
    const styles=entries['xl/styles.xml']?.toString()||'',fonts=tags(tags(styles,'fonts')[0]||'','font'),xfs=tags(tags(styles,'cellXfs')[0]||'','xf');
    for(const s of model.sheets){const cellMap=new Map(tags(entries[s.file].toString(),'c').map((x,i)=>[attr(x,'r')||s.cells[i]?.cell,x]));for(const c of s.cells){const xml=cellMap.get(c.cell),xf=xfs[Number(attr(xml||'','s'))]||'',font=fonts[Number(attr(xf,'fontId'))]||'';
      c.style={bold:!!tags(font,'b').length,italic:!!tags(font,'i').length,underline:!!tags(font,'u').length,fontSize:Number(tagval(font,'sz','val'))||12,color:tagval(font,'color','rgb').slice(-6)||'20252C',align:attr(tags(xf,'alignment')[0]||'','horizontal')||'left',numberFormat:({'1':'integer','2':'decimal','9':'percent','10':'percent'})[attr(xf,'numFmtId')]||'general'};
    }}return model;
  }
  const prefix=kind==='document'?'w':'a';
  const presentation=entries['ppt/presentation.xml']?.toString()||'',size=tags(presentation,'p:sldSz')[0]||'',width=Number(attr(size,'cx'))||12192000,height=Number(attr(size,'cy'))||6858000;
  for(const b of model.blocks){const xml=entries[b.file].toString(),p=tags(xml,prefix+':p')[b.ordinal]||'';const inherited=kind==='document'?tags(entries['word/styles.xml']?.toString()||'','w:style').find(t=>attr(t,'w:styleId')===tagval(p,'w:pStyle'))||'':'';b.style=textStyle(p+inherited,prefix);
    if(kind==='presentation'){
      const shape=shapeFor(xml,b.ordinal);if(shape){const transform=tags(tags(shape.shape,'p:spPr')[0]||'','a:xfrm')[0]||'',off=tags(transform,'a:off')[0]||'',ext=tags(transform,'a:ext')[0]||'';
        b.shapeIndex=shape.index;b.geometry=transform&&!/<p:grpSp\b/.test(xml)?{x:Number(attr(off,'x'))/width*100,y:Number(attr(off,'y'))/height*100,width:Number(attr(ext,'cx'))/width*100,height:Number(attr(ext,'cy'))/height*100}:null;
      }
    }
  }
  if(kind==='presentation'){model.slideSize={width,height};model.backgrounds=model.slideFiles.map(f=>tagval(tags(entries[f].toString(),'p:bg')[0]||'','a:srgbClr','val')||'FFFFFF');}
  visualContent(entries,kind,model);return model;
}
function formatParagraph(p,style,prefix){
  if(prefix==='w'){
    if(style.align){let pr=tags(p,'w:pPr')[0]||'<w:pPr></w:pPr>';if(pr.endsWith('/>'))pr=pr.slice(0,-2)+'></w:pPr>';pr=replaceTag(pr,'w:jc','<w:jc w:val="'+style.align+'"/>');p=prop(p,'w:pPr',pr);}
    return p.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g,r=>{let pr=tags(r,'w:rPr')[0]||'<w:rPr></w:rPr>';if(pr.endsWith('/>'))pr=pr.slice(0,-2)+'></w:rPr>';
      for(const [k,t]of [['bold','w:b'],['italic','w:i'],['underline','w:u'],['fontSize','w:sz'],['color','w:color']])if(style[k]!=null)pr=replaceTag(pr,t,`<${t} w:val="${k==='fontSize'?style[k]*2:k==='underline'?(style[k]?'single':'none'):typeof style[k]==='boolean'?+style[k]:style[k]}"/>`);
      if(style.fontSize)pr=replaceTag(pr,'w:szCs','<w:szCs w:val="'+style.fontSize*2+'"/>');return prop(r,'w:rPr',pr);
    });
  }
  if(style.align){let pr=tags(p,'a:pPr')[0]||'<a:pPr/>';pr=pr.replace(/\s+algn="[^"]*"/g,'').replace('<a:pPr','<a:pPr algn="'+({left:'l',center:'ctr',right:'r',justify:'just'})[style.align]+'"');p=prop(p,'a:pPr',pr);}
  return p.replace(/<a:r\b[^>]*>[\s\S]*?<\/a:r>/g,r=>{let pr=tags(r,'a:rPr')[0]||'<a:rPr></a:rPr>';if(pr.endsWith('/>'))pr=pr.slice(0,-2)+'></a:rPr>';
    for(const [k,a]of [['bold','b'],['italic','i'],['underline','u'],['fontSize','sz']])if(style[k]!=null)pr=pr.replace(new RegExp('\\s+'+a+'="[^"]*"','g'),'').replace('<a:rPr',`<a:rPr ${a}="${k==='fontSize'?style[k]*100:k==='underline'?(style[k]?'sng':'none'):+style[k]}"`);
    if(style.color)pr=replaceTag(pr,'a:solidFill','<a:solidFill><a:srgbClr val="'+style.color+'"/></a:solidFill>');return prop(r,'a:rPr',pr);
  });
}
function formatCell(entries,op,sheet){
  let styles=entries['xl/styles.xml']?.toString();if(!styles)fail('editor_styles_unsupported');
  let xml=entries[sheet.file].toString(),old=tags(xml,'c').find(c=>attr(c,'r')===op.cell);if(!old)fail('editor_cell_empty');
  const fonts=tags(tags(styles,'fonts')[0]||'','font'),xfs=tags(tags(styles,'cellXfs')[0]||'','xf');if(!fonts.length||!xfs.length||fonts.length>4000||xfs.length>4000)fail('editor_styles_unsupported');
  let xf=xfs[Number(attr(old,'s'))||0],font=fonts[Number(attr(xf,'fontId'))||0];if(!xf||!font)fail('editor_styles_unsupported');if(font.endsWith('/>'))font='<font></font>';
  for(const [k,t]of [['bold','b'],['italic','i'],['underline','u'],['fontSize','sz'],['color','color']])if(op.style[k]!=null)font=replaceTag(font,t,typeof op.style[k]==='boolean'?(op.style[k]?'<'+t+'/>':''):`<${t} ${k==='color'?'rgb':'val'}="${k==='color'?'FF'+op.style[k]:op.style[k]}"/>`);
  const fontId=fonts.length;xf=xf.replace(/\s+(?:fontId|applyFont)="[^"]*"/g,'').replace('<xf',`<xf fontId="${fontId}" applyFont="1"`);
  if(op.style.numberFormat)xf=xf.replace(/\s+(?:numFmtId|applyNumberFormat)="[^"]*"/g,'').replace('<xf',`<xf numFmtId="${({general:0,integer:1,decimal:2,percent:10})[op.style.numberFormat]}" applyNumberFormat="1"`);
  if(op.style.align){if(xf.endsWith('/>'))xf=xf.slice(0,-2)+'></xf>';let align=tags(xf,'alignment')[0]||'<alignment/>';align=align.replace(/\s+horizontal="[^"]*"/g,'').replace('<alignment','<alignment horizontal="'+op.style.align+'"');xf=prop(xf,'alignment',align).replace(/\s+applyAlignment="[^"]*"/g,'').replace('<xf','<xf applyAlignment="1"');}
  for(const [tag,content,count]of [['fonts',font,fontId+1],['cellXfs',xf,xfs.length+1]])styles=styles.replace(new RegExp('<'+tag+'\\b[^>]*>[\\s\\S]*?</'+tag+'>'),part=>part.replace(/\s+count="[^"]*"/,'').replace('<'+tag,'<'+tag+' count="'+count+'"').replace('</'+tag+'>',()=>content+'</'+tag+'>'));
  entries['xl/styles.xml']=Buffer.from(styles);xml=xml.replace(old,()=>old.replace(/\s+s="[^"]*"/,'').replace('<c','<c s="'+xfs.length+'"'));entries[sheet.file]=Buffer.from(xml);
}
function apply(entries,kind,op,model){
  if(!validateOperation(op))return false;
  if(op.type==='set_formula')return false; // Cell insertion uses the existing bounded writer.
  if(op.type==='format_cell'){if(kind!=='spreadsheet'||!model.sheets[op.sheet])fail('editor_operation_type_mismatch');formatCell(entries,op,model.sheets[op.sheet]);return true;}
  if(['format_text','move_text'].includes(op.type)){
    const b=model.blocks?.[op.index];if(!b)fail('editor_text_not_found');let xml=entries[b.file].toString();
    if(op.type==='format_text'){const prefix=kind==='document'?'w':'a';let index=0;xml=xml.replace(new RegExp('<'+prefix+':p(?:\\s[^>]*)?>[\\s\\S]*?</'+prefix+':p>','g'),p=>index++===b.ordinal?formatParagraph(p,op.style,prefix):p);}
    else {if(kind!=='presentation')fail('editor_operation_type_mismatch');const info=shapeFor(xml,b.ordinal);if(!info||/<p:grpSp\b/.test(xml)||!tags(info.shape,'a:xfrm').length)fail('editor_geometry_unsupported');const size=model.slideSize,off=`<a:off x="${Math.round(op.x/100*size.width)}" y="${Math.round(op.y/100*size.height)}"/>`,ext=`<a:ext cx="${Math.round(op.width/100*size.width)}" cy="${Math.round(op.height/100*size.height)}"/>`;let i=0;xml=xml.replace(/<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g,s=>i++===info.index?s.replace(/<a:xfrm\b[^>]*>[\s\S]*?<\/a:xfrm>/,()=>'<a:xfrm>'+off+ext+'</a:xfrm>'):s);}
    entries[b.file]=Buffer.from(xml);return true;
  }
  if(op.type==='insert_table'){
    if(kind!=='document')fail('editor_operation_type_mismatch');let xml=entries['word/document.xml'].toString();const borders=['top','left','bottom','right','insideH','insideV'].map(x=>'<w:'+x+' w:val="single" w:sz="4" w:color="CBD5E1"/>').join('');
    const table='<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>'+borders+'</w:tblBorders></w:tblPr><w:tblGrid>'+op.rows[0].map(()=>'<w:gridCol w:w="1800"/>').join('')+'</w:tblGrid>'+op.rows.map(row=>'<w:tr>'+row.map(value=>'<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr><w:p><w:r><w:t xml:space="preserve">'+escape(value)+'</w:t></w:r></w:p></w:tc>').join('')+'</w:tr>').join('')+'</w:tbl>';
    const section=[...xml.matchAll(/<w:sectPr\b[^>]*(?:\/>|>[\s\S]*?<\/w:sectPr>)/g)].at(-1);xml=section&&/^\s*<\/w:body>/.test(xml.slice(section.index+section[0].length))?xml.slice(0,section.index)+table+xml.slice(section.index):xml.replace('</w:body>',()=>table+'</w:body>');entries['word/document.xml']=Buffer.from(xml);return true;
  }
  if(op.type==='add_slide'||op.type==='reorder_slide'){
    if(kind!=='presentation')fail('editor_operation_type_mismatch');
    let presentation=entries['ppt/presentation.xml'].toString(),items=tags(presentation,'p:sldId');
    if(op.type==='reorder_slide'){
      if(!items[op.page-1]||!items[op.toPage-1])fail('editor_page_not_found');const [item]=items.splice(op.page-1,1);items.splice(op.toPage-1,0,item);
      presentation=presentation.replace(/<p:sldIdLst\b[^>]*>[\s\S]*?<\/p:sldIdLst>/,()=>'<p:sldIdLst>'+items.join('')+'</p:sldIdLst>');entries['ppt/presentation.xml']=Buffer.from(presentation);return true;
    }
    if(items.length>=100)fail('editor_slide_limit');
    let serial=1;while(entries['ppt/slides/panthorium'+serial+'.xml'])serial++;
    const filename='ppt/slides/panthorium'+serial+'.xml',id=Math.max(255,...items.map(t=>Number(attr(t,'id'))||255))+1;
    let rels=entries['ppt/_rels/presentation.xml.rels'].toString(),rid='panthoriumSlide'+serial;while(rels.includes('Id="'+rid+'"'))rid+='x';
    const ns='http://schemas.openxmlformats.org';
    const slide=`<p:sld xmlns:p="${ns}/presentationml/2006/main" xmlns:a="${ns}/drawingml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Panthorium title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(model.slideSize.width*.08)}" y="${Math.round(model.slideSize.height*.15)}"/><a:ext cx="${Math.round(model.slideSize.width*.84)}" cy="${Math.round(model.slideSize.height*.3)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="3600" b="1"/><a:t>${escape(op.value)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    // Reuse an existing slide layout without copying any notes or external links.
    const first=model.slideFiles[0],sourceRels=entries[first.replace(/\/([^/]+)$/,'/_rels/$1.rels')]?.toString()||'';
    const layout=tags(sourceRels,'Relationship').find(t=>/\/slideLayout$/.test(attr(t,'Type'))&&!attr(t,'TargetMode'));if(!layout)fail('editor_layout_unsupported');
    entries[filename]=Buffer.from(slide);entries['ppt/slides/_rels/panthorium'+serial+'.xml.rels']=Buffer.from(`<Relationships xmlns="${ns}/package/2006/relationships">${layout}</Relationships>`);
    rels=rels.replace('</Relationships>',()=>`<Relationship Id="${rid}" Type="${ns}/officeDocument/2006/relationships/slide" Target="slides/panthorium${serial}.xml"/></Relationships>`);entries['ppt/_rels/presentation.xml.rels']=Buffer.from(rels);
    presentation=presentation.replace('</p:sldIdLst>',()=>`<p:sldId id="${id}" r:id="${rid}"/></p:sldIdLst>`);entries['ppt/presentation.xml']=Buffer.from(presentation);
    entries['[Content_Types].xml']=Buffer.from(entries['[Content_Types].xml'].toString().replace('</Types>',()=>`<Override PartName="/${filename}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`));return true;
  }
  if(kind!=='presentation')fail('editor_operation_type_mismatch');const file=model.slideFiles?.[op.page-1];if(!file)fail('editor_page_not_found');let xml=entries[file].toString();
  if(op.type==='slide_background'){const bg='<p:bg><p:bgPr><a:solidFill><a:srgbClr val="'+op.color+'"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>';xml=/<p:bg\b/.test(xml)?xml.replace(/<p:bg\b[^>]*>[\s\S]*?<\/p:bg>/,()=>bg):xml.replace(/<p:cSld\b[^>]*>/,s=>s+bg);}
  if(op.type==='add_slide_text'){
    const id=Math.max(1,...tags(xml,'p:cNvPr').map(t=>Number(attr(t,'id'))||0))+1;const shape=`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Panthorium text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="609600" y="609600"/><a:ext cx="5486400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="2400"/><a:t>${escape(op.value)}</a:t></a:r></a:p></p:txBody></p:sp>`;xml=xml.replace('</p:spTree>',()=>shape+'</p:spTree>');
  }entries[file]=Buffer.from(xml);return true;
}
module.exports={TYPES,validateOperation,enrich,apply,formatParagraph};
