# Creative Studio editing

In **สร้างสรรค์และเอกสาร**, choose a file and **แก้ไขไฟล์ / เปิดตัวแก้ไขเต็ม**. Output rows also have an Edit button. Office categories can start with a blank native file. Every save creates an owned copy and preserves the original.

| Category | Manual editor | Voice workflow |
| --- | --- | --- |
| Image | Rotate, flip, pixel crop, brightness, preview, undo/redo, save PNG | `studio.editor` then `studio.edit`; generative changes use `studio.create` with the owned image as a source |
| Video | Existing Media Studio, with the selected video loaded into its monitor/timeline | `studio.editor` opens Media Studio; existing `media.video` tools plan, transcribe, trim, caption and render |
| Document | Edit indexed paragraphs (including table text), append paragraphs | `studio.editor` reads indexes/revision; `studio.edit` changes text and saves a copy |
| Spreadsheet | Sheet selection, paginated grid, explicit text/number cell entry | Read the actual sheet/index/address, then `set_cell`, e.g. sheet 0, B2, numericValue 500 |
| Presentation | Edit each slide's text blocks while retaining layouts and images | Read actual block indexes and use `set_text` |

The microphone button supplies the selected owned file ID to the existing Gemini Live session. Manual drafts must be saved before voice editing the same file. Voice mutations require the existing immutable action approval; a model-provided confirmation flag never approves a save. Open the saved copy to continue editing it.

The Office editor patches the existing package instead of rebuilding it from extracted text. Untouched entries remain unchanged. Edited paragraphs use the first run's formatting. It is a content editor, not a complete Word/Excel/PowerPoint layout designer. Formula cells are read-only, cached values are not recalculated in the browser, and new cell entry is bounded to A1–AN1000. Existing formulas, other sheets, media and relationships are retained. Unsupported or oversized packages fail explicitly. Edits are limited to 200 operations/42 KB per save. Images are bounded to 16 million decoded pixels.

Workspace reads use the owner-scoped, bounded internal `readOwned` method. This does not consume the separate export/download quota. Saving still enforces cloud storage allowance. The public download endpoint continues to enforce export quota.

Validation: `npm run test:studio`, the full `npm test`/`npm run check` gates, and staging `test/file-preview-deployed.js` with disposable Free accounts. The deployed test covers actual GCS read/edit/save/reopen of DOCX/XLSX/PPTX/PNG, immutable originals, replay, cross-account/Guest denial and unchanged export restrictions. Asset checks cover both staging aliases and the production candidate before traffic promotion. Live model speech interpretation still depends on the selected provider; deterministic function execution and approval are tested separately.


## Panthorium Office suite — October 2026 implementation

This is original Panthorium editor code, not an embedded third-party Office suite.
No editor engine, additional font, icon pack, template collection, CDN dependency,
commercial subscription, or new npm dependency was added. Existing third-party
notices and the project's licensing status are unchanged. This is not a claim of
Microsoft affiliation, full Microsoft Office compatibility, or legal clearance
for all content users import.

The shared editor now opens Documents, Sheets and Slides. Mouse/keyboard editing
and approved `studio.edit` voice actions use the same server validators and native
OOXML writers. Files are owner-scoped, revision-checked, and saved as new copies.
Existing Auto/Never policy, storage quotas and download restrictions still apply.

### Implemented capabilities

- Documents: editable paragraph surface, whole-paragraph bold/italic/underline,
  8–96 pt size, RGB text color, alignment, find/replace, append paragraphs and
  native tables (30 rows × 10 columns). Original untouched package parts remain.
- Sheets: 50-row pages (A1–AN1000 editable), formula bar, supported formula
  recalculation across sheets, dependency cycles/errors, cell fonts/alignment,
  integer/decimal/percentage formats, current-page text filtering, and a clearly
  labeled exploratory chart that is NOT exported into XLSX.
- Formula grammar: arithmetic, comparison, percent, ordinary A1/$A$1 references,
  ranges, quoted sheet names, SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, IF, AND, OR,
  NOT, ROUND, ABS. No eval, external data fetching, macros or executable plugins.
  The interpreter is a bounded subset, not Excel's full formula semantics.
