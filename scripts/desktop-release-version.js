'use strict';
const metadata = require('../package.json');
const run = Number(process.env.GITHUB_RUN_NUMBER);
if (!Number.isSafeInteger(run) || run < 1 || run > 100000000) throw Error('A valid desktop workflow run number is required');
const [major, minor] = metadata.version.split('.').map(Number);
// Each native release gets a greater version even when only Electron source
// changes. Both builders and signed manifests consume this single output.
// Windows file-version components are 16-bit integers.
console.log(`release=${major}.${minor + 1 + Math.floor(run / 60000)}.${run % 60000}`);
