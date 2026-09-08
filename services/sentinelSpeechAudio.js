const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { EdgeTTS } = require("node-edge-tts");

const SENTINEL_MALE_VOICES = Object.freeze({
  "th-TH": "th-TH-NiwatNeural",
  "en-US": "en-US-GuyNeural",
  "ja-JP": "ja-JP-KeitaNeural",
  "ko-KR": "ko-KR-InJoonNeural",
  "ar-SA": "ar-SA-HamedNeural",
  "ru-RU": "ru-RU-DmitryNeural",
  "zh-CN": "zh-CN-YunxiNeural"
});

async function synthesizeSentinelMaleVoice(text, lang) {
  const voice = SENTINEL_MALE_VOICES[lang];
  if (!voice || typeof text !== "string" || !text.trim() || text.length > 180) {
    throw new Error("invalid_speech_request");
  }
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "panthorium-voice-"));
  const audioPath = path.join(workDir, "speech.mp3");
  try {
    const speech = new EdgeTTS({
      voice,
      lang,
      outputFormat: "audio-24khz-48kbitrate-mono-mp3",
      rate: "+10%",
      pitch: "default",
      volume: "default",
      timeout: 20000,
      proxy: process.env.HTTPS_PROXY || process.env.HTTP_PROXY
    });
    await speech.ttsPromise(text.trim(), audioPath);
    const audio = await fs.readFile(audioPath);
    if (!audio.length || audio.length > 1024 * 1024) throw new Error("invalid_speech_audio");
    return { audio, voice };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { SENTINEL_MALE_VOICES, synthesizeSentinelMaleVoice };
