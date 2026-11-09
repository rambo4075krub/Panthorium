# Creative workspace

All five categories now retain their editor in the Creative window. Category navigation and file selection remain compact. AI generation, job history and approvals use a side drawer. Switching tabs preserves active work; changing accounts aborts requests, revokes preview URLs and clears every mounted editor. Closing a window with unsaved work is cancellable.

## Image workspace

The original canvas implementation supports image, text, rectangle, ellipse and paint layers; move, size, rotate, flip, opacity, visibility and stacking; brush, eraser, crop, brightness, contrast and saturation; undo/redo; PNG download and owned-file save. The inspector keeps layers visible separately from scrollable properties. JSON projects retain layers and embedded images and can be downloaded/reopened. PNG output is flattened and is not a layered project backup.

Limits: 12 layers, 16 megapixels per imported image, 32 megapixels of decoded source assets, 4096 × 4096 canvas, 30 bounded undo snapshots, 20 MB project file. Imported project data is validated and cannot fetch remote assets. PSD, masks, blend modes, advanced selections and plugins are not implemented.

## Video workspace

An original clip timeline supports import, trim, split at the playhead, reorder/drag, duplicate/remove, per-clip speed and volume, fade to/from black, project SRT captions, portrait/square/landscape export, undo/redo and JSON project save/reopen. Local preview uses the browser's supported codecs. The project references owned source IDs, so reopening still requires those files and the same account.

`POST /api/media/render-timeline` authenticates every source, normalizes clips sequentially, then joins locally encoded segments. FFmpeg arguments and the internal concat manifest are generated from bounded numeric values and trusted temporary filenames. Decoders retain file-only protocols and restricted container formats. Silent audio is generated with a filter graph, compatible with the existing build that disables input devices. Temporary files are removed on success and failure.

Limits: 8 clips, 120 seconds after speed changes, 20 MB per source/output, 60 MB aggregate sources/intermediates, 0.5–2× speed, 720p landscape / 720×1280 portrait / 720×720 square. One heavy media operation per service instance; two encoding threads and one filter thread. A per-account request ID deduplicates exports in flight and for up to 15 minutes in the same process. This cache is not durable across server restarts. There is no independent music track, arbitrary overlays, keyframes, tracking or transition library.

## Native Office workspaces

The existing bounded OOXML engine remains in use. Word-style documents, Excel-style sheets and PowerPoint-style slides share compact ribbon tabs and type-specific tools. Fonts, text highlights/cell fills and cell wrapping round-trip into native files. Owned PNG/JPEG images can be embedded in documents and slides, without external links. New paragraphs, sheets, slide titles and text boxes are editable before the first save. Existing snapshot indexes retain their meaning; appended content receives new indexes. Sheets support bounded rectangular TSV paste with one undo step, literal-range sorting and autosum. Slide presentation mode supports previous/next and keyboard navigation.

Existing formulas, charts, pivots, tables, revisions, header/footer editing and account-scoped draft recovery remain. Saves create a new owned DOCX/XLSX/PPTX and preserve the original. Unsupported imported structures remain protected. The engine does not provide complete Office compatibility: arbitrary selection formatting, full pagination, macros, complete Excel functions, animations, master-layout editing and advanced picture manipulation remain outside its contract.

Limits remain 200 operations / 42 KB per edit, editable sheet range A1:AN1000 (50 rows rendered per page), 32 sheets, 100 slides and 2,000 text blocks. New embedded images are PNG/JPEG, up to 2 MB each / 16 MP, with a 4 MB total media budget and 16 pictures. Media project drafts currently use explicit project downloads; automatic account drafts are for Office files.

## Validation

- `npm run check` and `npm test`
- `node test/office-suite-browser.js`
- `node test/creative-workspace-browser.js`
- `node test/creative-inline-browser.js`

The native suite (`test/creative-inline-native.js`, included in `test:studio`) reads saved native packages, checks new content, fonts, fills, images and source ownership, and runs real FFmpeg exports. It probes output dimensions/duration/audio and samples frames to verify order and speed. Browser tests use the real shared window shell and APIs, cover all five editors in one window, retained edits, save/reopen, mobile layout and account cleanup. Test media is generated synthetically; no customer files are used.

## Design references

Original UI implementation informed by these public interaction patterns; no proprietary application code or assets are included:

- [Photoshop layers panel](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/get-started-layers/work-with-the-layers-panel.html)
- [CapCut desktop editing workflow](https://www.capcut.com/resource/how-to-use-capcut-on-pc)
- [Microsoft Office ribbon](https://support.microsoft.com/en-us/office/foundations-experiences/customize-the-ribbon-in-office)
