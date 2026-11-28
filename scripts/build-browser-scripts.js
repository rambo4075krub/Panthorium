'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { minify } = require('terser');
const { BUILT_SCRIPTS, releaseAssetPath } = require('../middleware/publicAssets');

async function build() {
  const root = path.resolve(__dirname, '..');
  const check = process.argv.includes('--check');
  for (const file of BUILT_SCRIPTS) {
    const source = await fs.readFile(path.join(root, file), 'utf8');
    // Other classic scripts call the shell's global functions by name.
    const { code } = await minify(source, { compress: false, mangle: false, sourceMap: false });
    const target = path.join(root, releaseAssetPath(file));
    const output = code + '\n';
    if (check) {
      if (await fs.readFile(target, 'utf8') !== output) throw Error(file + ' is stale. Run npm run build:browser.');
    } else {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, output);
    }
  }
}

build().catch(error => { console.error(error.message); process.exitCode = 1; });
