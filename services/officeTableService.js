'use strict';
// Bounded native DOCX table geometry, independent of UI and never rebuilding
// imported tables. Continuation cells are explicit in OOXML, not blank content.
const {OfficeArtifactError,_internals}=require('./officeArtifactService');
const {xmlMatches,xmlDirectMatches}= _internals;
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
  if(op?.type!=='insert_complex_table')return false;
  if(Object.keys(op).length!==2||!Object.hasOwn(op,'rows'))fail();
  layout(op.rows);return true;
}
function apply(entries,op) {
  if(!validateOperation(op))return false;
  const {width,grid}=layout(op.rows);
  if(!entries['word/document.xml'])throw new OfficeArtifactError(400,'editor_operation_type_mismatch');
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
  let xml=entries['word/document.xml'].toString();const section=xmlMatches(xml,'w:sectPr').at(-1);
  if(section&&/^\s*<\/w:body>/.test(xml.slice(section.index+section[0].length)))xml=xml.slice(0,section.index)+table+xml.slice(section.index);
  else if(xml.includes('</w:body>'))xml=xml.replace('</w:body>',()=>table+'</w:body>');
  else throw new OfficeArtifactError(400,'editor_office_unsupported');
  entries['word/document.xml']=Buffer.from(xml);return true;
}
function inspectTable(match,index,paragraphs,model) {
  const xml=match[0],rows=xmlDirectMatches(xml,'w:tr');
  const result={index,rows:[],columns:0,supported:true};
  const declaredGrid=xmlDirectMatches(xml,'w:tblGrid')[0],declaredWidth=declaredGrid?xmlDirectMatches(declaredGrid[0],'w:gridCol').length:0;
  const unsupported=()=>({...result,rows:[],supported:false,reason:'editor_table_geometry_unsupported'});
  if(xmlMatches(xml,'w:tbl').length!==1||!rows.length||rows.length>30||xmlMatches(xml,'w:hMerge').length||xmlMatches(xml,'w:gridBefore').length||xmlMatches(xml,'w:gridAfter').length)return unsupported();
  let previous=new Map();
  for(const [row,tr] of rows.entries()){
    const cells=xmlDirectMatches(tr[0],'w:tc'),rendered=[];let column=0;const current=new Map();
    for(const tc of cells){
      const span=value(tc[0],'w:gridSpan'),colSpan=span===undefined?1:Number(span);
      const merge=xmlMatches(tc[0],'w:vMerge')[0],mergeVal=merge?.node.attributes['w:val'];
      if(!Number.isInteger(colSpan)||colSpan<1||column+colSpan>10||merge&&mergeVal!==undefined&&!['restart','continue'].includes(mergeVal))return unsupported();
      const start=match.index+tr.index+tc.index,end=start+tc[0].length;
      const blocks=model.blocks.filter(b=>b.file==='word/document.xml'&&paragraphs[b.ordinal]?.index>=start&&paragraphs[b.ordinal].index<end);
      let cell;
      if(merge&&mergeVal!=='restart'){
        cell=previous.get(column);
        if(!cell||cell.colSpan!==colSpan)return unsupported();
        // Nonempty continuation content cannot safely be hidden by a merged UI.
        if(blocks.some(b=>b.text))return unsupported();
        cell.rowSpan++;
      }else{
        cell={row,column,colSpan,rowSpan:1,blockIndices:blocks.map(b=>b.index)};rendered.push(cell);
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
  const xml=entries['word/document.xml'].toString(),paragraphs=xmlMatches(xml,'w:p',true);
  const tables=xmlMatches(xml,'w:tbl').filter(m=>{let p=m.node.parent;while(p){if(p.name==='w:tbl')return false;p=p.parent;}return true;});
  model.tables=tables.map((m,index)=>({...inspectTable(m,index,paragraphs,model),beforeIndex:model.blocks.find(b=>b.file==='word/document.xml'&&paragraphs[b.ordinal]?.index>=m.index)?.index??null}));
  for(const b of model.blocks)delete b.table;
  for(const table of model.tables){
    if(table.supported){for(const row of table.rows)for(const cell of row)for(const index of cell.blockIndices){const b=model.blocks.find(b=>b.index===index);if(b)b.table={index:table.index,row:cell.row,column:cell.column,colSpan:cell.colSpan,rowSpan:cell.rowSpan};}}
    else {const m=tables[table.index];for(const b of model.blocks){const p=paragraphs[b.ordinal];if(b.file==='word/document.xml'&&p&&p.index>=m.index&&p.index<m.index+m[0].length)b.table={index:table.index,unsupported:true};}}
  }
  return model;
}
module.exports={layout,validateOperation,apply,enrich};
