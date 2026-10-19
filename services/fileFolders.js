'use strict';

// Account-scoped system folders are derived from file metadata. Existing object
// IDs and private storage paths remain stable, including Studio workflow links.
const FOLDERS = Object.freeze([
  ['images', 'รูปภาพ'], ['videos', 'วิดีโอ'], ['documents', 'เอกสาร'],
  ['spreadsheets', 'ตาราง'], ['presentations', 'งานนำเสนอ'], ['audio', 'เสียง'],
  ['print', 'เอกสารสำหรับพิมพ์'], ['archives', 'ไฟล์บีบอัด'],
  ['code', 'โค้ดและข้อมูล'], ['other', 'อื่น ๆ']
].map(([id, name]) => Object.freeze({ id, name })));

function folderFor(file) {
  const name = String(file.name || '').toLowerCase();
  const type = String(file.contentType || '').toLowerCase();
  const ext = name.split('.').pop();
  if (name.endsWith('.print.html')) return 'print';
  if (/^(xlsx?|ods|csv|tsv)$/.test(ext) || /spreadsheet|excel|csv|tab-separated/.test(type)) return 'spreadsheets';
  if (/^(pptx?|odp)$/.test(ext) || /presentation|powerpoint/.test(type)) return 'presentations';
  if (/^(docx?|odt|pdf|rtf|txt|md|html?)$/.test(ext) || /wordprocessing|msword|pdf|rtf/.test(type)) return 'documents';
  if (type.startsWith('image/') || /^(png|jpe?g|webp|gif|svg|avif|heic|bmp|tiff?)$/.test(ext)) return 'images';
  if (type.startsWith('video/') || /^(mp4|webm|mov|mkv|avi|m4v)$/.test(ext)) return 'videos';
  if (type.startsWith('audio/') || /^(mp3|wav|ogg|m4a|aac|flac)$/.test(ext)) return 'audio';
  if (/^(zip|7z|rar|gz|tar|bz2)$/.test(ext) || /zip|compressed|x-tar/.test(type)) return 'archives';
  if (/^(json|xml|ya?ml|sql|js|ts|jsx|tsx|py|css|sh|ipynb)$/.test(ext)) return 'code';
  return 'other';
}

function folderListing(files) {
  const grouped = files.map(file => ({ ...file, folderId: folderFor(file) }));
  const folders = FOLDERS.map(folder => {
    const contents = grouped.filter(file => file.folderId === folder.id);
    return { ...folder, count: contents.length, size: contents.reduce((n, file) => n + file.size, 0) };
  });
  return { files: grouped, folders };
}
module.exports = { FOLDERS, folderFor, folderListing };
