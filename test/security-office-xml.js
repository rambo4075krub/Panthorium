"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomUUID, createHash } = require("node:crypto");
const { extractOfficeText, LIMITS, _internals: core } = require("../services/officeArtifactService");
const { StudioEditorService, officeModel, patchOffice } = require("../services/studioEditorService");
const suite = require("../services/officeSuiteService");
const { CloudFilesService } = require("../services/cloudFilesService");
const { SocialService } = require("../services/socialService");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const rejected = error => ["invalid_office_source", "office_source_too_large"].includes(error.code);

async function nestedTextBoxes() {
  const inner = '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:i w:val="1"/><w:sz w:val="36"/></w:rPr><w:t>Inner</w:t></w:r></w:p>';
  const source = '<w:document><w:body><w:p><w:r><w:t>Outer</w:t><w:drawing><w:txbxContent>' + inner + '</w:txbxContent></w:drawing></w:r></w:p><w:p/><w:p><w:r><w:t>After</w:t></w:r></w:p></w:body></w:document>';
  const makeEntries = () => ({ 'word/document.xml': Buffer.from(source) });
  const expected = ['Outer', 'Inner', 'After'];
  const original = officeModel(makeEntries(), 'document');
  assert.deepEqual(original.blocks.map(block => block.text), expected, 'nested text belongs only to its nearest paragraph');
  assert.deepEqual(original.blocks.map(block => block.ordinal), [0, 1, 2], 'empty self-closing paragraphs do not shift editable ordinals');
  assert.deepEqual(original.blocks.map(block => block.style.italic), [false, true, false], 'inner formatting does not leak into its containing paragraph');
  assert.equal(extractOfficeText(core.zip(makeEntries())), 'Outer\nInner\nAfter\n', 'preview supports valid nested textboxes in document order');

  for (const index of [0, 1, 2]) {
    for (const type of ['set_text', 'format_text']) {
      const selected = core.xmlMatches(source, 'w:p', true)[index];
      const operation = type === 'set_text' ? { type, index, value: 'Changed ' + expected[index] } : { type, index, style: { bold: true, align: 'right' } };
      const entries = patchOffice(makeEntries(), 'document', [operation]);
      const changed = entries['word/document.xml'].toString();
      assert.ok(changed.startsWith(source.slice(0, selected.index)), `${type} ${index}: preceding XML must remain unchanged`);
      assert.ok(changed.endsWith(source.slice(selected.node.end)), `${type} ${index}: following XML must remain unchanged`);
      if (index === 0) assert.ok(changed.includes(inner), `${type}: changing Outer must preserve the nested Inner paragraph byte-for-byte`);
      const blocks = officeModel(entries, 'document').blocks;
      assert.deepEqual(blocks.map(block => block.text), expected.map((text, position) => type === 'set_text' && position === index ? 'Changed ' + text : text));
      if (type === 'format_text') {
        assert.deepEqual(blocks.map(block => block.style.bold), expected.map((_, position) => position === index), 'only the selected logical paragraph is formatted');
        assert.equal(blocks[index].style.align, 'right');
      }
    }
  }

  // The public editor model omits internal ordinals. Its block indexes must
  // still address the same nested paragraphs throughout one batch of edits.
  const user = { sub: randomUUID() }, body = core.zip(makeEntries());
  const file = { id: randomUUID(), name: 'textboxes.docx', contentType: 'application/octet-stream', body };
  let saved;
  const editor = new StudioEditorService({ files: { readOwned: async () => file, upload: async (_owner, name, contentType, bytes) => { saved = bytes; return { id: randomUUID(), name, contentType }; } } });
  const model = await editor.read(user, file.id);
  assert.deepEqual(model.blocks.map(block => block.text), expected);
  await editor.apply({ user, pluginId: 'document', input: { edit: { fileId: file.id, revision: model.revision, operations: [
    { type: 'set_text', index: 0, value: '' },
    { type: 'format_text', index: 1, style: { bold: true } },
    { type: 'set_text', index: 1, value: 'Edited Inner' },
    { type: 'set_text', index: 2, value: 'Edited After' }
  ] } } });
  const final = officeModel(core.unzip(saved), 'document');
  assert.deepEqual(final.blocks.map(block => block.text), ['Edited Inner', 'Edited After']);
  assert.deepEqual(final.blocks.map(block => block.style.bold), [true, false]);
  assert.equal(extractOfficeText(saved), '\nEdited Inner\nEdited After\n');
}

