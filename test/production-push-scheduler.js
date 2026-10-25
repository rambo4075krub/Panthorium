'use strict';
const assert = require('node:assert/strict');
const { activeRevision, verifyRevision, verifyJob, successfulRequest, PROJECT, TARGET, ACCOUNT, JOB_NAME } = require('../scripts/verify-production-push-scheduler');
const clone = value => JSON.parse(JSON.stringify(value));
const service = { status: { traffic: [{ revisionName: 'panthorium-backend-00001-abc', percent: 100 }, { revisionName: 'panthorium-backend-00002-def', tag: 'candidate' }] } };
assert.equal(activeRevision(service), 'panthorium-backend-00001-abc');
assert.throws(() => activeRevision({ status: { traffic: [{ revisionName: 'panthorium-backend-00001-abc', percent: 50 }] } }));
const revision = { spec: { serviceAccountName: `backend-runtime@${PROJECT}.iam.gserviceaccount.com`, containers: [{ env: [
  { name: 'PANTHORIUM_FCM_PROJECT_ID', value: PROJECT }, { name: 'PUSH_SCHEDULER_AUDIENCE', value: TARGET }, { name: 'PUSH_SCHEDULER_SERVICE_ACCOUNTS', value: ACCOUNT }
] }] }, status: { conditions: [{ type: 'Ready', status: 'True' }] } };
verifyRevision(revision);
for (let index = 0; index < 3; index++) {
  const bad = clone(revision); bad.spec.containers[0].env[index].value = 'panthorium-staging'; assert.throws(() => verifyRevision(bad));
}
const job = { name: JOB_NAME, state: 'PAUSED', schedule: '* * * * *', timeZone: 'Asia/Bangkok', attemptDeadline: '30s', retryConfig: {}, httpTarget: { uri: TARGET, httpMethod: 'POST', body: Buffer.from('{}').toString('base64'), oidcToken: { serviceAccountEmail: ACCOUNT, audience: TARGET } } };
verifyJob(job);
for (const mutate of [j => { j.name = j.name.replace(PROJECT, 'panthorium-staging'); }, j => { j.httpTarget.uri += '?redirect=1'; }, j => { j.httpTarget.oidcToken.serviceAccountEmail = 'other@example.com'; }, j => { j.httpTarget.oidcToken.audience = 'https://example.com'; }, j => { j.state = 'DISABLED'; }, j => { j.retryConfig.retryCount = 5; }, j => { j.httpTarget.body = ''; }]) {
  const bad = clone(job); mutate(bad); assert.throws(() => verifyJob(bad));
}
const entry = { resource: { type: 'cloud_run_revision', labels: { project_id: PROJECT, service_name: 'panthorium-backend' } }, httpRequest: { requestMethod: 'POST', requestUrl: TARGET, status: 200, userAgent: 'Google-Cloud-Scheduler' }, timestamp: '2026-10-25T10:00:01Z' };
assert(successfulRequest([entry], '2026-10-25T10:00:00Z'));
assert.equal(successfulRequest([entry], '2026-10-25T10:00:02Z'), undefined);
for (const mutate of [e => { e.httpRequest.status = 401; }, e => { e.httpRequest.userAgent = 'other-client'; }, e => { e.resource.labels.project_id = 'panthorium-staging'; }, e => { e.httpRequest.requestUrl += '/wrong'; }]) {
  const bad = clone(entry); mutate(bad); assert.equal(successfulRequest([bad], '2026-10-25T10:00:00Z'), undefined);
}
console.log('Production push activation guards reject wrong targets, identities, configuration, split traffic and stale/unauthenticated evidence.');
