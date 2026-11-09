'use strict';
// Bounded native DOCX table geometry, independent of UI and never rebuilding
// imported tables. Continuation cells are explicit in OOXML, not blank content.
const {OfficeArtifactError,_internals}=require('./officeArtifactService');
const {xmlMatches,xmlDirectMatches,xmlParagraphMatches}= _internals;
const fail=()=>{throw new OfficeArtifactError(400,'invalid_editor_table');};
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const value=(xml,tag)=>xmlMatches(xml,tag)[0]?.node.attributes['w:val'];
function layout(rows) {
  if(!Array.isArray(rows)||!rows.length||rows.length>30||!Array.isArray(rows[0])||!rows[0].length)fail();
  for(const row of rows){
    if(!Array.isArray(row)||row.length>10)fail();
    for(const cell of row)if(!cell||typeof cell!=='object'||Array.isArray(cell)||Object.keys(cell).length!==3||!['text','colSpan','rowSpan'].every(k=>Object.hasOwn(cell,k))||typeof cell.text!=='string'||cell.text.length>500||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(cell.text)||!Number.isInteger(cell.colSpan)||cell.colSpan<1||cell.colSpan>10||!Number.isInteger(cell.rowSpan)||cell.rowSpan<1||cell.rowSpan>30)fail();
  }
  const width=rows[0].reduce((n,c)=>n+c.colSpan,0);if(width>10)fail();
  const grid=Array.from({length:rows.length},()=>Array(width).fill(null)),origins=[];
  rows.forEach((cells,row)=>{
    let column=0;
    for(const cell of cells){
      while(column<width&&grid[row][column])column++;
      if(column+cell.colSpan>width||row+cell.rowSpan>rows.length)fail();
      const origin={...cell,row,column};
      for(let r=row;r<row+cell.rowSpan;r++)for(let c=column;c<column+cell.colSpan;c++){
        if(grid[r][c])fail();grid[r][c]=origin;
      }
      origins.push(origin);column+=cell.colSpan;
    }
    if(grid[row].some(c=>!c))fail();
  });
  return {width,grid,origins};
}
function validateOperation(op) {
  if(!['insert_complex_table','insert_nested_table'].includes(op?.type))return false;
  const nested=op.type==='insert_nested_table';
  const keys=nested?['type','index','rows']:['type','rows'];
  if(Object.keys(op).length!==keys.length||!keys.every(k=>Object.hasOwn(op,k))||nested&&(!Number.isInteger(op.index)||op.index<0||op.index>1999))fail();
  layout(op.rows);return true;
}
function tableXml(rows) {
  const {width,grid}=layout(rows);
  const borders=['top','left','bottom','right','insideH','insideV'].map(x=>'<w:'+x+' w:val="single" w:sz="4" w:color="CBD5E1"/>').join('');
  let table='<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>'+borders+'</w:tblBorders></w:tblPr><w:tblGrid>'+Array(width).fill('<w:gridCol w:w="1800"/>').join('')+'</w:tblGrid>';
  grid.forEach((cells,row)=>{
    table+='<w:tr>';
    for(let column=0;column<width;){
      const cell=cells[column],continuation=cell.row!==row;
      table+='<w:tc><w:tcPr><w:tcW w:w="'+(1800*cell.colSpan)+'" w:type="dxa"/>'+(cell.colSpan>1?'<w:gridSpan w:val="'+cell.colSpan+'"/>':'')+(cell.rowSpan>1?'<w:vMerge'+(continuation?'':' w:val="restart"')+'/>':'')+'</w:tcPr>'+(continuation?'<w:p/>':'<w:p><w:r><w:t xml:space="preserve">'+escape(cell.text)+'</w:t></w:r></w:p>')+'</w:tc>';
      column+=cell.colSpan;
    }
    table+='</w:tr>';
  });
  table+='</w:tbl>';
  return table;
}
const ancestor=(node,name)=>{let p=node?.parent;while(p&&p.name!==name)p=p.parent;return p;};
function apply(entries,op,model) {
  if(!validateOperation(op))return false;
  if(!entries['word/document.xml'])throw new OfficeArtifactError(400,'editor_operation_type_mismatch');
  let xml=entries['word/document.xml'].toString();
  if(xmlMatches(xml,'w:tbl').length>=100)throw new OfficeArtifactError(413,'editor_table_limit');
  const table=tableXml(op.rows);
  if(op.type==='insert_nested_table'){
    if(!model?.blocks)throw new OfficeArtifactError(400,'editor_text_not_found');
    const block=model.blocks.find(b=>b.index===op.index),paragraphs=xmlMatches(xml,'w:p',true);
    if(!block||block.file!=='word/document.xml')throw new OfficeArtifactError(400,'editor_text_not_found');
    const paragraph=paragraphs[block.ordinal],cell=ancestor(paragraph?.node,'w:tc'),parentTable=ancestor(cell,'w:tbl');
    if(!cell||!parentTable||paragraph.node.parent!==cell)throw new OfficeArtifactError(400,'editor_nested_table_target');
    const current=enrich(entries,{blocks:model.blocks.map(b=>({...b}))});
    const target=current.blocks.find(b=>b.index===op.index)?.table;
    if(!target||target.unsupported)throw new OfficeArtifactError(409,'editor_table_geometry_unsupported');
    const parent=current.tables[target.index];
    if(parent.depth>=3)throw new OfficeArtifactError(400,'editor_table_nesting_limit');
    let chain=parent;
    while(chain){if(!chain.supported)throw new OfficeArtifactError(409,'editor_table_geometry_unsupported');chain=chain.parentTable===null?null:current.tables[chain.parentTable];}
    const at=cell.closeStart,addition=table+'<w:p/>';
    xml=xml.slice(0,at)+addition+xml.slice(at);
    // Stable batch indices: new paragraphs must not retarget subsequent edits.
    const added=xmlMatches(addition,'w:p',true).length;
    for(const b of model.blocks)if(b.file==='word/document.xml'&&paragraphs[b.ordinal]?.index>=at)b.ordinal+=added;
  }else{
    const section=xmlMatches(xml,'w:sectPr').at(-1);
    if(section&&/^\s*<\/w:body>/.test(xml.slice(section.index+section[0].length)))xml=xml.slice(0,section.index)+table+xml.slice(section.index);
    else if(xml.includes('</w:body>'))xml=xml.replace('</w:body>',()=>table+'</w:body>');
    else throw new OfficeArtifactError(400,'editor_office_unsupported');
  }
  entries['word/document.xml']=Buffer.from(xml);return true;
}
function inspectTable(match,index,paragraphs,model) {
  const xml=match[0],rows=xmlDirectMatches(xml,'w:tr');
  const result={index,rows:[],columns:0,supported:true};
  const declaredGrid=xmlDirectMatches(xml,'w:tblGrid')[0],declaredWidth=declaredGrid?xmlDirectMatches(declaredGrid[0],'w:gridCol').length:0;
  const unsupported=()=>({...result,rows:[],supported:false,reason:'editor_table_geometry_unsupported'});
  const root=xmlMatches(xml,'w:tbl')[0].node;
  const ownTag=name=>xmlMatches(xml,name).some(m=>ancestor(m.node,'w:tbl')===root);
  if(!rows.length||rows.length>30||ownTag('w:hMerge')||ownTag('w:gridBefore')||ownTag('w:gridAfter'))return unsupported();
  let previous=new Map();
  for(const [row,tr] of rows.entries()){
    const cells=xmlDirectMatches(tr[0],'w:tc'),rendered=[];let column=0;const current=new Map();
    for(const tc of cells){
      const props=xmlDirectMatches(tc[0],'w:tcPr')[0]?.[0]||'',span=value(props,'w:gridSpan'),colSpan=span===undefined?1:Number(span);
      const merge=xmlMatches(props,'w:vMerge')[0],mergeVal=merge?.node.attributes['w:val'];
      if(!Number.isInteger(colSpan)||colSpan<1||column+colSpan>10||merge&&mergeVal!==undefined&&!['restart','continue'].includes(mergeVal))return unsupported();
      const start=match.index+tr.index+tc.index,end=start+tc[0].length;
      const contained=model.blocks.filter(b=>b.file==='word/document.xml'&&ancestor(paragraphs[b.ordinal]?.node,'w:tc')?.index===start);
      if(contained.some(b=>paragraphs[b.ordinal].node.parent?.index!==start))return unsupported();
      const blocks=contained;
      let cell;
      if(merge&&mergeVal!=='restart'){
        cell=previous.get(column);
        if(!cell||cell.colSpan!==colSpan)return unsupported();
        if(blocks.some(b=>b.text)||xmlMatches(tc[0],'w:tbl').length)return unsupported();
        cell.rowSpan++;
      }else{
        cell={row,column,colSpan,rowSpan:1,blockIndices:blocks.map(b=>b.index),childTables:[],content:blocks.map(b=>({type:'paragraph',index:b.index})),_start:start,_end:end};rendered.push(cell);
      }
      if(merge)current.set(column,cell);
      column+=colSpan;
    }
    if(!column||declaredWidth&&column!==declaredWidth||row&&column!==result.columns)return unsupported();
    result.columns=column;result.rows.push(rendered);previous=current;
  }
  return result;
}
function enrich(entries,model) {
  if(!entries['word/document.xml']||!Array.isArray(model.blocks))return model;
  const xml=entries['word/document.xml'].toString(),paragraphs=xmlMatches(xml,'w:p',true),tables=xmlMatches(xml,'w:tbl');
  const byStart=new Map(tables.map((m,i)=>[m.index,i]));
  model.tables=tables.map((m,index)=>{
    const parent=ancestor(m.node,'w:tbl');let depth=1,p=parent;while(p){depth++;p=ancestor(p,'w:tbl');}
    const result=inspectTable(m,index,paragraphs,model);
    if(depth>3||tables.length>100){result.supported=false;result.rows=[];result.reason='editor_table_nesting_limit';}
    return {...result,depth,parentTable:parent?byStart.get(parent.index):null,parentCell:null,beforeIndex:model.blocks.find(b=>b.file==='word/document.xml'&&paragraphs[b.ordinal]?.index>=m.index)?.index??null};
  });
  const blockById=new Map(model.blocks.map(b=>[b.index,b]));
  for(const b of model.blocks)delete b.table;
  for(const table of model.tables){
    const match=tables[table.index];
    if(table.parentTable!==null){
      const parent=model.tables[table.parentTable],parentCell=parent.rows.flat().find(c=>c._start<match.index&&c._end>match.index);
      if(parentCell&&match.node.parent?.index===parentCell._start){table.parentCell={row:parentCell.row,column:parentCell.column};parentCell.childTables.push(table.index);parentCell.content.push({type:'table',index:table.index});}
      else if(parent.supported){table.supported=false;table.reason='editor_table_geometry_unsupported';}
    }
    if(table.supported){for(const row of table.rows)for(const cell of row)for(const index of cell.blockIndices){const b=blockById.get(index);if(b)b.table={index:table.index,row:cell.row,column:cell.column,colSpan:cell.colSpan,rowSpan:cell.rowSpan};}}
    else {for(const b of model.blocks){const p=paragraphs[b.ordinal];if(b.file==='word/document.xml'&&p&&ancestor(p.node,'w:tbl')?.index===match.index)b.table={index:table.index,unsupported:true};}}
  }
  for(const table of model.tables)for(const row of table.rows)for(const cell of row){
    const position=item=>item.type==='table'?tables[item.index].index:paragraphs[blockById.get(item.index)?.ordinal]?.index??Infinity;
    cell.content.sort((a,b)=>position(a)-position(b));delete cell._start;delete cell._end;
  }
  return model;
}
module.exports={layout,validateOperation,apply,enrich};
