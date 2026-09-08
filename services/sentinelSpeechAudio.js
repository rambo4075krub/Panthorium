const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const SENTINEL_MALE_FILTER = [
  "rubberband=pitch=0.50:tempo=1.16:transients=smooth:detector=soft:phase=independent:window=long",
  "highpass=f=45",
  "bass=g=5:f=135:w=0.7",
  "acompressor=threshold=-18dB:ratio=2.2:attack=20:release=180:makeup=1.4"
].join(",");

function transformSentinelMaleVoice(input, { timeoutMs = 12000 } = {}) {
  if (!Buffer.isBuffer(input) || !input.length || input.length > 1024 * 1024) {
    return Promise.reject(new Error("invalid_speech_audio"));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn",
      "-af", SENTINEL_MALE_FILTER,
      "-map_metadata", "-1", "-codec:a", "libmp3lame", "-b:a", "96k", "-f", "mp3", "pipe:1"
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const output = [];
    const errors = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(value);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("speech_transform_timeout"));
    }, timeoutMs);
    child.stdout.on("data", chunk => {
      outputBytes += chunk.length;
      if (outputBytes > 2 * 1024 * 1024) {
        child.kill("SIGKILL");
        finish(new Error("speech_transform_too_large"));
        return;
      }
      output.push(chunk);
    });
    child.stderr.on("data", chunk => { if (errors.length < 8) errors.push(chunk); });
    child.on("error", error => finish(error));
    child.on("close", code => {
      const audio = Buffer.concat(output);
      if (code !== 0 || !audio.length) {
        const detail = Buffer.concat(errors).toString("utf8").slice(0, 240);
        finish(new Error(detail || `speech_transform_failed_${code}`));
        return;
      }
      finish(null, audio);
    });
    child.stdin.on("error", error => finish(error));
    child.stdin.end(input);
  });
}

module.exports = { SENTINEL_MALE_FILTER, transformSentinelMaleVoice };
