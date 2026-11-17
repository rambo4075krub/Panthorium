'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');

async function run() {
  const gypRequire = createRequire(require.resolve('node-gyp'));
  const { glob } = gypRequire('tinyglobby');
  const builderRequire = createRequire(require.resolve('app-builder-lib'));
  const { Minimatch } = builderRequire('minimatch');
  assert(new Minimatch('electron/**/*.cjs', { dot: true }).match('electron/payment-checkout.cjs'));
  assert(!new Minimatch('electron/**/*.cjs').match('services/stripeBillingService.js'));

  const previous = process.cwd();
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'panthorium-build-deps-'));
  try {
    process.chdir(temporary);
    await fs.mkdir('build/nested', { recursive: true });
    await fs.writeFile('build/project.sln', 'fixture');
    await fs.writeFile('build/nested/ignored.sln', 'fixture');
    await fs.writeFile('build/project.mk', 'fixture');
    assert.deepEqual(await glob('build/*.sln', { expandDirectories: false }), ['build/project.sln']);
    assert.deepEqual(await glob('build/*.mk', { expandDirectories: false }), ['build/project.mk']);

    if (process.platform === 'win32') {
      // Run node-gyp's actual Windows solution discovery and argument setup.
      // Only the compiler process is substituted; no SDK or downloaded headers.
      const build = gypRequire('./build');
      await fs.writeFile('build/config.gypi', JSON.stringify({
        target_defaults: { default_configuration: 'Release' },
        variables: { target_arch: 'x64', nodedir: temporary, python: process.execPath, msbuild_path: process.execPath }
      }));
      const launches = [];
      const gyp = { opts: { make: process.execPath }, spawn(command, args) {
        launches.push({ command, args: [...args] });
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('exit', 0, null));
        return child;
      } };
      await build(gyp, []);
      assert.equal(launches.length, 1);
      assert.equal(launches[0].args[0].replaceAll('\\', '/'), 'build/project.sln');
      assert(launches[0].args.includes('/p:Configuration=Release;Platform=x64'));
      await fs.unlink('build/project.sln');
      await build(gyp, []);
      assert(launches[1].args.includes('BUILDTYPE=Release'));
      await fs.unlink('build/project.mk');
      await assert.rejects(build(gyp, []), /Could not find/);
      assert.equal(launches.length, 2);
    }
    console.log('Desktop build dependencies: packaged-file matching, solution discovery and native build API compatibility passed');
  } finally {
    process.chdir(previous);
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
