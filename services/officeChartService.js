'use strict';
// Native, editable single-series column charts. No external workbook targets,
// embedded executables, supplied XML, or stale formula caches are accepted.
const path = require('node:path');
const { OfficeArtifactError, _internals } = require('./officeArtifactService');
const { xmlMatches, xmlDirectMatches, xmlInsertChild, xmlReplaceSelected, validateOfficeXmlEntries } = _internals;
const core = require('../office-suite-core');
const NS = 'http://schemas.openxmlformats.org';
const REL = NS + '/officeDocument/2006/relationships';
const PROVENANCE = '<c:extLst><c:ext uri="{F54C7B6D-92F1-4F45-930E-F435B9EAF1AB}"><pt:source xmlns:pt="urn:panthorium:chart" version="1"/></c:ext></c:extLst>';
const fail = code => { throw new OfficeArtifactError(400, code); };
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[c]));
const decode = value => String(value).replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, s => {
  const named = { '&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&apos;':"'" };
  if (named[s]) return named[s];
  const n = s[2].toLowerCase() === 'x' ? parseInt(s.slice(3,-1),16) : Number(s.slice(2,-1));
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
});
const attr = (s, k) => xmlMatches(s, s.match(/<([\w:]+)/)?.[1] || '')[0]?.node.attributes?.[k] || '';
const textOf = (s, tag) => xmlMatches(s, tag, true).map(m => decode(m[1])).join('');
const col = letters => [...letters].reduce((n,c) => n * 26 + c.charCodeAt(0) - 64, 0);
function rangeOf(value) {
  const m = typeof value === 'string' && /^([A-Z]{1,2})([1-9]\d{0,3}):([A-Z]{1,2})([1-9]\d{0,3})$/.exec(value);
  if (!m || col(m[3]) > 40 || col(m[3]) !== col(m[1]) + 1 || +m[4] > 1000 || +m[4] < +m[2] || +m[4] - +m[2] >= 100) fail('invalid_editor_chart_range');
  return { labelColumn:m[1], valueColumn:m[3], start:+m[2], end:+m[4] };
}
function validateOperation(op) {
  if (op?.type !== 'insert_chart') return false;
  if (Object.keys(op).length !== 4 || !['type','sheet','range','title'].every(k => Object.hasOwn(op,k)) || !Number.isInteger(op.sheet) || op.sheet < 0 || op.sheet > 31) fail('invalid_editor_chart');
  rangeOf(op.range);
  if (typeof op.title !== 'string' || !op.title.trim() || op.title.length > 160 || /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/.test(op.title)) fail('invalid_editor_chart');
  return true;
}
function currentSheets(entries, model) {
  const shared = xmlMatches(entries['xl/sharedStrings.xml']?.toString() || '', 'si', true).map(m => textOf(m[0], 't'));
  return model.sheets.map(sheet => {
    const cells = []; let rowNumber = 0;
    for (const row of xmlMatches(entries[sheet.file].toString(), 'row')) {
      rowNumber = attr(row[0], 'r') ? Number(attr(row[0], 'r')) : rowNumber + 1; let column = 0;
      for (const cell of xmlDirectMatches(row[0], 'c')) {
        const address = attr(cell[0], 'r');
        if (address && !/^[A-Z]{1,3}[1-9]\d*$/.test(address)) fail('editor_office_unsupported');
        column = address ? col(address.match(/^[A-Z]+/)[0]) : column + 1;
        const ref = address || core.column(column) + rowNumber, type = attr(cell[0], 't'), raw = textOf(cell[0], 'v');
        const value = type === 'b' ? raw === '1' : type === 's' ? shared[Number(raw)] ?? '' : type === 'inlineStr' ? textOf(cell[0], 't') : raw && (!type || type==='n') && Number.isFinite(Number(raw)) ? Number(raw) : raw;
        const f = xmlMatches(cell[0], 'f')[0];
        cells.push({cell:ref,value,...(type==='e'?{cellError:raw}:{}),...(f?{formula:true,formulaText:!Object.hasOwn(f.node.attributes,'t')?'='+textOf(cell[0],'f'):null}:{})});
      }
    }
    if (cells.length > 10000) fail('editor_file_too_complex');
    return { name:sheet.name, cells };
  });
}
function apply(entries, kind, op, model) {
  if (!validateOperation(op)) return false;
  if (kind !== 'spreadsheet' || !model.sheets?.[op.sheet]) fail('editor_operation_type_mismatch');
  validateOfficeXmlEntries(entries);
  const sheet = model.sheets[op.sheet], range = rangeOf(op.range);
  let worksheet = entries[sheet.file].toString();
  // Existing drawings may include images, unsupported anchors or charts. Never
  // replace them to make room for a new chart.
  if (xmlMatches(worksheet, 'drawing').length) fail('editor_chart_existing_drawing');
  const values = new Map(core.calculate(currentSheets(entries, model))[op.sheet].cells.map(c => [c.cell,c]));
  const labels = [], numbers = [];
  for (let row = range.start; row <= range.end; row++) {
    const label = values.get(range.labelColumn+row), number = values.get(range.valueColumn+row);
    if (label?.calculationError || number?.calculationError || label?.cellError || number?.cellError) fail('editor_chart_formula_error');
    const v = number?.calculated ?? number?.value;
    if (typeof v !== 'number' || !Number.isFinite(v)) fail('editor_chart_numeric_values_required');
    const labelValue = label?.calculated ?? label?.value ?? '';
    if (String(labelValue).length > 2000) fail('editor_chart_label_too_long');
    labels.push(String(labelValue)); numbers.push(v);
  }
  let serial = 1;
  while (entries[`xl/charts/panthoriumChart${serial}.xml`] || entries[`xl/drawings/panthoriumDrawing${serial}.xml`] || entries[`xl/drawings/_rels/panthoriumDrawing${serial}.xml.rels`]) serial++;
  const chartFile = `xl/charts/panthoriumChart${serial}.xml`, drawingFile = `xl/drawings/panthoriumDrawing${serial}.xml`;
  const sheetRelsFile = path.posix.join(path.posix.dirname(sheet.file), '_rels', path.posix.basename(sheet.file)+'.rels');
  let sheetRels = entries[sheetRelsFile]?.toString() || `<Relationships xmlns="${NS}/package/2006/relationships"/>`;
  const relationshipIds = new Set(xmlMatches(sheetRels,'Relationship').map(m => attr(m[0], 'Id')));
  let rid = 'panthoriumChart' + serial; while (relationshipIds.has(rid)) rid += 'x';
  const quotedSheet = "'" + sheet.name.replace(/'/g, "''") + "'!";
  const formula = column => escape(`${quotedSheet}$${column}$${range.start}:$${column}$${range.end}`);
  const points = values => `<c:ptCount val="${values.length}"/>`+values.map((v,i)=>`<c:pt idx="${i}"><c:v>${escape(v)}</c:v></c:pt>`).join('');
  const chart = `<c:chartSpace xmlns:c="${NS}/drawingml/2006/chart" xmlns:a="${NS}/drawingml/2006/main" xmlns:r="${REL}"><c:date1904 val="0"/><c:lang val="th-TH"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escape(op.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${escape(op.title)}</c:v></c:tx><c:cat><c:strRef><c:f>${formula(range.labelColumn)}</c:f><c:strCache>${points(labels)}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>${formula(range.valueColumn)}</c:f><c:numCache><c:formatCode>General</c:formatCode>${points(numbers)}</c:numCache></c:numRef></c:val></c:ser><c:gapWidth val="150"/><c:axId val="123456"/><c:axId val="123457"/></c:barChart><c:catAx><c:axId val="123456"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="123457"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="123457"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="123456"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart>${PROVENANCE}</c:chartSpace>`;
  const startColumn = col(range.valueColumn)+1;
  const marker = (tag, column, row) => `<xdr:${tag}><xdr:col>${column}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${tag}>`;
  const drawing = `<xdr:wsDr xmlns:xdr="${NS}/drawingml/2006/spreadsheetDrawing" xmlns:a="${NS}/drawingml/2006/main"><xdr:twoCellAnchor>${marker('from',startColumn,0)}${marker('to',startColumn+8,16)}<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Panthorium chart ${serial}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS}/drawingml/2006/chart"><c:chart xmlns:c="${NS}/drawingml/2006/chart" xmlns:r="${REL}" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
  // Local namespace on drawing avoids altering a worksheet's existing prefixes.
  const drawingRef = `<drawing xmlns:r="${REL}" r:id="${rid}"/>`;
  const trailing = ['legacyDrawing','legacyDrawingHF','picture','oleObjects','controls','webPublishItems','tableParts','extLst'].flatMap(tag=>xmlDirectMatches(worksheet,tag)).sort((a,b)=>a.index-b.index)[0];
  worksheet = trailing ? worksheet.slice(0,trailing.index)+drawingRef+worksheet.slice(trailing.index) : xmlInsertChild(worksheet,drawingRef);
  sheetRels = xmlInsertChild(sheetRels, `<Relationship Id="${rid}" Type="${REL}/drawing" Target="${escape(path.posix.relative(path.posix.dirname(sheet.file), drawingFile))}"/>`);
  const drawingRels = `<Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/chart" Target="../charts/panthoriumChart${serial}.xml"/></Relationships>`;
  const types = xmlInsertChild(entries['[Content_Types].xml'].toString(), `<Override PartName="/${chartFile}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/${drawingFile}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
  const changes = { [sheet.file]:worksheet, [sheetRelsFile]:sheetRels, [chartFile]:chart, [drawingFile]:drawing, [`xl/drawings/_rels/panthoriumDrawing${serial}.xml.rels`]:drawingRels, '[Content_Types].xml':types };
  validateOfficeXmlEntries(Object.fromEntries(Object.entries(changes).map(([k,v])=>[k,Buffer.from(v)])));
  for (const [name,value] of Object.entries(changes)) entries[name]=Buffer.from(value);
  return true;
}
// Refresh caches only in charts authored by this editor. Imported chart engines
// remain outside this bounded writer. Gaps replace formula errors/non-numbers;
// never keep a previous numeric result when its source has become invalid.
function refresh(entries, model) {
  const files = Object.keys(entries).filter(name => /^xl\/charts\/panthoriumChart[1-9]\d*\.xml$/.test(name));
  if (!files.length) return;
  const sheets = core.calculate(currentSheets(entries, model));
  const byName = new Map(sheets.map(s=>[s.name,new Map(s.cells.map(c=>[c.cell,c]))]));
  for (const file of files) {
    let xml = entries[file].toString();
    if (!xml.includes(PROVENANCE)) continue;
    for (const [reference,cache,numeric] of [['c:strRef','c:strCache',false],['c:numRef','c:numCache',true]]) {
      xml = xmlReplaceSelected(xml, xmlMatches(xml, reference), ref => {
        const formula = textOf(ref,'c:f');
        const m = /^'((?:[^']|'')+)'!\$([A-Z]{1,2})\$([1-9]\d{0,3}):\$([A-Z]{1,2})\$([1-9]\d{0,3})$/.exec(formula);
        if (!m || m[2]!==m[4] || col(m[2])>40 || +m[5]>1000 || +m[5]<+m[3] || +m[5]-+m[3]>=100) return ref;
        const cells=byName.get(m[1].replace(/''/g,"'")); if(!cells)return ref;
        const points=[];
        for(let row=+m[3];row<=+m[5];row++){
          const cell=cells.get(m[2]+row),value=cell?.calculated??cell?.value;
          if(cell?.calculationError||cell?.cellError||numeric&&(typeof value!=='number'||!Number.isFinite(value)))continue;
          points.push(`<c:pt idx="${row-+m[3]}"><c:v>${escape(value??'')}</c:v></c:pt>`);
        }
        const content=`<${cache}>${numeric?'<c:formatCode>General</c:formatCode>':''}<c:ptCount val="${+m[5]-+m[3]+1}"/>${points.join('')}</${cache}>`;
        const old=xmlDirectMatches(ref,cache);
        return old.length?xmlReplaceSelected(ref,old,content,true):xmlInsertChild(ref,content);
      });
    }
    entries[file]=Buffer.from(xml);
  }
}
module.exports = { validateOperation, apply, refresh };
