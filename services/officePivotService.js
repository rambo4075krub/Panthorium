'use strict';
// Bounded native OOXML pivot tables, not static summaries masquerading as pivots.
const crypto = require('node:crypto');
const path = require('node:path');
const { OfficeArtifactError, LIMITS, _internals:i } = require('./officeArtifactService');
const core = require('../office-suite-core');
const {xmlMatches,xmlDirectMatches,xmlInsertChild,xmlReplaceSelected,xmlWithoutAttributes,validateOfficeXmlEntries} = i;
const NS='http://schemas.openxmlformats.org', MAIN=NS+'/spreadsheetml/2006/main', REL=NS+'/officeDocument/2006/relationships';
const MARK='PanthoriumPivot:1:';
const fail=code=>{throw new OfficeArtifactError(400,code);};
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const decode=v=>String(v).replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi,s=>{
  const named={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"};if(named[s])return named[s];
  const n=s[2].toLowerCase()==='x'?parseInt(s.slice(3,-1),16):Number(s.slice(2,-1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';
});
const attrs=s=>xmlMatches(s,s.match(/<([\w:]+)/)?.[1]||'')[0]?.node.attributes||{};
const text=(s,tag)=>xmlMatches(s,tag,true).map(m=>decode(m[1])).join('');
const column=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
const folded=s=>s.normalize('NFC').toLowerCase();
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
function rangeOf(s){
  const m=typeof s==='string'&&/^([A-Z]{1,2})([1-9]\d{0,3}):([A-Z]{1,2})([1-9]\d{0,3})$/.exec(s);
  if(!m||column(m[3])>40||column(m[3])<column(m[1])||+m[4]>1000||+m[4]<=+m[2])fail('invalid_editor_pivot_range');
  const range={left:column(m[1]),right:column(m[3]),top:+m[2],bottom:+m[4]};
  range.width=range.right-range.left+1;
  if(range.width<2||range.width*(range.bottom-range.top+1)>10000)fail('editor_pivot_range_too_large');
  return range;
}
function validateOperation(op){
  if(op?.type!=='insert_pivot')return false;
  const keys=['type','sheet','range','groupColumn','valueColumn','aggregation','targetSheetName'];
  if(Object.keys(op).length!==keys.length||!keys.every(k=>Object.hasOwn(op,k))||!Number.isInteger(op.sheet)||op.sheet<0||op.sheet>31)fail('invalid_editor_pivot');
  const r=rangeOf(op.range);
  if(!['groupColumn','valueColumn'].every(k=>Number.isInteger(op[k])&&op[k]>=0&&op[k]<r.width)||op.groupColumn===op.valueColumn)fail('invalid_editor_pivot_column');
  if(!['sum','count','average'].includes(op.aggregation))fail('invalid_editor_pivot_aggregation');
  const name=op.targetSheetName;
  if(typeof name!=='string'||!name.trim()||name!==name.trim()||name.length>31||/[\\/?*\[\]:\x00-\x1f\ufffe\uffff]/.test(name)||name.startsWith("'")||name.endsWith("'"))fail('invalid_editor_pivot_sheet_name');
  return true;
}
function sheetsOf(entries){
  const rels=new Map(xmlMatches(entries['xl/_rels/workbook.xml.rels']?.toString()||'','Relationship').filter(m=>!m.node.attributes.TargetMode).map(m=>[m.node.attributes.Id,m.node.attributes]));
  return xmlMatches(entries['xl/workbook.xml'].toString(),'sheet').map(m=>{
    const a=m.node.attributes,rel=rels.get(a['r:id']);
    if(!rel||rel.Type!==REL+'/worksheet')fail('editor_pivot_workbook_unsupported');
    const file=rel.Target.startsWith('/')?rel.Target.slice(1):path.posix.normalize('xl/'+rel.Target);
    if(!/^xl\/worksheets\/[^/]+\.xml$/.test(file)||!entries[file])fail('editor_pivot_workbook_unsupported');
    return {name:a.name,file,id:Number(a.sheetId)};
  });
}
function currentSheets(entries,sheets){
  const shared=xmlMatches(entries['xl/sharedStrings.xml']?.toString()||'','si',true).map(m=>text(m[0],'t'));
  return sheets.map(sheet=>{
    const cells=[];let rowNumber=0;
    for(const row of xmlMatches(entries[sheet.file].toString(),'row')){
      rowNumber=attrs(row[0]).r?Number(attrs(row[0]).r):rowNumber+1;let col=0;
      for(const c of xmlDirectMatches(row[0],'c')){
        const a=c.node.attributes,ref=a.r;
        if(ref&&!/^[A-Z]{1,3}[1-9]\d*$/.test(ref))fail('editor_office_unsupported');
        col=ref?column(ref.match(/^[A-Z]+/)[0]):col+1;
        const raw=text(c[0],'v'),type=a.t,f=xmlMatches(c[0],'f')[0];
        const value=type==='b'?raw==='1':type==='s'?shared[Number(raw)]??'':type==='inlineStr'?text(c[0],'t'):raw&&(!type||type==='n')&&Number.isFinite(Number(raw))?Number(raw):raw;
        cells.push({cell:ref||core.column(col)+rowNumber,value,...(type==='e'?{cellError:raw}:{}),...(f?{formula:true,formulaText:!Object.hasOwn(f.node.attributes,'t')?'='+text(c[0],'f'):null}:{})});
      }
    }
    if(cells.length>10000)fail('editor_file_too_complex');
    return {name:sheet.name,cells};
  });
}
function checkDependencies(calculatedInput,sheets,source,range,targetName){
  const maps=calculatedInput.map(s=>new Map(s.cells.map(c=>[c.cell,c]))),done=new Set(),active=new Set();let budget=100000;
  const derived=new Set(sheets.filter(s=>/^xl\/worksheets\/panthoriumPivot\d+\.xml$/.test(s.file)).map(s=>folded(s.name)));derived.add(folded(targetName));
  function visit(si,ref,depth){
    if(--budget<0||depth>64)fail('editor_pivot_dependency_limit');
    const key=si+':'+ref;if(done.has(key))return;if(active.has(key))fail('editor_pivot_formula_cycle');
    const cell=maps[si]?.get(ref);if(!cell?.formula)return;
    let ast;try{ast=core.parse(cell.formulaText);}catch(_){fail('editor_pivot_formula_error');}
    active.add(key);
    const walk=node=>{
      if(--budget<0)fail('editor_pivot_dependency_limit');
      if(node.ref){
        const name=node.sheet===null?sheets[si].name:node.sheet;
        if(derived.has(folded(name)))fail('editor_pivot_derived_dependency_unsupported');
        const ti=sheets.findIndex(s=>folded(s.name)===folded(name));if(ti<0)return;
        const start=/^([A-Z]+)(\d+)$/.exec(node.ref),end=/^([A-Z]+)(\d+)$/.exec(node.end||node.ref);
        const l=Math.min(column(start[1]),column(end[1])),r=Math.max(column(start[1]),column(end[1])),t=Math.min(+start[2],+end[2]),b=Math.max(+start[2],+end[2]);
        if((r-l+1)*(b-t+1)>10000)fail('editor_pivot_dependency_limit');
        for(let row=t;row<=b;row++)for(let col=l;col<=r;col++)visit(ti,core.column(col)+row,depth+1);
      }
      for(const child of node.args||[])walk(child);
    };walk(ast);active.delete(key);done.add(key);
  }
  const si=sheets.findIndex(s=>s.file===source.file);
  for(let row=range.top;row<=range.bottom;row++)for(let col=range.left;col<=range.right;col++)visit(si,core.column(col)+row,0);
}
function dataFor(entries,sheets,source,op){
  const range=rangeOf(op.range),input=currentSheets(entries,sheets);
  checkDependencies(input,sheets,source,range,op.targetSheetName);
  const calculated=core.calculate(input);
  const cells=new Map(calculated.find(s=>s.name===source.name).cells.map(c=>[c.cell,c]));
  const read=(r,c)=>{
    const cell=cells.get(core.column(c)+r);
    if(cell?.calculationError||cell?.cellError)fail('editor_pivot_formula_error');
    const v=cell?.calculated??cell?.value??'';
    if(!['string','number','boolean'].includes(typeof v)||typeof v==='number'&&!Number.isFinite(v)||typeof v==='string'&&(v.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/.test(v)))fail('editor_pivot_value_unsupported');
    return v;
  };
  const headers=Array.from({length:range.width},(_,c)=>read(range.top,range.left+c));
  if(headers.some(h=>typeof h!=='string'||!h.trim()||h.length>255)||new Set(headers.map(h=>folded(h.trim()))).size!==headers.length)fail('editor_pivot_ambiguous_headers');
  const dictionaries=headers.map(()=>({items:[],map:new Map()})),records=[],groups=new Map();
  const key=v=>typeof v+':'+String(v);
  let total=0,count=0;
  for(let row=range.top+1;row<=range.bottom;row++){
    const values=Array.from({length:range.width},(_,c)=>read(row,range.left+c));
    const indexes=values.map((v,c)=>{
      const dict=dictionaries[c],k=key(v);
      if(!dict.map.has(k)){dict.map.set(k,dict.items.length);dict.items.push(v);}
      return dict.map.get(k);
    });records.push(indexes);
    const group=values[op.groupColumn],value=values[op.valueColumn],k=key(group);
    if(!groups.has(k))groups.set(k,{value:group,index:indexes[op.groupColumn],sum:0,count:0});
    const g=groups.get(k);
    if(op.aggregation!=='count'&&typeof value!=='number')fail('editor_pivot_numeric_values_required');
    if(value!==''){g.count++;count++;if(typeof value==='number'){g.sum+=value;total+=value;}}
    if(!Number.isFinite(g.sum)||!Number.isFinite(total))fail('editor_pivot_numeric_overflow');
  }
  if(groups.size>998)fail('editor_pivot_group_limit');
  // Excel treats text labels case-insensitively. Reject collisions rather than
  // displaying two groups that its native refresh would later collapse.
  const strings=[...groups.values()].filter(g=>typeof g.value==='string').map(g=>folded(g.value));
  if(new Set(strings).size!==strings.length)fail('editor_pivot_ambiguous_group');
  const result=g=>op.aggregation==='count'?g.count:op.aggregation==='average'?g.sum/g.count:g.sum;
  return {headers,dictionaries,records,groups:[...groups.values()].map(g=>({...g,result:result(g)})),total:result({sum:total,count})};
}
const cacheValue=v=>v===''?'<m/>':typeof v==='number'?`<n v="${v}"/>`:typeof v==='boolean'?`<b v="${+v}"/>`:`<s v="${escape(v)}"/>`;
function parts(serial,cacheId,source,op,data){
  const {headers,dictionaries,records,groups}=data,caption=({sum:'Sum',count:'Count',average:'Average'})[op.aggregation]+' of '+headers[op.valueColumn];
  const cache=`<pivotCacheDefinition xmlns="${MAIN}" xmlns:r="${REL}" r:id="rId1" refreshedBy="Panthorium pivot ${serial}" saveData="1" refreshOnLoad="0" enableRefresh="1" createdVersion="6" refreshedVersion="6" minRefreshableVersion="3" recordCount="${records.length}"><cacheSource type="worksheet"><worksheetSource ref="${escape(op.range)}" sheet="${escape(source.name)}"/></cacheSource><cacheFields count="${headers.length}">${headers.map((h,c)=>{const items=dictionaries[c].items,types=new Set(items.map(v=>v===''?'blank':typeof v));return `<cacheField name="${escape(h)}" numFmtId="0"><sharedItems count="${items.length}" containsSemiMixedTypes="${+(types.has('string')||types.has('boolean')||types.has('blank'))}" containsNonDate="1" containsString="${+(types.has('string')||types.has('boolean'))}" containsBlank="${+types.has('blank')}" containsMixedTypes="${+(types.size>1)}" containsNumber="${+types.has('number')}" containsInteger="${+(types.has('number')&&items.filter(v=>typeof v==='number').every(Number.isInteger))}">${items.map(cacheValue).join('')}</sharedItems></cacheField>`;}).join('')}</cacheFields></pivotCacheDefinition>`;
  const recordXml=`<pivotCacheRecords xmlns="${MAIN}" count="${records.length}">${records.map(row=>'<r>'+row.map(v=>`<x v="${v}"/>`).join('')+'</r>').join('')}</pivotCacheRecords>`;
  const fields=headers.map((_,c)=>c===op.groupColumn?`<pivotField axis="axisRow" showAll="0" defaultSubtotal="0" compact="0" outline="0"><items count="${groups.length}">${groups.map(g=>`<item x="${g.index}"/>`).join('')}</items></pivotField>`:c===op.valueColumn?'<pivotField dataField="1" showAll="0" defaultSubtotal="0"/>':'<pivotField showAll="0" defaultSubtotal="0"/>').join('');
  let pivot=`<pivotTableDefinition xmlns="${MAIN}" xmlns:r="${REL}" r:id="rId1" name="PanthoriumPivot${serial}" cacheId="${cacheId}" dataCaption="${escape(caption)}" grandTotalCaption="Grand Total" rowGrandTotals="1" colGrandTotals="1" compact="0" compactData="0" outline="0" outlineData="0" gridDropZones="1" multipleFieldFilters="0" createdVersion="6" updatedVersion="6" minRefreshableVersion="3"><location ref="A1:B${groups.length+2}" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/><pivotFields count="${headers.length}">${fields}</pivotFields><rowFields count="1"><field x="${op.groupColumn}"/></rowFields><rowItems count="${groups.length+1}">${groups.map((_,j)=>`<i><x v="${j}"/></i>`).join('')}<i t="grand"><x v="0"/></i></rowItems><dataFields count="1"><dataField name="${escape(caption)}" fld="${op.valueColumn}" subtotal="${op.aggregation}"/></dataFields><pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>`;
  const meta={sourceSheetName:source.name,range:op.range,groupColumn:op.groupColumn,valueColumn:op.valueColumn,aggregation:op.aggregation,targetSheetName:op.targetSheetName,digest:digest(pivot)};
  pivot=pivot.replace('<pivotTableDefinition',`<pivotTableDefinition tag="${escape(MARK+JSON.stringify(meta))}"`);
  const rows=[[headers[op.groupColumn],caption],...groups.map(g=>[g.value===''?'(blank)':g.value,g.result]),['Grand Total',data.total]];
  return {cache,recordXml,pivot,rows};
}
function resultSheet(rows,old){
  const oldXml=old||`<worksheet xmlns="${MAIN}"><sheetData/></worksheet>`,rowMap=new Map();
  for(const r of xmlMatches(oldXml,'row')){
    const n=Number(r.node.attributes.r);if(!Number.isInteger(n)||n<1)fail('editor_pivot_output_unsupported');
    const cells=xmlDirectMatches(r[0],'c'),styles=new Map(cells.map(c=>[c.node.attributes.r,c.node.attributes.s]));
    const remaining=xmlReplaceSelected(r[0],cells.filter(c=>/^[AB][1-9]\d*$/.test(c.node.attributes.r||'')),'');
    rowMap.set(n,{xml:remaining,styles});
  }
  rows.forEach((values,j)=>{
    const row=j+1,existing=rowMap.get(row)||{xml:`<row r="${row}"/>`,styles:new Map()};
    const cells=values.map((v,c)=>{const ref=core.column(c+1)+row,style=existing.styles.get(ref);return `<c r="${ref}"${style!=null?` s="${escape(style)}"`:''}${typeof v==='number'?'':typeof v==='boolean'?' t="b"':' t="inlineStr"'}>${typeof v==='number'||typeof v==='boolean'?'<v>'+(typeof v==='boolean'?+v:v)+'</v>':'<is><t xml:space="preserve">'+escape(v)+'</t></is>'}</c>`;}).join('');
    rowMap.set(row,{xml:xmlInsertChild(existing.xml,cells,true)});
  });
  const sheetData='<sheetData>'+[...rowMap].sort((a,b)=>a[0]-b[0]).map(([,r])=>r.xml).join('')+'</sheetData>';
  let xml=xmlReplaceSelected(oldXml,xmlMatches(oldXml,'sheetData'),sheetData,true);
  xml=xmlReplaceSelected(xml,xmlDirectMatches(xml,'dimension'),'');return xml;
}
function paths(serial){return {cache:`xl/pivotCache/panthoriumCache${serial}.xml`,records:`xl/pivotCache/panthoriumRecords${serial}.xml`,pivot:`xl/pivotTables/panthoriumPivot${serial}.xml`,sheet:`xl/worksheets/panthoriumPivot${serial}.xml`};}
const rels=items=>`<Relationships xmlns="${NS}/package/2006/relationships">${items.map(([id,type,target])=>`<Relationship Id="${escape(id)}" Type="${REL}/${type}" Target="${escape(target)}"/>`).join('')}</Relationships>`;
const relpath=file=>path.posix.join(path.posix.dirname(file),'_rels',path.posix.basename(file)+'.rels');
function pivotFiles(entries){
  const files=new Set(Object.keys(entries).filter(f=>/^xl\/pivotTables\/[^/]+\.xml$/.test(f)));
  for(const m of xmlMatches(entries['[Content_Types].xml']?.toString()||'','Override'))if(m.node.attributes.ContentType==='application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml')files.add((m.node.attributes.PartName||'').replace(/^\//,''));
  return [...files];
}
function verifyLinks(entries,p,cacheId,meta){
  const target=(file,id,type)=>{
    const rel=xmlMatches(entries[relpath(file)]?.toString()||'','Relationship').find(m=>m.node.attributes.Id===id)?.node.attributes;
    if(!rel||rel.TargetMode||rel.Type!==REL+'/'+type||typeof rel.Target!=='string')fail('editor_pivot_modified_externally');
    return rel.Target.startsWith('/')?rel.Target.slice(1):path.posix.normalize(path.posix.dirname(file)+'/'+rel.Target);
  };
  if(!entries[p.cache]||!entries[p.records]||!entries[p.sheet]||target(p.sheet,'rId1','pivotTable')!==p.pivot||target(p.pivot,'rId1','pivotCacheDefinition')!==p.cache||target(p.cache,'rId1','pivotCacheRecords')!==p.records)fail('editor_pivot_modified_externally');
  const cache=xmlMatches(entries['xl/workbook.xml'].toString(),'pivotCache').find(m=>Number(m.node.attributes.cacheId)===cacheId)?.node.attributes;
  if(!cache||target('xl/workbook.xml',cache['r:id'],'pivotCacheDefinition')!==p.cache)fail('editor_pivot_modified_externally');
  const source=xmlMatches(entries[p.cache].toString(),'worksheetSource')[0]?.node.attributes;
  if(source?.sheet!==meta.sourceSheetName||source.ref!==meta.range)fail('editor_pivot_modified_externally');
}
function apply(entries,kind,op,model){
  if(!validateOperation(op))return false;
  if(kind!=='spreadsheet'||!model.sheets?.[op.sheet])fail('editor_operation_type_mismatch');
  validateOfficeXmlEntries(entries);
  // Adding a pivot triggers formula-cache recalculation in the save pipeline.
  // That could invalidate an imported pivot even without a direct source edit.
  if(describe(entries).importedPivotCount>0)fail('editor_imported_pivot_edit_unsupported');
  const sheets=sheetsOf(entries),source=sheets.find(s=>s.file===model.sheets[op.sheet].file);
  if(!source)fail('editor_pivot_source_missing');
  if(sheets.length>=32)fail('editor_pivot_sheet_limit');
  if(sheets.some(s=>folded(s.name)===folded(op.targetSheetName)))fail('editor_pivot_sheet_exists');
  if(/^xl\/worksheets\/panthoriumPivot\d+\.xml$/.test(source.file))fail('editor_pivot_derived_source_unsupported');
  const data=dataFor(entries,sheets,source,op);
  let serial=1,p=paths(serial);
  const usedNames=new Set(Object.keys(entries).filter(f=>/^xl\/pivotTables\/[^/]+\.xml$/.test(f)).map(f=>attrs(entries[f].toString()).name));
  while(Object.values(p).some(f=>entries[f]||entries[relpath(f)])||usedNames.has('PanthoriumPivot'+serial))p=paths(++serial);
  let workbook=entries['xl/workbook.xml'].toString(),workbookRels=entries['xl/_rels/workbook.xml.rels'].toString();
  const cacheId=Math.max(0,...xmlMatches(workbook,'pivotCache').map(m=>Number(m.node.attributes.cacheId)))+1;
  const sheetId=Math.max(0,...sheets.map(s=>s.id))+1;
  if(!Number.isSafeInteger(cacheId)||cacheId>4294967295||!Number.isSafeInteger(sheetId)||sheetId>4294967295)fail('editor_pivot_workbook_unsupported');
  const ids=new Set(xmlMatches(workbookRels,'Relationship').map(m=>m.node.attributes.Id));
  const rid=prefix=>{let id=prefix+serial;while(ids.has(id))id+='x';ids.add(id);return id;};
  const sheetRid=rid('panthoriumPivotSheet'),cacheRid=rid('panthoriumPivotCache');
  workbook=xmlReplaceSelected(workbook,xmlDirectMatches(workbook,'sheets'),s=>xmlInsertChild(s,`<sheet name="${escape(op.targetSheetName)}" sheetId="${sheetId}" xmlns:r="${REL}" r:id="${sheetRid}"/>`),true);
  const cacheRef=`<pivotCache cacheId="${cacheId}" xmlns:r="${REL}" r:id="${cacheRid}"/>`,existing=xmlDirectMatches(workbook,'pivotCaches');
  if(existing.length)workbook=xmlReplaceSelected(workbook,existing,s=>xmlInsertChild(s,cacheRef),true);
  else{
    const content='<pivotCaches>'+cacheRef+'</pivotCaches>',next=['smartTagPr','smartTagTypes','webPublishing','fileRecoveryPr','webPublishObjects','extLst'].flatMap(t=>xmlDirectMatches(workbook,t)).sort((a,b)=>a.index-b.index)[0];
    workbook=next?workbook.slice(0,next.index)+content+workbook.slice(next.index):xmlInsertChild(workbook,content);
  }
  workbookRels=xmlInsertChild(workbookRels,`<Relationship Id="${sheetRid}" Type="${REL}/worksheet" Target="worksheets/panthoriumPivot${serial}.xml"/><Relationship Id="${cacheRid}" Type="${REL}/pivotCacheDefinition" Target="pivotCache/panthoriumCache${serial}.xml"/>`);
  const built=parts(serial,cacheId,source,op,data),types=[[p.sheet,'worksheet'],[p.pivot,'pivotTable'],[p.cache,'pivotCacheDefinition'],[p.records,'pivotCacheRecords']].map(([file,type])=>`<Override PartName="/${file}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.${type}+xml"/>`).join('');
  const changes={
    'xl/workbook.xml':workbook,'xl/_rels/workbook.xml.rels':workbookRels,'[Content_Types].xml':xmlInsertChild(entries['[Content_Types].xml'].toString(),types),
    [p.cache]:built.cache,[p.records]:built.recordXml,[p.pivot]:built.pivot,[p.sheet]:resultSheet(built.rows),
    [relpath(p.sheet)]:rels([['rId1','pivotTable',`../pivotTables/panthoriumPivot${serial}.xml`]]),
    [relpath(p.pivot)]:rels([['rId1','pivotCacheDefinition',`../pivotCache/panthoriumCache${serial}.xml`]]),
    [relpath(p.cache)]:rels([['rId1','pivotCacheRecords',`panthoriumRecords${serial}.xml`]])
  };
  commit(entries,changes);return true;
}
function commit(entries,changes){
  const buffers=Object.fromEntries(Object.entries(changes).map(([k,v])=>[k,Buffer.from(v)])),combined={...entries,...buffers};
  validateOfficeXmlEntries(combined);
  if(Object.keys(combined).length>2000||Object.entries(combined).reduce((n,[name,body])=>n+body.length+76+2*Buffer.byteLength(name),22)>LIMITS.sourceBytes)fail('editor_pivot_package_too_large');
  for(const [name,bytes]of Object.entries(buffers))entries[name]=bytes;
}
function generated(entries){
  const result=[];
  for(const file of Object.keys(entries)){
    const match=/^xl\/pivotTables\/panthoriumPivot([1-9]\d*)\.xml$/.exec(file);if(!match)continue;
    const xml=entries[file].toString(),a=attrs(xml);if(!a.tag?.startsWith(MARK))continue;
    let meta;try{meta=JSON.parse(a.tag.slice(MARK.length));}catch(_){fail('editor_pivot_metadata_invalid');}
    if(!meta||Object.keys(meta).sort().join(',')!=='aggregation,digest,groupColumn,range,sourceSheetName,targetSheetName,valueColumn'||typeof meta.sourceSheetName!=='string'||meta.sourceSheetName.length>31)fail('editor_pivot_metadata_invalid');
    if(digest(xml.replace(/ tag="[^"]*"/,''))!==meta.digest)fail('editor_pivot_modified_externally');
    const op={type:'insert_pivot',sheet:0,range:meta.range,groupColumn:meta.groupColumn,valueColumn:meta.valueColumn,aggregation:meta.aggregation,targetSheetName:meta.targetSheetName};validateOperation(op);
    const serial=Number(match[1]),cacheId=Number(a.cacheId);verifyLinks(entries,paths(serial),cacheId,meta);
    result.push({serial,cacheId,meta,op});
  }return result;
}
function refresh(entries){
  const pivots=generated(entries);if(!pivots.length)return;
  const sheets=sheetsOf(entries),changes={};
  for(const pivot of pivots){
    const p=paths(pivot.serial),source=sheets.find(s=>s.name===pivot.meta.sourceSheetName),target=sheets.find(s=>s.name===pivot.meta.targetSheetName);
    if(!source||target?.file!==p.sheet||!entries[p.cache]||!entries[p.records])fail('editor_pivot_source_missing');
    const data=dataFor(entries,sheets,source,pivot.op),built=parts(pivot.serial,pivot.cacheId,source,pivot.op,data);
    Object.assign(changes,{[p.cache]:built.cache,[p.records]:built.recordXml,[p.pivot]:built.pivot,[p.sheet]:resultSheet(built.rows,entries[p.sheet].toString())});
  }
  commit(entries,changes);
}
function assertCellEditable(entries,sheetFile,cell){
  const pivots=generated(entries),all=pivotFiles(entries);
  if(all.length!==pivots.length)fail('editor_imported_pivot_edit_unsupported');
  const m=/^xl\/worksheets\/panthoriumPivot([1-9]\d*)\.xml$/.exec(sheetFile);
  if(m&&pivots.some(p=>p.serial===Number(m[1])))fail('editor_pivot_result_readonly');
}
function describe(entries){
  const files=pivotFiles(entries);
  let pivots;try{pivots=generated(entries);}catch(_){return {outputs:[],importedPivotCount:files.length};}
  return {outputs:pivots.map(p=>({file:paths(p.serial).sheet,name:p.op.targetSheetName,sourceSheetName:p.meta.sourceSheetName,range:p.op.range,groupColumn:p.op.groupColumn,valueColumn:p.op.valueColumn,aggregation:p.op.aggregation})),importedPivotCount:files.length-pivots.length};
}
module.exports={validateOperation,apply,refresh,assertCellEditable,describe};
