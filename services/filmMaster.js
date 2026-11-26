'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {sanitizeFilename, MAX_FILE_BYTES} = require('./cloudFilesService');
const {fail} = require('./onlineToolModel');

// Only finished, server-rendered episodes enter this path. They already share H.264/AAC,
// aspect, frame rate and sample rate, so the complete film needs no second video encode.
async function withMaster({media, files, user, parts, title, signal, send, workRoot = media.tempRoot}) {
  const owner = media.requireAccount(user);
  const run = async (gateSignal) => {
    if (media.busy) fail('media_worker_busy', 429);
    media.busy = true;
    let folder;
    try {
      folder = await fs.mkdtemp(path.join(workRoot, 'panthorium-film-'));
      const entries = [];
      let bytes = 0;
      const inputs = new Map();
      for (const part of parts) {
        gateSignal?.throwIfAborted();
        const n = Number(part.size);
        if (!Number.isSafeInteger(n) || n <= 0 || n > MAX_FILE_BYTES || part.contentType !== 'video/mp4')
          fail('invalid_film_source');
        bytes += n;
        inputs.set(part.id, n);
      }
      const disk = await fs.statfs(folder);
      if (
        disk.bavail * disk.bsize <
        bytes + [...inputs.values()].reduce((sum, n) => sum + n, 0) + MAX_FILE_BYTES
      )
        fail('film_export_space', 507);
      const local = new Map();
      for (const [index, part] of parts.entries()) {
        gateSignal?.throwIfAborted();
        let filename = local.get(part.id);
        if (!filename) {
          const source = await files.readOwned(owner, part.id);
          if (source.body.length !== Number(part.size)) fail('invalid_film_source');
          filename = 'part-' + index + '.mp4';
          await fs.writeFile(path.join(folder, filename), source.body, {flag: 'wx', mode: 0o600});
          local.set(part.id, filename);
        }
        entries.push("file '" + filename + "'");
        if (Number.isFinite(part.seconds) && part.seconds > 0)
          entries.push('duration ' + part.seconds.toFixed(6));
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
        {timeoutMs: Math.max(180000, Math.ceil(bytes / (4 * 1024 * 1024)) * 1000), signal: gateSignal}
      );
      const {size} = await fs.stat(output);
      if (!size) fail('invalid_film_source');
      gateSignal?.throwIfAborted();
      await send(output, sanitizeFilename(title).replace(/\.mp4$/i, '') + '.mp4', size);
    } finally {
      if (folder) await fs.rm(folder, {recursive: true, force: true}).catch(() => {});
      media.busy = false;
    }
  };
  return media.mediaGate ? media.mediaGate.run(run, {userId: owner, signal}) : run(signal);
}
async function downloadMaster(options) {
  return withMaster({
    ...options,
    send: async (file, name, size) => {
      if (options.files.entitlements)
        await options.files.entitlements.consume(options.media.requireAccount(options.user), {
          downloadBytes: size
        });
      return options.send(file, name);
    }
  });
}
module.exports = {downloadMaster, withMaster};