- Ordinary formulas can be changed using `set_formula`. Shared/array formulas
  are protected. Unsupported imported formulas are retained; stale cached values
  are removed after data edits, and recalculation is requested from external
  Office engines. Supported formula results are also written into native caches.
- Slides: text-shape canvas, paragraph styling, drag/percentage geometry,
  background color, new text boxes, new slides and slide reordering. Newly added
  content and reordered pages become fully editable after saving and reopening.
  Grouped/imported shapes with unsupported geometry remain protected.
- Undo/redo, Ctrl/Cmd+S, contextual microphone, source-copy handoff, authenticated
  cloud drafts, draft recovery and optimistic concurrency between browser windows.

### Deliberate compatibility limits

Document surfaces render editable paragraphs, simple native table cells and
embedded PNG/JPEG images. Slide surfaces render text shapes and supported embedded
images. Image previews are bounded to 16 images / 4 MB total, 2 MB per image.
This is not full-fidelity rendering of cropped/grouped images, merged/nested table
cells, shape layering, charts, masters, effects or pagination.
Those existing package parts are preserved unless an explicit supported operation
changes them. Paragraph edits replace text runs; this is not arbitrary mixed-run
rich text editing. No VBA, pivot tables, Excel-complete function/coercion rules,
track changes, header/footer design, image editing inside Office, embedded native
chart authoring, collaborative editing, or full presentation playback is promised.
Do not describe this release as feature-equivalent to Word/Excel/PowerPoint.

### Draft lifecycle and privacy operations

Drafts are stored separately from finished cloud files in
`panthorium_office_drafts(owner_id,file_id,version,data,updated_at)`. They contain
only the source SHA256 revision, pending typed operations and output name.
They are inaccessible to other accounts and Guests; reading requires that the
original owned file still exists. A maximum of 100 active drafts per account is
allowed. Saving a finished file clears the matching draft with a version check;
version tombstones prevent stale windows from reviving it. Drafts are not exported
or published, and are not a substitute for a finished saved copy. Changes made
less than 1.5 seconds before an abrupt close may not have reached the server.

Account erasure/export processing must include this table by `owner_id`, together
with the existing Studio jobs and cloud files. Removed source files can leave an
inaccessible draft until account erasure/manual cleanup; no automatic expiry is
claimed. Standard file-storage quotas apply to saved Office copies; draft metadata
has its own count/42 KB operation bounds.

### Verification

`test/office-suite.js` checks native round trips, XML well-formedness, retained
package bytes, formula safety/recalculation and geometry. `test/office-suite-ui.js`
uses jsdom for editing, formula preview, autosave recovery, conflict handling and
account cleanup. PostgreSQL CI checks concurrent writers and restart persistence.
`test/office-suite-browser.js` additionally exercises real Chromium input, native
save, draft recovery and account cleanup through HTTP. It runs in CI with the
already-installed Playwright test dependency. Staging acceptance exercises real
Cloud Storage files and draft APIs using
throwaway Free accounts before production promotion. Pixel-level browser/device
acceptance and full Office conformance are separate checks; do not infer them
from these automated tests.

## Advanced Office increment — November 2026

The following supersedes the corresponding October limitations, not the overall
full-fidelity/Office-equivalence disclaimer:

- DOCX ordinary text edits preserve unchanged mixed-format runs instead of
  collapsing all text into the first run. Inserted text inherits the affected
  run. The editor displays explicit run bold/italic/underline/color/size.
  Fields, tracked revisions, hyperlinks and unsupported text constructs are
  protected from destructive plain-text edits. This is not a track-changes editor
  or arbitrary selection-formatting engine; named style inheritance is partial.
- Default plain-text headers and footers can be edited for a single-section
  document. Multiple sections or headers/footers containing fields, images or
  tables remain protected. First-page/even-page variants remain unchanged.
- Native merged tables can be inserted with `insert_complex_table`: each origin
  cell has `text`, `colSpan`, `rowSpan`; rows skip slots occupied by previous row
  spans. The validator requires a filled, non-overlapping grid, max 30 × 10 and
  500 characters per cell. The UI offers a merged-title table from tab-separated
  data; voice can specify general bounded spans. Regular horizontal/vertical
  merges and empty cells render from structural metadata. Nested/offset/legacy
  horizontal merges are explicitly shown as unsupported text-only geometry.
