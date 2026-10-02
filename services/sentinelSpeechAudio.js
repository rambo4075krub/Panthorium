const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { EdgeTTS } = require("node-edge-tts");

const SENTINEL_MALE_VOICES = Object.freeze({
  "th-TH": "th-TH-NiwatNeural",
  "en-US": "th-TH-NiwatNeural",
  "ja-JP": "th-TH-NiwatNeural",
  "ko-KR": "th-TH-NiwatNeural",
  "ar-SA": "th-TH-NiwatNeural",
  "ru-RU": "th-TH-NiwatNeural",
  "zh-CN": "th-TH-NiwatNeural"
});

function applySentinelPronunciations(text) {
  return String(text || "").replace(/\bPanthorium\s+OS\b/gi, "แพนทอเรี่ยมโอเอส");
}

async function synthesizeSentinelMaleVoice(text, lang) {
  const voice = SENTINEL_MALE_VOICES[lang];
  if (!voice || typeof text !== "string" || !text.trim() || text.length > 900) {
    throw new Error("invalid_speech_request");
  }
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "panthorium-voice-"));
  const audioPath = path.join(workDir, "speech.mp3");
  try {
    const speech = new EdgeTTS({
      voice,
      // The requested language selects content handling only. A single Thai
      // system voice is intentional, including when the text contains English.
      lang: "th-TH",
      outputFormat: "audio-24khz-48kbitrate-mono-mp3",
      // Use the native Thai male voice and a slightly brisk conversational pace.
      rate: "+12%",
      pitch: "default",
      volume: "default",
      timeout: 40000,
      proxy: process.env.HTTPS_PROXY || process.env.HTTP_PROXY
    });
    await speech.ttsPromise(applySentinelPronunciations(text.trim()), audioPath);
    const audio = await fs.readFile(audioPath);
    if (!audio.length || audio.length > 5 * 1024 * 1024) throw new Error("invalid_speech_audio");
    return { audio, voice };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { SENTINEL_MALE_VOICES, applySentinelPronunciations, synthesizeSentinelMaleVoice };
