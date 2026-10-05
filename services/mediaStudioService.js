const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { MAX_FILE_BYTES, sanitizeFilename } = require('./cloudFilesService');

const MAX_CLIP_SECONDS = 120;
const MAX_TRANSCRIPTION_SECONDS = 180;
const MAX_SRT_BYTES = 100 * 1024;
const VIDEO_TYPES = new Set([
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska',
  'video/mpeg', 'video/ogg', 'video/3gpp'
]);
const EXTENSIONS = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/mpeg': 'mpg',
  'video/ogg': 'ogv',
  'video/3gpp': '3gp'
};

class MediaStudioError extends Error {
  constructor(status, code) {
    super(code);
    this.name = 'MediaStudioError';
    this.status = status;
    this.code = code;
  }
}

function isAccountUser(user) {
  const userId = String(user?.sub || user?.id || '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)
    && !((user?.roles || []).includes('guest'))
    && Array.isArray(user?.permissions) && user.permissions.includes('chat');
}

function isVideoFile(file) {
  return VIDEO_TYPES.has(String(file?.contentType || '').toLowerCase())
    || /\.(mp4|webm|mov|mkv|mpg|mpeg|ogv|3gp)$/i.test(String(file?.name || ''));
}

function parseSeconds(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function secondsFromSrt(value) {
  const match = /^(\d{2,}):(\d{2}):(\d{2}),(\d{3})$/.exec(String(value || '').trim());
  if (!match) return NaN;
  const [, hh, mm, ss, ms] = match;
  if (Number(mm) > 59 || Number(ss) > 59) return NaN;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms) / 1000;
}

function sanitizeCueText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[{}]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split(/\r?\n/)
    .map(line => line.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 4)
    .join('\n');
}

function normalizeSrt(input, clipSeconds) {
  const source = String(input || '').replace(/^\uFEFF/, '').trim();
  if (!source) return '';
  if (Buffer.byteLength(source, 'utf8') > MAX_SRT_BYTES) throw new MediaStudioError(413, 'captions_too_large');
  const blocks = source.split(/\r?\n\s*\r?\n/).filter(Boolean);
  if (blocks.length > 200) throw new MediaStudioError(400, 'too_many_caption_cues');
  const normalized = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map(line => line.trim());
    let timeIndex = lines.findIndex(line => line.includes('-->'));
    if (timeIndex < 0 || timeIndex + 1 >= lines.length) throw new MediaStudioError(400, 'invalid_srt');
    const match = /^(\d{2,}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2,}:\d{2}:\d{2},\d{3})$/.exec(lines[timeIndex]);
    if (!match) throw new MediaStudioError(400, 'invalid_srt');
    const start = secondsFromSrt(match[1]);
    const end = secondsFromSrt(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > clipSeconds + 0.25) {
      throw new MediaStudioError(400, 'caption_time_out_of_range');
    }
    const text = sanitizeCueText(lines.slice(timeIndex + 1).join('\n'));
    if (!text) throw new MediaStudioError(400, 'empty_caption');
    normalized.push(String(normalized.length + 1) + '\n' + match[1] + ' --> ' + match[2] + '\n' + text);
  }
  return normalized.join('\n\n') + '\n';
}

function runProcess(binary, args, { timeoutMs = 120000, maxOutputBytes = 16 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (_) {
      reject(new MediaStudioError(503, 'media_encoder_unavailable'));
      return;
    }
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    const collect = (current, chunk) => {
      if (current.length >= maxOutputBytes) return current;
      return Buffer.concat([current, chunk]).subarray(0, maxOutputBytes);
    };
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', chunk => { stdout = collect(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = collect(stderr, chunk); });
    child.on('error', () => {
      clearTimeout(timer);
      reject(new MediaStudioError(503, 'media_encoder_unavailable'));
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout: stdout.toString('utf8').trim(), stderr: stderr.toString('utf8').trim() });
      const detail = stderr.toString('utf8').slice(-500).toLowerCase();
      const error = new MediaStudioError(422, /stream map|matches no streams|does not contain any stream/.test(detail) ? 'video_audio_track_required' : 'media_processing_failed');
      reject(error);
    });
  });
}

