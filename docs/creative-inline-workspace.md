# Creative workspace

All five categories now retain their editor in the Creative window. Category navigation and file selection remain compact. AI generation, job history and approvals use a side drawer. Switching tabs preserves active work; changing accounts aborts requests, revokes preview URLs and clears every mounted editor. Closing a window with unsaved work is cancellable.

## Image workspace

The original canvas implementation supports image, text, rectangle, ellipse and paint layers; move, size, rotate, flip, opacity, visibility and stacking; brush, eraser, crop, brightness, contrast and saturation; undo/redo; PNG download and owned-file save. The inspector keeps layers visible separately from scrollable properties. JSON projects retain layers and embedded images and can be downloaded/reopened. Ctrl/⌘+S saves a PNG copy, while Ctrl/⌘+Shift+S downloads the editable project; both commit pending property text. Video uses the same shortcuts for MP4/project saves. Invalid clip inputs stop saving instead of silently exporting a previous value. PNG output is flattened and is not a layered project backup.

Limits: 12 layers, 16 megapixels per imported image, 32 megapixels of decoded source assets, 4096 × 4096 canvas, 30 bounded undo snapshots, 20 MB project file. Imported project data is validated and cannot fetch remote assets. PSD, masks, blend modes, advanced selections and plugins are not implemented.

## Video workspace

An original clip timeline supports import, trim, split at the playhead, reorder/drag, duplicate/remove, per-clip speed and volume, fade to/from black, project SRT captions, portrait/square/landscape export, undo/redo and JSON project save/reopen. Local preview uses the browser's supported codecs and the selected export aspect ratio, with subtitles overlaid and per-clip fades shown. Media bytes come from the authenticated original-file endpoint, allowing browser-decodable MOV/MKV files without depending on the narrower preview endpoint. Project replacement loads into a separate bounded source pool and adopts it only after validation; failed loads preserve the current timeline. Deleting the last clip clears the player. The project references owned source IDs, so reopening still requires those files and the same account.

`POST /api/media/render-timeline` authenticates every source, normalizes clips sequentially, then joins locally encoded segments. FFmpeg arguments and the internal concat manifest are generated from bounded numeric values and trusted temporary filenames. Decoders retain file-only protocols and restricted container formats. Silent audio is generated with a filter graph, compatible with the existing build that disables input devices. Temporary files are removed on success and failure.

Limits: 8 clips, 120 seconds after speed changes, 20 MB per source/output, 60 MB aggregate sources/intermediates, 0.5–2× speed, 720p landscape / 720×1280 portrait / 720×720 square. One heavy media operation per service instance; two encoding threads and one filter thread. A per-account request ID deduplicates exports in flight and for up to 15 minutes in the same process. This cache is not durable across server restarts. There is no independent music track, arbitrary overlays, keyframes, tracking or transition library.

## Native Office workspaces

The existing bounded OOXML engine remains in use. Word-style documents, Excel-style sheets and PowerPoint-style slides share compact ribbon tabs and type-specific tools. Fonts, text highlights/cell fills and cell wrapping round-trip into native files. Owned PNG/JPEG images can be embedded in documents and slides, without external links. New paragraphs, sheets, slide titles and text boxes are editable before the first save. Existing snapshot indexes retain their meaning; appended content receives new indexes. Sheets support bounded rectangular TSV paste with one undo step, literal-range sorting and autosum. Slide presentation mode supports previous/next and keyboard navigation. Paragraphs in each native text box stay grouped, the original slide aspect ratio is fitted to the available space, and presentation overlays isolate native shape stacking from the editor.

Existing formulas, charts, pivots, tables, revisions, header/footer editing and account-scoped draft recovery remain. Saves create a new owned DOCX/XLSX/PPTX and preserve the original. The workspace adopts the saved copy automatically so editing continues immediately; the file picker follows that copy. A direct download first saves pending edits and downloads the owned native file. Pending cell/formula/header input is committed before keyboard save. Manual, pasted and dictated literals preserve leading-zero identifiers and unsafe-integer precision. Word line breaks/tabs and ordinary empty paragraphs remain editable across repeated saves; page breaks and protected semantic structures stay guarded. Text editor revisions bind the model version and file bytes, so operations from an older block-index model cannot edit a different paragraph after an update. Mismatched account drafts stay preserved without automatic overwrite and can be downloaded as JSON for manual recovery. Unsupported imported structures remain protected. The engine does not provide complete Office compatibility: arbitrary selection formatting, full pagination, macros, complete Excel functions, animations, master-layout editing and advanced picture manipulation remain outside its contract.

Limits remain 200 operations / 42 KB per edit, editable sheet range A1:AN1000 (50 rows rendered per page), 32 sheets, 100 slides and 2,000 text blocks. New embedded images are PNG/JPEG, up to 2 MB each / 16 MP, with a 4 MB total media budget and 16 pictures. Media project drafts currently use explicit project downloads; automatic account drafts are for Office files.

## Voice control in the current workspace

