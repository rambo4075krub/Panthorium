'use strict';
// Embed owned PNG/JPEG bytes into native packages; never use external image links.
const path=require('node:path');
const {OfficeArtifactError,_internals}=require('./officeArtifactService');
const {xmlMatches,xmlInsertChild}= _internals;
const NS='http://schemas.openxmlformats.org';
const fail=code=>{throw new OfficeArtifactError(400,code);};
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function validateOperation(op){
 if(op?.type!=='insert_image')return false;
 const keys=op.page==null?['type','fileId']:['type','fileId','page','x','y','width','height'];
 if(Object.keys(op).length!==keys.length||!keys.every(k=>Object.hasOwn(op,k))||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(op.fileId))fail('invalid_editor_image');
 if(op.page!=null&&(!Number.isInteger(op.page)||op.page<1||op.page>100||!['x','y','width','height'].every(k=>Number.isFinite(op[k])&&op[k]>=(['width','height'].includes(k)?1:0)&&op[k]<=100)||op.x+op.width>100||op.y+op.height>100))fail('invalid_editor_geometry');
 return true;
}
function apply(entries,kind,op,model){
 if(!validateOperation(op))return false;
 if(!['document','presentation'].includes(kind)||kind==='document'&&op.page!=null||kind==='presentation'&&op.page==null)fail('editor_operation_type_mismatch');
 const image=model.newImages?.get(op.fileId);if(!image)fail('editor_image_not_loaded');
 const main=kind==='document'?'word/document.xml':model.slideFiles[op.page-1];if(!main||!entries[main])fail('editor_page_not_found');
 const prefix=kind==='document'?'word':'ppt';
 if(Object.keys(entries).filter(n=>n.startsWith(prefix+'/media/')).reduce((sum,n)=>sum+entries[n].length,0)+image.body.length>4*1024*1024)fail('editor_image_budget');
 const pictures=(kind==='document'?[main]:model.slideFiles).reduce((sum,n)=>sum+xmlMatches(entries[n].toString(),kind==='document'?'w:drawing':'p:pic',true).length,0);if(pictures>=16)fail('editor_image_budget');
 let serial=1;while(Object.keys(entries).some(n=>n.startsWith(prefix+'/media/panthorium-edit'+serial+'.')))serial++;
 const media=prefix+'/media/panthorium-edit'+serial+'.'+image.ext,relsPath=main.replace(/\/([^/]+)$/,'/_rels/$1.rels');
 let rels=entries[relsPath]?.toString()||`<Relationships xmlns="${NS}/package/2006/relationships"></Relationships>`,rid='panthoriumImage'+serial;
 while(xmlMatches(rels,'Relationship').some(m=>m.node.attributes.Id===rid))rid+='x';
 entries[media]=Buffer.from(image.body);
 const rel=`<Relationship Id="${rid}" Type="${NS}/officeDocument/2006/relationships/image" Target="${path.posix.relative(path.posix.dirname(main),media)}"/>`;
 entries[relsPath]=Buffer.from(xmlInsertChild(rels,rel));
 entries['[Content_Types].xml']=Buffer.from(xmlInsertChild(entries['[Content_Types].xml'].toString(),`<Override PartName="/${media}" ContentType="${image.contentType}"/>`));
 let xml=entries[main].toString();
 if(kind==='document'){
  const id=Math.max(0,...xmlMatches(xml,'wp:docPr').map(m=>Number(m.node.attributes.id)||0))+1,scale=Math.min(5486400/image.width,5486400/image.height),w=Math.round(image.width*scale),h=Math.round(image.height*scale);
  const picture=`<w:p><w:r><w:drawing xmlns:wp="${NS}/drawingml/2006/wordprocessingDrawing" xmlns:a="${NS}/drawingml/2006/main" xmlns:pic="${NS}/drawingml/2006/picture" xmlns:r="${NS}/officeDocument/2006/relationships"><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${w}" cy="${h}"/><wp:docPr id="${id}" name="${escape(image.name)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="${NS}/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${escape(image.name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  const section=xmlMatches(xml,'w:sectPr').at(-1);xml=section&&/^\s*<\/w:body>/.test(xml.slice(section.index+section[0].length))?xml.slice(0,section.index)+picture+xml.slice(section.index):xml.replace('</w:body>',()=>picture+'</w:body>');
 }else{
  const id=Math.max(1,...xmlMatches(xml,'p:cNvPr').map(m=>Number(m.node.attributes.id)||0))+1,{width,height}=model.slideSize;
  const pic=`<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${escape(image.name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${Math.round(op.x/100*width)}" y="${Math.round(op.y/100*height)}"/><a:ext cx="${Math.round(op.width/100*width)}" cy="${Math.round(op.height/100*height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  xml=xml.replace('</p:spTree>',()=>pic+'</p:spTree>');
 }
 entries[main]=Buffer.from(xml);return true;
}
module.exports={validateOperation,apply};