class MediaStudioService {
  constructor({ files, providers, audit, ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg', ffprobe = process.env.FFPROBE_PATH || 'ffprobe', runner = runProcess, tempRoot = os.tmpdir() } = {}) {
    this.files = files;
    this.providers = providers;
    this.audit = audit || null;
    this.ffmpeg = ffmpeg;
    this.ffprobe = ffprobe;
    this.runner = runner;
    this.tempRoot = tempRoot;
    this.busy = false;
  }

  requireAccount(user) {
    if (!isAccountUser(user)) throw new MediaStudioError(403, 'account_required');
    const userId = String(user.sub || '');
    return userId;
  }

  async videoFiles(user) {
    const userId = this.requireAccount(user);
    const result = await this.files.list(userId);
    return { files: (result.files || []).filter(isVideoFile), maxFileBytes: MAX_FILE_BYTES };
  }

  async source(userId, fileId, directory) {
    const file = await this.files.download(userId, String(fileId || ''));
    if (!isVideoFile(file)) throw new MediaStudioError(415, 'video_file_required');
    if (!file.body?.length || file.body.length > MAX_FILE_BYTES) throw new MediaStudioError(413, 'video_file_too_large');
    const contentType = String(file.contentType || '').toLowerCase();
    const extension = EXTENSIONS[contentType] || path.extname(file.name || '').slice(1).toLowerCase() || 'mp4';
    const inputPath = path.join(directory, 'source.' + extension.replace(/[^a-z0-9]/g, '').slice(0, 8));
    await fs.writeFile(inputPath, file.body, { mode: 0o600, flag: 'wx' });
    return { file, inputPath };
  }

  async durationSeconds(inputPath) {
    const { stdout } = await this.runner(this.ffprobe, [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', inputPath
    ], { timeoutMs: 20000, maxOutputBytes: 512 });
    const duration = Number(stdout);
    if (!Number.isFinite(duration) || duration <= 0) throw new MediaStudioError(422, 'invalid_video');
    return duration;
  }

  async transcribe({ user, fileId, language = 'th' } = {}) {
    const userId = this.requireAccount(user);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(fileId || ''))) {
      throw new MediaStudioError(400, 'invalid_file_id');
    }
    if (!['th', 'en'].includes(String(language))) throw new MediaStudioError(400, 'invalid_language');
    if (this.busy) throw new MediaStudioError(429, 'media_worker_busy');
    this.busy = true;
    let directory;
    try {
      directory = await fs.mkdtemp(path.join(this.tempRoot, 'panthorium-media-'));
      const { file, inputPath } = await this.source(userId, fileId, directory);
      const duration = await this.durationSeconds(inputPath);
      if (duration > MAX_TRANSCRIPTION_SECONDS) throw new MediaStudioError(413, 'transcription_clip_too_long');
      const audioPath = path.join(directory, 'speech.ogg');
      await this.runner(this.ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-i', inputPath, '-t', String(MAX_TRANSCRIPTION_SECONDS),
        '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', audioPath
      ], { timeoutMs: 45000 });
      const audio = await fs.readFile(audioPath);
      if (!audio.length || audio.length > 2 * 1024 * 1024) throw new MediaStudioError(413, 'audio_payload_too_large');
      if (typeof this.providers?.transcribeAudio !== 'function') throw new MediaStudioError(503, 'transcription_unavailable');
      const result = await this.providers.transcribeAudio(audio, 'audio/ogg', language === 'th' ? 'th-TH' : 'en-US');
      if (!result?.text) throw new MediaStudioError(422, 'transcription_uncertain');
      this.audit?.record('media.video_transcribed', { userId, fileId, durationSeconds: Math.round(duration), provider: result.provider || null });
      return { ok: true, fileId, text: String(result.text).slice(0, 12000), durationSeconds: Math.round(duration), provider: result.provider || null, model: result.model || null };
    } catch (error) {
      this.audit?.record('media.video_transcription_failed', { userId, fileId, error: error.code || error.message });
      if (error instanceof MediaStudioError) throw error;
      if (error.code === 'transcription_uncertain') throw new MediaStudioError(422, 'transcription_uncertain');
      if (error.code === 'transcription_provider_unavailable') throw new MediaStudioError(503, 'transcription_provider_unavailable');
      throw new MediaStudioError(422, 'media_transcription_failed');
    } finally {
      if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      this.busy = false;
    }
  }

  async render({ user, fileId, startSeconds, endSeconds, captionsSrt = '', aspect = 'original', name = '' } = {}) {
    const userId = this.requireAccount(user);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(fileId || ''))) {
      throw new MediaStudioError(400, 'invalid_file_id');
    }
    const start = parseSeconds(startSeconds);
    const end = parseSeconds(endSeconds);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > MAX_CLIP_SECONDS) {
      throw new MediaStudioError(400, 'invalid_clip_range');
    }
    if (!['original', 'vertical', 'square', 'widescreen'].includes(aspect)) throw new MediaStudioError(400, 'invalid_aspect');
    if (typeof captionsSrt !== 'string') throw new MediaStudioError(400, 'invalid_captions');
    if (typeof name !== 'string' || name.length > 180) throw new MediaStudioError(400, 'invalid_output_name');
    if (this.busy) throw new MediaStudioError(429, 'media_worker_busy');
    this.busy = true;
    let directory;
    try {
      directory = await fs.mkdtemp(path.join(this.tempRoot, 'panthorium-media-'));
      const { file, inputPath } = await this.source(userId, fileId, directory);
      const sourceDuration = await this.durationSeconds(inputPath);
      if (end > sourceDuration + 0.1) throw new MediaStudioError(400, 'clip_range_exceeds_video');
      const clipSeconds = end - start;
      const normalizedSrt = normalizeSrt(captionsSrt, clipSeconds);
      const outputPath = path.join(directory, 'rendered.mp4');
      const args = [
        '-hide_banner', '-loglevel', 'error', '-ss', start.toFixed(3), '-i', inputPath,
        '-t', clipSeconds.toFixed(3), '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn'
      ];
      const filters = [];
      if (aspect === 'vertical') filters.push('scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280');
      if (aspect === 'square') filters.push('scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080');
      if (aspect === 'widescreen') filters.push('scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720');
      let subtitlePath = '';
      if (normalizedSrt) {
        subtitlePath = path.join(directory, 'captions.srt');
        await fs.writeFile(subtitlePath, normalizedSrt, { mode: 0o600, flag: 'wx' });
        filters.push('subtitles=' + subtitlePath);
      }
      if (filters.length) args.push('-vf', filters.join(','));
      args.push(
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4', outputPath
      );
      await this.runner(this.ffmpeg, args, { timeoutMs: 180000 });
      const output = await fs.readFile(outputPath);
      if (!output.length) throw new MediaStudioError(422, 'empty_render');
      if (output.length > MAX_FILE_BYTES) throw new MediaStudioError(413, 'render_too_large');
      const base = sanitizeFilename(name || path.basename(file.name, path.extname(file.name)) + '-clip.mp4');
      const outputName = /\.mp4$/i.test(base) ? base : base + '.mp4';
      const saved = await this.files.upload(userId, outputName, 'video/mp4', output);
      this.audit?.record('media.video_rendered', { userId, sourceFileId: fileId, outputFileId: saved.id, durationSeconds: Math.round(clipSeconds * 100) / 100, captions: Boolean(normalizedSrt), aspect });
      return { ok: true, sourceFileId: fileId, file: saved, durationSeconds: Math.round(clipSeconds * 100) / 100, captionsIncluded: Boolean(normalizedSrt), aspect };
    } catch (error) {
      this.audit?.record('media.video_render_failed', { userId, fileId, error: error.code || error.message });
      throw error instanceof MediaStudioError ? error : new MediaStudioError(422, 'media_render_failed');
    } finally {
      if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      this.busy = false;
    }
  }
}

module.exports = {
  MediaStudioService, MediaStudioError, isAccountUser, isVideoFile, normalizeSrt, secondsFromSrt,
  MAX_CLIP_SECONDS, MAX_TRANSCRIPTION_SECONDS, MAX_SRT_BYTES, VIDEO_TYPES, runProcess
};
