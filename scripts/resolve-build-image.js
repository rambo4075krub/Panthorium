#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

// Resolve the immutable output from this successful Cloud Build response. Never
// resolve a mutable registry tag after the build: another run could replace it.
function resolveBuiltImage(response, expectedImage) {
  assert.match(expectedImage, /^[a-z][a-z0-9-]*-docker\.pkg\.dev\/[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*:[a-f0-9]{40}$/,
    'Expected a tagged Artifact Registry image for the exact source commit');
  if (Array.isArray(response)) {
    assert.equal(response.length, 1, 'Expected exactly one Cloud Build result');
    response = response[0];
  }
  assert.equal(response?.status, 'SUCCESS', 'Cloud Build did not succeed');
  assert.match(response.id || '', /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/, 'Missing Cloud Build identity');
  assert.equal(response.projectId, expectedImage.split('/')[1], 'Build came from another project');
  assert.equal(response.substitutions?._IMAGE_URI, expectedImage, 'Build substitution does not match the requested image');
  assert.deepEqual(response.images, [expectedImage], 'Build declared unexpected image outputs');
  const images = response.results?.images;
  assert.ok(Array.isArray(images) && images.length === 1, 'Expected exactly one pushed image result');
  assert.equal(images[0].name, expectedImage, 'Build pushed a different image');
  assert.match(images[0].digest || '', /^sha256:[a-f0-9]{64}$/, 'Build did not return an immutable image digest');
  return { image: `${expectedImage.slice(0, expectedImage.lastIndexOf(':'))}@${images[0].digest}`, buildId: response.id };
}

function verifyPulledImage(images, expectedImage) {
  assert.match(expectedImage, /^[a-z][a-z0-9-]*-docker\.pkg\.dev\/[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/, 'Expected an immutable Artifact Registry image');
  assert.ok(Array.isArray(images) && images.length === 1, 'Expected one inspected image');
  assert.ok(images[0].RepoDigests?.includes(expectedImage), 'Pulled image does not match the Cloud Build digest');
  assert.match(images[0].Id || '', /^sha256:[a-f0-9]{64}$/, 'Missing local image identity');
  assert.equal(images[0].Os, 'linux');
  assert.equal(images[0].Architecture, 'amd64');
  assert.match(images[0].Config?.User || '', /^(?:[1-9][0-9]*|node)(?::(?:[1-9][0-9]*|node))?$/, 'Deployment image must declare a non-root runtime user');
  return images[0].Id;
}

if (require.main === module) {
  const [mode, filename, expectedImage, ...extra] = process.argv.slice(2);
  assert.ok(filename && expectedImage && !extra.length, 'Usage: resolve-build-image.js resolve|inspect JSON_FILE EXPECTED_IMAGE');
  const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (mode === 'resolve') {
    const result = resolveBuiltImage(value, expectedImage);
    console.log(`image=${result.image}\nbuild-id=${result.buildId}`);
  } else {
    assert.equal(mode, 'inspect', 'Unknown verification mode');
    console.log(`Verified pulled image ${verifyPulledImage(value, expectedImage)}`);
  }
}

module.exports = { resolveBuiltImage, verifyPulledImage };