async function boundedCases() {
  const user = { sub: randomUUID(), roles: ["user"] };
  const cases = [
    ["document", "docx", "word/document.xml", "w:p"],
    ["document", "docx", "word/document.xml", "w:t"],
    ["document", "docx", "word/document.xml", "w:tbl"],
    ["presentation", "pptx", "ppt/slides/slide1.xml", "a:p"],
    ["presentation", "pptx", "ppt/slides/slide1.xml", "a:t"],
    ["spreadsheet", "xlsx", "xl/sharedStrings.xml", "si"],
    ["spreadsheet", "xlsx", "xl/worksheets/sheet1.xml", "row"],
    ["spreadsheet", "xlsx", "xl/worksheets/sheet1.xml", "c"],
    ["spreadsheet", "xlsx", "xl/worksheets/sheet1.xml", "t"],
    ["spreadsheet", "xlsx", "xl/worksheets/sheet1.xml", "v"]
  ];
  for (const [kind, extension, filename, tag] of cases) {
    const entries = { [filename]: Buffer.from("<root>" + `<${tag}>`.repeat(80000) + "</root>") };
    const body = core.zip(entries);
    const file = { id: randomUUID(), name: `invalid.${extension}`, contentType: "application/octet-stream", size: body.length, body };
    assert.throws(() => extractOfficeText(body), rejected, `${tag}: text extraction`);
    const files = new CloudFilesService({ bucket: "office-security-fixture" });
    files.findObject = async () => file;
    files.request = async () => body;
    await assert.rejects(() => files.preview(user.sub, file.id), { code: "file_preview_invalid_office" });
    const social = new SocialService({ files });
    social.requireRecord = async () => ({ ownerId: user.sub, kind: "post", files: [{ id: file.id }] });
    await assert.rejects(() => social.media({ user, recordId: "authorized-fixture", fileId: file.id }), { code: "file_preview_invalid_office" });
    const editor = new StudioEditorService({ files });
    await assert.rejects(() => editor.read(user, file.id), rejected, `${tag}: editor read`);
    await assert.rejects(() => editor.apply({ user, pluginId: kind, input: { edit: { fileId: file.id, revision: hash(body), operations: [{ type: "format_text", index: 0, style: { bold: true } }] } } }), rejected, `${tag}: editor apply`);
    assert.throws(() => suite.enrich(entries, kind, { blocks: [], sheets: [], slideFiles: [] }), rejected, `${tag}: suite enrichment`);
  }

  // Valid XML comments/CDATA and similarly named elements must not be treated
  // as real paragraphs by any of the editor's extraction/replacement paths.
  const fake = "<w:p>".repeat(80000);
  const xml = "<w:document><!--" + fake + "--><w:p><w:r><w:t>Visible</w:t></w:r></w:p><other><![CDATA[" + fake + "]]></other>" + "<w:p-alias></w:p-alias>".repeat(10000) + "</w:document>";
  const body = core.zip({ "word/document.xml": xml });
  assert.equal(extractOfficeText(body), "Visible\n");
  assert.equal(core.xmlMatches(xml, "w:p", true).length, 1);
  const file = { id: randomUUID(), name: "commented.docx", contentType: "application/octet-stream", body };
  let saved;
  const editor = new StudioEditorService({ files: { readOwned: async () => file, upload: async (_owner, name, contentType, bytes) => { saved = bytes; return { id: randomUUID(), name, contentType }; } } });
  const model = await editor.read(user, file.id);
  assert.equal(model.blocks.length, 1);
  assert.equal(model.blocks[0].text, "Visible");
  await editor.apply({ user, pluginId: "document", input: { edit: { fileId: file.id, revision: model.revision, operations: [{ type: "format_text", index: 0, style: { bold: true } }, { type: "set_text", index: 0, value: "Changed" }] } } });
  assert.equal(extractOfficeText(saved), "Changed\n");
  assert.ok(core.unzip(saved)["word/document.xml"].toString().includes("<!--" + fake + "-->"), "unrelated comment is preserved byte-for-byte");
  const spaces = " ".repeat(400000);
  const formatted = suite.formatParagraph('<a:p><a:pPr>' + spaces + '</a:pPr><a:r><a:rPr>' + spaces + '</a:rPr><a:t>Text</a:t></a:r></a:p>', { bold: true, align: 'center' }, 'a');
  assert.ok(formatted.includes('<a:pPr algn="ctr">'));
  assert.ok(formatted.includes('<a:rPr b="1">'));
  const closingDecoys = '<w:p><w:pPr><!--' + '</decoy'.repeat(40000) + '--></w:pPr><w:r><w:t>Text</w:t></w:r></w:p>';
  assert.ok(suite.formatParagraph(closingDecoys, { align: 'center' }, 'w').includes('<w:jc w:val="center"/>'));
  assert.equal(core.xmlWithoutAttributes('<root keep="quoted > value" drop="a"><child drop="untouched"/></root>', ['drop']), '<root keep="quoted > value"><child drop="untouched"/></root>');
  console.log("Bounded XML adversarial cases passed across text/cloud/social previews and editor read/apply/suite");
}

