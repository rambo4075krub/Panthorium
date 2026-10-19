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
Staging acceptance exercises real Cloud Storage files and draft APIs using
throwaway Free accounts before production promotion. Pixel-level browser/device
acceptance and full Office conformance are separate checks; do not infer them
from these automated tests.
