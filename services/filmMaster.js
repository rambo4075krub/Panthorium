'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {sanitizeFilename, MAX_FILE_BYTES} = require('./cloudFilesService');
const {fail} = require('./onlineToolModel');

// Only finished, server-rendered episodes enter this path. They already share H.264/AAC,
// aspect, frame rate and sample rate, so the complete film needs no second video encode.
async function downloadMaster({media, files, user, parts, title, signal, send}) {
  const owner = media.requireAccount(user);
  const run = async (gateSignal) => {
    if (media.busy) fail('media_worker_busy', 429);
    media.busy = true;
    let folder;
    try {
      folder = await fs.mkdtemp(path.join(media.tempRoot, 'panthorium-film-'));
      const entries = [];
      let bytes = 0;
      for (const part of parts) {
        gateSignal?.throwIfAborted();
        const n = Number(part.size);
        if (!Number.isSafeInteger(n) || n <= 0 || n > MAX_FILE_BYTES || part.contentType !== 'video/mp4')
          fail('invalid_film_source');
        bytes += n;
      }
      const disk = await fs.statfs(folder);
      if (disk.bavail * disk.bsize < bytes * 2 + MAX_FILE_BYTES) fail('film_export_space', 507);
      for (const [index, part] of parts.entries()) {
        gateSignal?.throwIfAborted();
        const source = await files.readOwned(owner, part.id);
        if (source.body.length !== Number(part.size)) fail('invalid_film_source');
        const filename = 'part-' + index + '.mp4';
        await fs.writeFile(path.join(folder, filename), source.body, {flag: 'wx', mode: 0o600});
        entries.push("file '" + filename + "'");
      }
      const manifest = path.join(folder, 'parts.txt'),
        output = path.join(folder, 'master.mp4');
      await fs.writeFile(manifest, entries.join('\n') + '\n', {flag: 'wx', mode: 0o600});
      await media.runner(
        media.ffmpeg,
        [
          '-hide_banner',
          '-v',
          'error',
          '-max_alloc',
          '67108864',
          '-protocol_whitelist',
          'file',
          '-format_whitelist',
          'concat,mov',
          '-f',
          'concat',
          '-safe',
          '1',
          '-i',
          manifest,
          '-map',
          '0:v:0',
          '-map',
          '0:a:0',
          '-sn',
          '-dn',
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          '-f',
          'mp4',
          output
        ],
        {timeoutMs: 180000, signal: gateSignal}
      );
      const {size} = await fs.stat(output);
      if (!size) fail('invalid_film_source');
      gateSignal?.throwIfAborted();
      // Internal reads billed no download. Only the final, measured export counts as egress.
      if (files.entitlements) await files.entitlements.consume(owner, {downloadBytes: size});
      await send(output, sanitizeFilename(title).replace(/\.mp4$/i, '') + '.mp4');
    } finally {
      if (folder) await fs.rm(folder, {recursive: true, force: true}).catch(() => {});
      media.busy = false;
    }
  };
  return media.mediaGate ? media.mediaGate.run(run, {userId: owner, signal}) : run(signal);
}
module.exports = {downloadMaster};
