'use strict';
const {loadLocalProfile} = require('./local-secret-store.cjs');
const action = process.argv[2];
try {
  if (!['migrate', 'show'].includes(action) || process.argv.length !== 3) throw new Error('usage: node scripts/local-credentials.cjs migrate|show');
  if (action === 'show' && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('local_credentials_require_interactive_terminal');
  const profile = loadLocalProfile({create:false});
  if (action === 'show') {
    process.stdout.write(`Local username: ${profile.username}\nLocal password: ${profile.password}\n`);
  } else {
    process.stdout.write('Local profile encrypted and verified; legacy plaintext login files removed.\n');
  }
} catch (error) {
  // Helpers use fixed error codes, never decrypted data or subprocess stderr.
  process.stderr.write((String(error.message).startsWith('local_') || String(error.message).startsWith('usage:') ? error.message : 'local_profile_operation_failed') + '\n');
  process.exitCode = 1;
}
