'use strict';
const { existsSync } = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// The notebook already provisions a Thai speech model separately from the chat engine.
const root = process.env.PANTHORIUM_COMMAND_VOICE_ROOT ||
  (process.platform === 'win32' ? path.join(process.env.PANTHORIUM_AI_ROOT || 'D:\\PanthoriumAI', 'voice') : '');
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const model = path.join(root, 'models', 'faster-whisper-small');
const available = () => Boolean(root && existsSync(python) && existsSync(path.join(model, 'model.bin')));
let active = false;
function validAudio(wav) {
  return Buffer.isBuffer(wav) && wav.length >= 3244 && wav.length <= 384044 &&
    wav.toString('ascii', 0, 4) === 'RIFF' && wav.readUInt32LE(4) === wav.length - 8 &&
    wav.toString('ascii', 8, 16) === 'WAVEfmt ' && wav.readUInt32LE(16) === 16 &&
    wav.readUInt16LE(20) === 1 && wav.readUInt16LE(22) === 1 &&
    wav.readUInt32LE(24) === 16000 && wav.readUInt32LE(28) === 32000 &&
    wav.readUInt16LE(32) === 2 && wav.readUInt16LE(34) === 16 &&
    wav.toString('ascii', 36, 40) === 'data' && wav.readUInt32LE(40) === wav.length - 44 && wav.length % 2 === 0;
}
async function transcribe(wav, language, signal, purpose = 'command', hasSuggestion = false) {
  if (!available()) throw Error('speech_unavailable');
  if (active) throw Error('speech_busy');
  if (signal.aborted) throw Error('cancelled');
  active = true;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(python, ['-I', path.join(__dirname, 'command_speech.py'), model, language, purpose, hasSuggestion ? '1' : '0'], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']
      });
      let output = '';
      const stop = () => child.kill();
      const timeout = setTimeout(stop, 35000);
      signal.addEventListener('abort', stop, { once: true });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', part => { output += part; if (output.length > 8192) stop(); });
      child.stdin.on('error', () => {});
      child.on('error', () => reject(Error('speech_unavailable')));
      child.on('close', code => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', stop);
        if (code !== 0 || signal.aborted) return reject(Error(code === 75 ? 'speech_busy' : 'speech_unavailable'));
        try {
          const text = JSON.parse(output);
          if (typeof text !== 'string' || !text.trim()) throw Error();
          resolve(text.trim().slice(0, 1000));
        } catch { reject(Error('no_speech')); }
      });
      child.stdin.end(wav);
    });
  } finally { active = false; }
}
module.exports = { available, validAudio, transcribe };
