'use strict';
const assert = require('node:assert/strict');
const { resolveBuiltImage, verifyPulledImage } = require('../scripts/resolve-build-image');
const image = `asia-southeast1-docker.pkg.dev/panthorium-staging/panthorium-staging/backend:${'a'.repeat(40)}`;
const digest = `sha256:${'b'.repeat(64)}`;
const build = { id: '86d07b1d-a0fb-4d61-8450-7af937921bdb', status: 'SUCCESS', projectId: 'panthorium-staging',
  substitutions: { _IMAGE_URI: image }, images: [image], results: { images: [{ name: image, digest }] } };
const immutable = image.slice(0, image.lastIndexOf(':')) + '@' + digest;
assert.equal(resolveBuiltImage(build, image).image, immutable);
assert.equal(resolveBuiltImage([build], image).buildId, build.id);
for (const mutate of [
  value => { value.status = 'WORKING'; },
  value => { value.status = 'FAILURE'; },
  value => { delete value.results; },
  value => { value.projectId = 'another-project'; },
  value => { value.id = 'unknown'; },
  value => { value.substitutions._IMAGE_URI += '-other'; },
  value => { value.images.push(image); },
  value => { value.results.images[0].name += '-other'; },
  value => { value.results.images[0].digest = 'latest'; },
  value => { value.results.images.push({ name: image, digest }); },
]) {
  const changed = structuredClone(build); mutate(changed);
  assert.throws(() => resolveBuiltImage(changed, image));
}
assert.throws(() => resolveBuiltImage([build, build], image));
assert.throws(() => resolveBuiltImage(build, image.replace(/a{40}$/, 'latest')));
const inspect = [{ Id: `sha256:${'c'.repeat(64)}`, RepoDigests: [immutable], Os: 'linux', Architecture: 'amd64', Config: { User: '10001:10001' } }];
assert.equal(verifyPulledImage(inspect, immutable), inspect[0].Id);
for (const mutate of [
  value => { value[0].RepoDigests = [immutable.replace(digest, `sha256:${'d'.repeat(64)}`)]; },
  value => { value[0].Architecture = 'arm64'; },
  value => { value[0].Config.User = ''; },
  value => { value[0].Config.User = 'root'; },
  value => { value[0].Config.User = '10001:0'; },
]) {
  const changed = structuredClone(inspect); mutate(changed);
  assert.throws(() => verifyPulledImage(changed, immutable));
}
console.log('Cloud Build immutable deployment identity tests passed');