Signed-in users with the ordinary `chat` permission can control the five editors. No administrator, owner, local-model access, or `sentinel:command` permission is needed. Microphone access and the existing speech-provider/credit rules still apply. The compact **เสียง** button shows examples and starts the shared microphone; Office voice commands now preserve unsaved manual edits instead of redirecting them to the saved source file.

| Workspace | Example spoken commands |
| --- | --- |
| Image | `เพิ่มข้อความ สวัสดีครับ`, `เลือกเลเยอร์ที่ 1`, `หมุนรูปภาพ 90 องศา`, `ความทึบ 50 เปอร์เซ็นต์`, `สว่างขึ้น` |
| Video | `เลื่อนไป 1 วินาที`, `แบ่งคลิป`, `เลือกคลิปที่สอง`, `ความเร็ว 2 เท่า`, `ระดับเสียง 50 เปอร์เซ็นต์`, `เพิ่มคำบรรยาย สวัสดี`, `สัดส่วนวิดีโอ แนวตั้ง` |
| Document | `เพิ่มย่อหน้า รายละเอียดงาน`, `เลือกย่อหน้าที่ 2`, `เปลี่ยนข้อความที่เลือกเป็น ข้อความใหม่`, `ตัวหนา`, `ขนาดตัวอักษร 18` |
| Spreadsheet | `เลือกเซลล์ เอหนึ่ง`, `เปลี่ยน B2 เป็น 500`, `ใส่สูตร B3 เป็น =SUM(B1:B2)`, `เพิ่มชีต สรุป` |
| Presentation | `เพิ่มสไลด์ สรุปงาน`, `เพิ่มกล่องข้อความ ขั้นตอนถัดไป`, `สไลด์ถัดไป`, `เริ่มนำเสนอ`, `จบนำเสนอ` |

Shared commands include `เปิดเอกสาร`, `เปิดไฟล์ ชื่อเต็ม.docx`, `ตั้งชื่อ งานใหม่`, `ย้อนกลับ`, `ทำซ้ำ`, and `บันทึก`. File names must match a single owned file; duplicate names require selection in the existing file picker. New Office files can be requested with `สร้างเอกสารใหม่`, `สร้างตารางใหม่`, or `สร้างงานนำเสนอใหม่`. Existing unsaved work must be saved before starting a new workspace in that category.

Saving, exporting, downloading a project, and creating a blank file first show a workspace confirmation. Say **ยืนยัน** or **ยกเลิก**, or use its buttons. Approval is tied to the account, active category, exact editor instance, file/revision, draft state and name for two minutes. Switching accounts/tabs, replacing the editor or changing the draft invalidates it. Heavy exports run asynchronously and report that they have started until their actual result arrives. Repeated commands while busy cannot start another export.

The shared bounded parser accepts common Thai politeness variants, Thai digits and common spoken number/cell names; dictated content retains its punctuation, case and polite words. It does not split a transcript into arbitrary commands or execute code/selectors from text. Unknown operations and absent/protected selections report errors. In image crop/paint/move modes, voice selects the tool; drawing and precise drag coordinates still require the canvas. Formula dictation must resolve to a formula supported by the existing engine.

`studio.command` returns a pending browser action through chat and Live voice, and the browser acknowledgement reports the actual UI result. A model cannot confirm its own proposed save: confirmation/cancellation are rejected as tool arguments. Live voice accepts only a final **input** transcript for a pending workspace confirmation, never assistant speech or a partial transcript. The action's Live receipt does not execute it again. Hybrid voice routes recognized commands after its existing authorized transcription step without invoking local chat inference.

## Validation

- `npm run check` and `npm test`
- `node test/office-suite-browser.js`
- `node test/creative-workspace-browser.js`
- `node test/creative-inline-browser.js`
- `node test/creative-editing-workflows-browser.js`
- `node test/creative-voice.js`
- `node test/creative-voice-browser.js`

Voice tests cover ordinary-account API and function dispatch, negation, numeric/cell parsing, final speech-frame confirmation, account/draft changes, and all five real browser editors through native saves and an actual captioned MP4 export. Speech-provider frames and transcribed requests are fixtures; these checks do not claim live human microphone recognition accuracy.

The native suite (`test/creative-inline-native.js`, included in `test:studio`) reads saved native packages, checks new content, fonts, fills, images and source ownership, and runs real FFmpeg exports. It probes output dimensions/duration/audio and samples frames to verify order and speed. Browser tests use the real shared window shell and APIs, cover all five editors in one window, retained edits, save/reopen, mobile layout and account cleanup. Test media is generated synthetically; no customer files are used.

## Design references

Original UI implementation informed by these public interaction patterns; no proprietary application code or assets are included:

- [Photoshop layers panel](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/get-started-layers/work-with-the-layers-panel.html)
- [CapCut desktop editing workflow](https://www.capcut.com/resource/how-to-use-capcut-on-pc)
- [Microsoft Office ribbon](https://support.microsoft.com/en-us/office/foundations-experiences/customize-the-ribbon-in-office)
