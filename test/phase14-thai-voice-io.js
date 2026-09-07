const assert = require('assert');
const fs = require('fs');

const server = fs.readFileSync('server.js', 'utf8');
const pkg = fs.readFileSync('package.json', 'utf8');
const voice = fs.readFileSync('voice-ui.js', 'utf8');

assert(server.includes('voice-ui.js'), 'server shell must load voice-ui.js');
assert(server.includes('phase14-voice-v1'), 'shell cache version must be bumped for voice layer');
assert(server.includes('Thai Voice I/O'), 'server boot log should mention Thai Voice I/O');

assert(pkg.includes('14.2.0-thai-voice-io'), 'package version must be Phase 14.2');
assert(pkg.includes('node --check voice-ui.js'), 'check script must validate voice-ui.js');
assert(pkg.includes('test/phase14-thai-voice-io.js'), 'test script must include Phase 14.2 coverage');

assert(voice.includes('SpeechSynthesisUtterance'), 'voice layer must use browser Text-to-Speech');
assert(voice.includes('speechSynthesis'), 'voice layer must call speechSynthesis');
assert(voice.includes("const THAI_LOCALE='th-TH'"), 'Thai locale must be th-TH');
assert(voice.includes("'sentinel-core'"), 'voice layer must define Sentinel Core profile');
assert(voice.includes('sentinel:{'), 'voice layer must define Sentinel user profile');
assert(voice.includes('PanthoriumVoice'), 'voice layer must expose PanthoriumVoice API');
assert(voice.includes('panthorium:voice-${type}'), 'voice layer must emit namespaced voice events');
assert(voice.includes("emit('start'") && voice.includes("emit('end'"), 'voice layer must emit start and end events');
assert(voice.includes("emit('user-start'") && voice.includes("emit('user-result'"), 'voice layer must emit voice input events');
assert(voice.includes('panthorium:ai-done'), 'voice layer must listen to AI done events');
assert(voice.includes('SpeechRecognition') && voice.includes('webkitSpeechRecognition'), 'voice input must support speech recognition fallbacks');
assert(!voice.includes('new MutationObserver'), 'voice layer must avoid whole-document MutationObserver loops');

console.log('phase14 thai voice io ok');
