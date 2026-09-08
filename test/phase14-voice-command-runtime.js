const assert = require('assert');
const fs = require('fs');

const server = fs.readFileSync('server.js', 'utf8');
const pkg = fs.readFileSync('package.json', 'utf8');
const voice = fs.readFileSync('voice-ui.js', 'utf8');

assert(pkg.includes('14.4.0-voice-command-runtime'), 'package version must identify Phase 14.4 voice command runtime');
assert(pkg.includes('node --check voice-ui.js'), 'check script must validate voice-ui.js');
assert(pkg.includes('test/phase14-voice-command-runtime.js'), 'test script must include voice command runtime coverage');

assert(server.includes('voice-ui.js'), 'server shell must load voice-ui.js');
assert(server.includes('phase14-voice-command-v1'), 'shell cache version must be bumped for voice command runtime');
assert(server.includes('Voice Command Runtime'), 'server boot log should mention voice command runtime');

assert(voice.includes("const THAI_LOCALE = 'th-TH'"), 'voice runtime must default to Thai locale');
assert(voice.includes("FALLBACK_LOCALES = [THAI_LOCALE, 'th', 'en-US']"), 'voice runtime must include language fallback chain');
assert(voice.includes('SpeechSynthesisUtterance'), 'voice runtime must use browser TTS');
assert(voice.includes('speechSynthesis'), 'voice runtime must call speechSynthesis');
assert(voice.includes('SpeechRecognition') && voice.includes('webkitSpeechRecognition'), 'voice runtime must support speech recognition fallbacks');
assert(voice.includes('PanthoriumVoiceCommands'), 'voice runtime must expose PanthoriumVoiceCommands API');
assert(voice.includes('PanthoriumVoice = window.PanthoriumVoiceCommands'), 'voice runtime must preserve PanthoriumVoice compatibility');
assert(voice.includes('withoutChat: true'), 'voice command path must operate without opening chat');
assert(voice.includes('window.PanthoriumAIStream?.call'), 'voice commands must send prompts to the Sentinel Core stream path');
assert(voice.includes('typeof window.callAI === \'function\''), 'voice commands must fall back to callAI');
assert(voice.includes('panthorium:voice-command-${type}'), 'voice runtime must emit namespaced voice command events');
assert(voice.includes("emit('user-start'") && voice.includes("emit('user-result'"), 'voice runtime must emit user speech events');
assert(voice.includes("emit('start'") && voice.includes("emit('boundary'") && voice.includes("emit('end'"), 'voice runtime must emit TTS lifecycle events');
assert(voice.includes('language-not-supported'), 'voice runtime must handle unsupported language errors');
assert(voice.includes('nextLocale'), 'voice runtime must try fallback locales');
assert(voice.includes('ฟังต่อเนื่องหลังปลดล็อกไมค์'), 'voice runtime must include hands-free listening control');
assert(voice.includes('พูดสั่ง Sentinel ได้โดยไม่ต้องเปิดแชท'), 'voice runtime UI must clearly state no chat window is required');
assert(voice.includes('หยุดพูด') && voice.includes('หยุดฟัง'), 'voice runtime must support direct voice control commands');
assert(voice.includes('เปิด Governance') && voice.includes('เปิด Dual AI') && voice.includes('เปิด Training Lab'), 'voice runtime must support admin app voice commands');
assert(!voice.includes('new MutationObserver'), 'voice runtime must avoid whole-document MutationObserver loops');

console.log('phase14 voice command runtime ok');
