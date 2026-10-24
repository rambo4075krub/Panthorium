'use strict';
const assert = require('node:assert/strict');
const { SentinelTrainingRepository } = require('../services/sentinelTrainingRepository');
const { SentinelTrainingService } = require('../services/sentinelTrainingService');
const { publicationHash } = require('../services/sentinelTrainingPrivacy');

(async () => {
  const repository = new SentinelTrainingRepository();
  const versions = new Map();
  const learning = { init: async () => {}, repository: {
    list: async () => [...versions.values()], get: async id => versions.get(id)
  } };
  const training = new SentinelTrainingService({ repository, learning, providers: { available: () => [] }, autoEnabled: false, autoCapture: false });
  const add = async (source, answer, tags = []) => {
    const result = await training.addExample({ prompt: 'Project Canary details', answer, source, tags, user: { sub: 'data-owner' } });
    await repository.review(result.example.exampleId, 'approved', 'quality-reviewer');
    const versionId = require('node:crypto').randomUUID();
    versions.set(versionId, { versionId, exampleId: result.example.exampleId, state: 'active' });
    return repository.getById(result.example.exampleId);
  };
  const privateExample = await add('conversation:auto', 'PRIVATE-CANARY contains confidential business details');
  await add('private:import', 'PRIVATE-IMPORT contains personal confidential details');
  await add('recovery:legacy', 'PRIVATE-DERIVATIVE from captured chat', ['conversation']);
  const parentVersion = [...versions.values()].find(item => item.exampleId === privateExample.exampleId);
  await add('recovery:'+parentVersion.versionId, 'PRIVATE-LEGACY-DERIVATIVE with lost tags');
  await add('recovery:missing-parent', 'UNKNOWN-LINEAGE malformed source');
  await add('recovery:11111111-1111-4111-8111-111111111111', 'UNKNOWN-LINEAGE must stay private');
  const publicExample = await add('human', 'PUBLIC-CURATED educational answer');
  await add('teacher:vertex', 'PUBLIC-TEACHER generated educational answer');
  const context = await training.contextFor('Project Canary', 5), exported = await training.exportJsonl();
  for (const output of [context, exported]) {
    assert.doesNotMatch(output, /PRIVATE-|UNKNOWN-LINEAGE/);
    assert.match(output, /PUBLIC-CURATED/); assert.match(output, /PUBLIC-TEACHER/);
  }
  // Upload/service arguments cannot grant publication rights.
  const attempted = await training.addExample({ prompt: 'Project Canary new private record', answer: 'DO-NOT-PUBLISH this private answer', source: 'conversation:auto', globalPublication: { status: 'approved' }, user: { sub: 'data-owner' } });
  assert.equal(attempted.example.globalPublication, null);
  // Only independently recorded evidence, bound to these exact bytes and owner,
  // can be recognized; tests seed it directly, not through a user-facing API.
  const record = { schema: 1, exampleId: privateExample.exampleId, scope: 'global-training', status: 'approved', subjectUserId: 'data-owner', contentHash: publicationHash(privateExample), consentGranted: true, anonymized: true, consentEvidenceId: 'consent-record-1', anonymizationReviewId: 'review-record-1', approvedBy: 'privacy-reviewer', approvedAt: new Date().toISOString() };
  const withPublication = { ...privateExample, globalPublication: record };
  assert(await training.globallyShareable(withPublication));
  for (const change of [{ exampleId: 'other-example' }, { anonymized: false }, { consentGranted: false }, { subjectUserId: 'another-owner' }, { contentHash: 'wrong-hash' }, { revokedAt: new Date().toISOString() }, { consentEvidenceId: '' }, { anonymizationReviewId: '' }]) {
    assert.equal(await training.globallyShareable({ ...privateExample, globalPublication: { ...record, ...change } }), false);
  }
  assert.equal(await training.globallyShareable({ ...withPublication, answer: privateExample.answer+' changed' }), false);
  repository.examples.set(privateExample.exampleId, withPublication);
  assert.match(await training.exportJsonl(), /PRIVATE-CANARY/, 'Explicit valid recorded publication can include exact reviewed bytes');
  assert.doesNotMatch(await training.exportJsonl(), /PRIVATE-LEGACY-DERIVATIVE/, 'Publication of a parent cannot implicitly publish private derivatives');
  const publicVersion = [...versions.values()].find(item => item.exampleId === publicExample.exampleId);
  versions.delete(publicVersion.versionId);
  assert.doesNotMatch(await training.contextFor('Project Canary', 5), /PUBLIC-CURATED/, 'Publication does not bypass active-learning quality gate');
  console.log('Security training privacy: private/derived examples excluded from context/export; curated data preserved; exact consent evidence validated.');
})().catch(error => { console.error(error); process.exitCode = 1; });
