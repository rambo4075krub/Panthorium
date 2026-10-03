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
const MAX_SPEECH_CHARACTERS = 6000;
// Edge's websocket SSML frame is limited to 4096 bytes. Keep each provider
// segment below that limit; the browser still receives one continuous MP3.
const MAX_PROVIDER_SEGMENT_BYTES = 3500;

function applySentinelPronunciations(text) {
  return String(text || "").replace(/\bPanthorium\s+OS\b/gi, "แพนทอเรี่ยมโอเอส");
}

function splitSentinelSpeechText(text, maxBytes = MAX_PROVIDER_SEGMENT_BYTES) {
  const source = String(text || "");
  if (!source) return [];
  const result = [];
  let current = "";
  const Segmenter = Intl.Segmenter;
  const graphemes = Segmenter
    ? [...new Segmenter("th", { granularity: "grapheme" }).segment(source)].map(item => item.segment)
    : Array.from(source);
  for (const grapheme of graphemes) {
    if (current && Buffer.byteLength(current + grapheme, "utf8") > maxBytes) {
      result.push(current);
      current = "";
    }
    current += grapheme;
  }
  if (current) result.push(current);
  return result;
}

async function synthesizeSentinelMaleVoice(text, lang) {
  const voice = SENTINEL_MALE_VOICES[lang];
  if (!voice || typeof text !== "string" || !text.trim() || text.length > MAX_SPEECH_CHARACTERS) {
    throw new Error("invalid_speech_request");
  }
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "panthorium-voice-"));
  try {
    const source = applySentinelPronunciations(text.trim());
    const segments = splitSentinelSpeechText(source);
    const audioParts = [];
    for (let index = 0; index < segments.length; index += 1) {
      const audioPath = path.join(workDir, `speech-${index}.mp3`);
      const speech = new EdgeTTS({
        voice,
        // A single Thai system voice is intentional for every language.
        lang: "th-TH",
        outputFormat: "audio-24khz-48kbitrate-mono-mp3",
        rate: "+12%",
        pitch: "default",
        volume: "default",
        timeout: 40000,
        proxy: process.env.HTTPS_PROXY || process.env.HTTP_PROXY
      });
      await speech.ttsPromise(segments[index], audioPath);
      const audio = await fs.readFile(audioPath);
      if (!audio.length || audio.length > 5 * 1024 * 1024) throw new Error("invalid_speech_audio");
      audioParts.push(audio);
    }
    const audio = Buffer.concat(audioParts);
    if (!audio.length || audio.length > 12 * 1024 * 1024) throw new Error("invalid_speech_audio");
    return { audio, voice };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { SENTINEL_MALE_VOICES, MAX_SPEECH_CHARACTERS, applySentinelPronunciations, splitSentinelSpeechText, synthesizeSentinelMaleVoice };