async function main() {
  if (process.argv.includes("--bounded-cases")) { await boundedCases(); return; }
  await nestedTextBoxes();
  // A hard subprocess deadline catches event-loop blocking. The old parser
  // takes many seconds for the first case alone; no unsafe fixture runs live.
  const output = execFileSync(process.execPath, [__filename, "--bounded-cases"], { timeout: 8000, encoding: "utf8" });
  assert.match(output, /Bounded XML adversarial cases passed/);

  const text = "ไทย & < > 😀";
  const doc = core.zip({ "word/document.xml": '<w:document><w:p a="quoted > value"><w:r><w:t>ไทย &amp; &lt; &gt; &#x1F600;</w:t></w:r></w:p></w:document>' });
  assert.equal(extractOfficeText(doc), text + "\n");
  const sheet = core.zip({
    "xl/sharedStrings.xml": '<sst><si><r><t>A &amp; </t></r><r><t>B</t></r></si></sst>',
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row><c t="s"><v>0</v></c><c><v>42</v></c><c t="inlineStr"><is><t>Thai ไทย</t></is></c></row></sheetData></worksheet>'
  });
  assert.equal(extractOfficeText(sheet), "A & B\t42\tThai ไทย\n");
  const deck = core.zip({ "ppt/slides/slide10.xml": '<p:sld><a:p><a:r><a:t>Ten</a:t></a:r></a:p></p:sld>', "ppt/slides/slide2.xml": '<p:sld><a:p><a:r><a:t>Two</a:t></a:r></a:p></p:sld>' });
  assert.equal(extractOfficeText(deck), "Two\nTen\n");
  const long = core.zip({ "word/document.xml": "<w:document><w:p><w:r><w:t>" + "x".repeat(LIMITS.sourceChars * 3) + "</w:t></w:r></w:p></w:document>" });
  assert.equal(extractOfficeText(long).length, LIMITS.sourceChars, "one huge paragraph cannot bypass output bounds");
  for (const source of [
    "<root>" + "<x>".repeat(LIMITS.previewXmlDepth + 1) + "</x>".repeat(LIMITS.previewXmlDepth + 1) + "</root>",
    "<root>" + "<x/>".repeat(LIMITS.previewXmlNodes + 1) + "</root>",
    '<root a="' + "x".repeat(LIMITS.previewXmlTagChars + 1) + '"/>',
    "<root><w:p></root>", "<root><w:t>unterminated", "<root><!--unterminated</root>",
    '<!DOCTYPE root [<!ENTITY secret SYSTEM "file:///etc/passwd">]><root>&secret;</root>'
  ]) assert.throws(() => extractOfficeText(core.zip({ "word/document.xml": source })), rejected);
  const oversized = { "word/document.xml": "<root>" + "x".repeat(LIMITS.previewXmlBytes / 2) + "</root>", "word/styles.xml": "<root>" + "y".repeat(LIMITS.previewXmlBytes / 2) + "</root>" };
  assert.throws(() => extractOfficeText(core.zip(oversized)), { code: "office_source_too_large" }, "total XML size includes auxiliary parts");
  for (let index = 0; index < 10; index++) {
    const source = '<root fixture="' + index + '">' + '<x/>'.repeat(20000) + '</root>';
    assert.equal(core.xmlMatches(source, 'x').length, 20000);
    assert.ok(core.xmlCacheStats().nodes <= LIMITS.previewXmlNodes, 'many small XML files must share one node retention budget');
  }
  assert.equal(core.xmlMatches('<root fixture="0">' + '<x/>'.repeat(20000) + '</root>', 'x').length, 20000, 'an evicted source can be parsed again correctly');
  console.log("Office XML security passed: bounded runtime/input/output, strict nesting, exact tags, inert comments/CDATA, DOCX/XLSX/PPTX text preservation and editor roundtrip");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
