'use strict';

const assert = require('assert');
const fs = require('fs/promises');

async function main() {
  const edgeModuleId = require.resolve('node-edge-tts');
  const speechModuleId = require.resolve('../services/sentinelSpeechAudio');
  let active = 0;
  let maximumActive = 0;
  require.cache[edgeModuleId] = {
    id: edgeModuleId,
    filename: edgeModuleId,
    loaded: true,
    exports: {
      EdgeTTS: class {
        constructor(options) { this.options = options; }
        async ttsPromise(text, outputPath) {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise(resolve => setTimeout(resolve, 20));
          await fs.writeFile(outputPath, Buffer.from(text));
          active -= 1;
        }
      }
    }
  };
  delete require.cache[speechModuleId];
  const { synthesizeSentinelMaleVoice } = require('../services/sentinelSpeechAudio');
  const source = 'ทดสอบเสียง'.repeat(400);
  const result = await synthesizeSentinelMaleVoice(source, 'th-TH');
  assert.equal(result.audio.toString('utf8'), source, 'parallel segments must be reassembled in source order');
  assert(maximumActive > 1 && maximumActive <= 3, 'long TTS should use bounded parallel provider sessions');
  assert.equal(result.voice, 'th-TH-NiwatNeural');
  console.log('sentinel speech audio bounded parallel synthesis ok');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
