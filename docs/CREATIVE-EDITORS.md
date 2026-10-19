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
