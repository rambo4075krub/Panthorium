const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Isolate module state, environment fixtures and local HTTP listeners per test.
const files = fs.readdirSync(__dirname)
  .filter(name => /^security-.*\.js$/.test(name) && !name.includes('postgres'))
  .sort();
if (!files.length) throw new Error('No security regression tests found');
for (const file of files) {
  console.log(`\nSecurity regression: ${file}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Security regression suite: ${files.length} files passed`);