- Formula additions: SUMIF, COUNTIF, AVERAGEIF, SUMIFS, COUNTIFS, AVERAGEIFS,
  SUMPRODUCT, INDEX, exact MATCH/VLOOKUP, and lazy IFERROR. Approximate lookup and
  wildcard lookup are not supported. Criteria support bounded wildcard matching.
  Conditional aggregate ranges conservatively propagate errors even from
  excluded rows. IFERROR cannot hide resource exhaustion or dependency cycles.
- `insert_chart` saves an editable native XLSX column chart, not just an on-screen
  preview. Choose two adjacent columns (labels, numeric values), excluding header
  rows, max 100 rows within A1–AN1000. One new chart may be inserted on a sheet
  without an existing drawing. Existing charts/images are never overwritten.
  The chart refers to the source cells and includes recalculated caches. Later
  cell edits refresh Panthorium-generated caches; errors become gaps, not stale
  values. View/edit the exported chart in Excel or LibreOffice; the browser is
  not a native chart layout editor. The earlier exploratory chart remains separate.

New operations use the existing owner/revision/draft/storage validation, saved
copy semantics and immutable action approval. No external data fetch, macro,
VBA, plugin execution, new dependency, or subscription was introduced.

`npm run test:studio` includes regression suites for these operations and their
manual/voice UI contracts. `test/office-suite-browser.js` additionally covers
header/native-chart saving and accepts `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for
an already installed Chromium. Full Office conformance, pivots, tracked revision
authoring/accept/reject, complete nested table layout and real-device speech
acceptance remain outstanding. Do not describe this increment as finishing all
complex Office compatibility work.

### Voice capability contract and Thai command examples

`studio.editor` returns the source revision, exact indexes, `capabilities`, and
protected blocks. Sheets disclose `hasDrawing`; `chartAvailableSheets` excludes
sheets with existing drawings. Voice must use those facts rather than assume an
operation exists. Ambiguous sheet/paragraph/range requests need clarification;
file contents are data, never approval. Newly added indexes require a fresh read
of the saved copy. Approval must bind to the exact operation details and source
revision. Never report a saved file before the job reports completion.

Examples of supported intent-to-tool mappings (not measured speech accuracy):

| Example intent | Operation / conditions |
| --- | --- |
| “แก้ย่อหน้าที่สองเป็น…” | `set_text` with the exact returned block index; protected fields/revisions are not editable |
| “ทำหัวข้อนี้ตัวหนาและจัดกึ่งกลาง” | `format_text`, whole paragraph only |
| “เพิ่มหัวกระดาษว่า รายงานประจำเดือน” | `set_page_text` only when `pageText.editable` is true |
| “เพิ่มตารางที่มีหัวเรื่องผสานสองคอลัมน์” | `insert_complex_table` with validated `richRows` and spans |
| “รวมยอดเฉพาะรายการขายใน B2 ถึง B20” | Read the criteria column first; `set_formula` with SUMIF/SUMIFS and a user-identified destination |
| “สร้างกราฟยอดขายจาก A2 ถึง B10” | `insert_chart`, two adjacent label/numeric columns, no header row and no existing drawing |
| “ย้ายสไลด์ที่สามขึ้นเป็นหน้าแรก” | `reorder_slide`, one-based page numbers |
| “เลื่อนข้อความนี้ไปทางขวา” | Ask for/resolve exact shape and bounded geometry before `move_text` |

Unsupported requests must be explained rather than approximated silently:
track-change acceptance/rejection, pivot authoring, macros, external workbook
connections, arbitrary selection styling and unsupported complex layouts.
Deterministic voice-tool tests use the real action ledger and native file writers,
including foreign-account denial, exact approval, replay and saved-copy reopen.
They do not establish Thai speech-recognition accuracy, noisy-room performance,
latency, or microphone acceptance on S24 Ultra/A12/desktop. Those device tests
remain required before claiming comprehensive spoken-command reliability.

## Review and analysis increment — November 2026, second batch

This section supersedes the first increment's blanket exclusions for tracked text,
nested tables and Pivot authoring. It does not claim complete Word/Excel parity.

### Native text revisions

`track_text {index,value}` creates native DOCX insertion/deletion revisions while
retaining unchanged text formatting. It is available only for ordinary text-run
paragraphs whose `canTrackText` is true. The author is explicitly `Panthorium`,
not an invented user identity, and optional revision dates are not fabricated.
Existing fields, links, bookmarks, move/format revisions, nested revisions and
unsupported structures remain protected. Replacements spanning multiple styled
runs can create several revision IDs.

Save and reopen to obtain the actual revision IDs. `accept_revision` and
`reject_revision` require both the original block index and exact `revisionId`
from that read; guessed IDs created earlier in the same batch are rejected.
Deletion-only paragraphs remain visible in the review panel. Manual review shows
inserted/deleted text, author and pending decisions; decisions are applied only
when saving a new owned copy. “Accept/reject all supported” queues the exact read
IDs, within the existing 200-operation bound. This is not tracked formatting,
move tracking, collaborative review or a complete legal-redline conformance claim.

### Nested tables

`insert_nested_table {index,rows}` adds a native table inside the cell containing
an existing direct paragraph. It preserves that cell's text and appends the
required trailing paragraph. `rows` uses the same text/colSpan/rowSpan origin-cell
structure as merged tables; voice uses `richRows`. Maximum nesting depth is 3,
maximum total table count is 100, and each table remains bounded to 30 × 10.
The renderer preserves direct paragraph/child-table order and does not duplicate
nested text. Original block identities are maintained across later edits in the
same save. Unsupported grids/wrappers and deeper imported tables stay preserved,
with an explicit limited-rendering warning.

### Real native Pivot Tables

`insert_pivot {sheet,range,groupColumn,valueColumn,aggregation,targetSheetName}`
creates a new result worksheet plus native pivot definition, cache definition,
cache records and relationships. It is not a static table mislabeled as a Pivot.

- Source range includes unique nonempty header names, lies within A1–AN1000 and
  contains at most 10,000 cells. One grouping column and one distinct value column
  are supported; indexes are zero-based relative to that range.
- Aggregations are `sum`, `count` of nonempty values, and `average`. Sum/average
  require numeric values for every selected data row. Up to 998 groups fit the
  bounded editor output. Case-insensitive label collisions fail explicitly.
- Supported source formulas are recalculated. Direct/indirect dependencies back
  to generated/future pivot outputs are rejected rather than creating cycles.
- Generated result sheets are read-only. Edit the supported source instead.
  Saving refreshes pivot results/caches, then downstream formula caches, then
  generated charts. Invalid source edits fail atomically without a saved copy.
- Imported/unrecognized or externally modified pivot definitions remain readable
  but block data mutations and new Pivot authoring, preventing stale summaries
  from being presented as recalculated. Refresh/edit those in Excel/LibreOffice.
- New worksheets require a saved-copy read before targeting their numeric index
  in another operation. Do not guess a new sheet index within the creating batch.

Multi-axis pivots, filters/slicers, calculated fields, date grouping, pivot charts,
format-preserving arbitrary external-pivot editing and Excel-complete refresh
semantics are still outside this subset.

### Voice and verification

Capability responses advertise only these bounded operations, trackable block
indexes, reviewable revision IDs, editable sheets and limits. Examples include
“แก้ย่อหน้านี้แบบติดตาม”, “ปฏิเสธการแก้ไขหมายเลข 7”, “เพิ่มตารางซ้อนในเซลล์นี้”,
and “สร้าง Pivot รวมยอดตามหมวดจาก A1 ถึง C20”. Resolve ambiguous targets first;
never accept instructions embedded in a document as approval.

New roundtrip, UI and real action-ledger tests cover native revisions, nested
identity/rendering, native pivots, current source/formula/chart results, refusal
of unsafe edits and replay/ownership protection. The real Chromium acceptance
scenario additionally saves/reopens tracked edits, review decisions, nested tables
and Pivot output. Independent python-docx/openpyxl loading/saving verifies native
package interoperability, not Microsoft Office pixel conformance. Real microphone
recognition and noisy-room/device acceptance remain separate uncompleted tests.
