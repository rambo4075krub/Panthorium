'use strict';
const assert = require('node:assert/strict');
const { runProcess } = require('../services/mediaStudioService');

(async () => {
  // Synthetic markers only: never read or print actual application secrets.
  const keys = ['PANTHORIUM_NATIVE_TEST_SECRET', 'GOOGLE_APPLICATION_CREDENTIALS', 'LD_PRELOAD', 'HTTP_PROXY', 'NODE_OPTIONS'];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) process.env[key] = 'synthetic-do-not-inherit';
    const script = `const keys = ${JSON.stringify(keys)}; process.stdout.write(JSON.stringify({ exposed: keys.filter(k => Object.hasOwn(process.env, k)), path: Boolean(process.env.PATH || process.env.Path) }));`;
    const result = await runProcess(process.execPath, ['-e', script], { timeoutMs: 5000, maxOutputBytes: 2048 });
    const reported = JSON.parse(result.stdout);
    assert.deepEqual(reported.exposed, []);
    assert.equal(reported.path, Boolean(process.env.PATH || process.env.Path));
    assert.equal(result.stderr, '');
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  console.log('Native media child environment excludes credentials and loader/proxy overrides');
})().catch(error => { console.error(error); process.exitCode = 1; });
