'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// This verifies/resumes the already approved production job. It cannot create
// resources, change IAM/configuration, or operate against staging.
const PROJECT = 'project-0f6aa7d0-6055-420f-842';
const REGION = 'asia-southeast1';
const SERVICE = 'panthorium-backend';
const ORIGIN = 'https://panthorium-backend-64ltez5ocq-as.a.run.app';
const TARGET = ORIGIN + '/internal/push/tick';
const ACCOUNT = `push-scheduler@${PROJECT}.iam.gserviceaccount.com`;
const JOB = 'panthorium-push-retry';
const JOB_NAME = `projects/${PROJECT}/locations/${REGION}/jobs/${JOB}`;

function activeRevision(service) {
  const traffic = (service.status?.traffic || []).filter(item => item.percent > 0);
  assert(traffic.length === 1 && traffic[0].percent === 100 && /^panthorium-backend-[a-z0-9-]+$/.test(traffic[0].revisionName || ''), 'Expected one production revision with 100% traffic');
  return traffic[0].revisionName;
}
function verifyRevision(revision) {
  assert(revision.spec?.serviceAccountName === `backend-runtime@${PROJECT}.iam.gserviceaccount.com`, 'Unexpected production runtime identity');
  assert(revision.status?.conditions?.some(item => item.type === 'Ready' && item.status === 'True'), 'Production revision is not ready');
  const env = Object.fromEntries((revision.spec?.containers?.[0]?.env || []).map(item => [item.name, item.value]));
  assert(env.PANTHORIUM_FCM_PROJECT_ID === PROJECT, 'Production FCM project is not configured');
  assert(env.PUSH_SCHEDULER_AUDIENCE === TARGET, 'Production push audience does not match');
  assert(env.PUSH_SCHEDULER_SERVICE_ACCOUNTS === ACCOUNT, 'Production push identity allowlist does not match');
}
function verifyJob(job) {
  assert(job.name === JOB_NAME, 'Unexpected Scheduler job');
  assert(['PAUSED', 'ENABLED'].includes(job.state), 'Scheduler job cannot be activated in this state');
  assert(job.schedule === '* * * * *' && job.timeZone === 'Asia/Bangkok', 'Unexpected Scheduler cadence');
  assert(job.httpTarget?.uri === TARGET && job.httpTarget?.httpMethod === 'POST', 'Unexpected Scheduler target');
  assert(job.httpTarget?.oidcToken?.serviceAccountEmail === ACCOUNT && job.httpTarget?.oidcToken?.audience === TARGET, 'Unexpected Scheduler OIDC identity');
  assert(!job.httpTarget?.oauthToken, 'Unexpected Scheduler OAuth configuration');
  assert(job.attemptDeadline === '30s' && Number(job.retryConfig?.retryCount || 0) === 0, 'Unexpected Scheduler retry bounds');
  assert(Buffer.from(job.httpTarget?.body || '', 'base64').toString('utf8') === '{}', 'Unexpected Scheduler request body');
}
function successfulRequest(entries, since) {
  return entries.find(entry => entry.resource?.type === 'cloud_run_revision'
    && entry.resource.labels?.service_name === SERVICE
    && entry.resource.labels?.project_id === PROJECT
    && entry.httpRequest?.requestUrl === TARGET
    && entry.httpRequest?.requestMethod === 'POST'
    && entry.httpRequest?.status === 200
    && String(entry.httpRequest?.userAgent || '').includes('Google-Cloud-Scheduler')
    && Date.parse(entry.timestamp) >= Date.parse(since));
}
function gcloud(args, json = true) {
  const result = spawnSync('gcloud', [...args, `--project=${PROJECT}`, '--quiet', ...(json ? ['--format=json'] : [])], { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    const denied = /PERMISSION_DENIED|does not have permission|permission.*denied/i.test(result.stderr || '');
    throw Error(`gcloud ${args.slice(0, 3).join(' ')} failed${denied ? ': existing deployment identity lacks permission; no IAM changes attempted' : ''}`);
  }
  return json ? JSON.parse(result.stdout) : null;
}
async function verifyAssets() {
  for (const asset of ['notification-push-client.js', 'sw.js']) {
    const response = await fetch(`${ORIGIN}/${asset}`, { signal: AbortSignal.timeout(20000), redirect: 'error' });
    assert(response.status === 200, 'Production push asset unavailable');
    const digest = bytes => createHash('sha256').update(bytes).digest('hex');
    assert(digest(Buffer.from(await response.arrayBuffer())) === digest(fs.readFileSync(path.join(__dirname, '..', asset))), 'Production push assets do not match the reviewed checkout');
  }
  const health = await fetch(`${ORIGIN}/api/health`, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  assert(health.status === 200 && (await health.json()).ok === true, 'Production health check failed');
  const unauthenticated = await fetch(TARGET, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20000), redirect: 'error' });
  assert(unauthenticated.status === 401 && (await unauthenticated.json()).error === 'scheduler_authentication_required', 'Push tick does not enforce the expected authentication');
}
async function main() {
  assert(process.argv.length === 3 && process.argv[2] === '--activate', 'Explicit --activate is required');
  const revisionName = activeRevision(gcloud(['run', 'services', 'describe', SERVICE, `--region=${REGION}`]));
  verifyRevision(gcloud(['run', 'revisions', 'describe', revisionName, `--region=${REGION}`]));
  await verifyAssets();
  const jobArgs = [JOB, `--location=${REGION}`];
  const job = gcloud(['scheduler', 'jobs', 'describe', ...jobArgs]);
  verifyJob(job);
  if (job.state === 'PAUSED') gcloud(['scheduler', 'jobs', 'resume', ...jobArgs], false);
  const since = new Date().toISOString();
  gcloud(['scheduler', 'jobs', 'run', ...jobArgs], false);
  const filter = `resource.type="cloud_run_revision" AND resource.labels.service_name="${SERVICE}" AND httpRequest.requestUrl="${TARGET}" AND httpRequest.status=200 AND timestamp>="${since}"`;
  for (let attempt = 0; attempt < 12; attempt++) {
    const request = successfulRequest(gcloud(['logging', 'read', filter, '--limit=20', '--freshness=10m']), since);
    if (request) {
      const current = gcloud(['scheduler', 'jobs', 'describe', ...jobArgs]);
      verifyJob(current);
      assert(current.state === 'ENABLED', 'Scheduler is not enabled after verification');
      const receipt = { project: PROJECT, job: JOB, state: current.state, revision: revisionName, target: TARGET, authenticatedHttpStatus: 200, requestTimestamp: request.timestamp, deviceReceiptVerified: false };
      fs.writeFileSync('production-push-verification.json', JSON.stringify(receipt, null, 2) + '\n');
      console.log(JSON.stringify(receipt));
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw Error('Scheduler run requested, but no fresh authenticated HTTP 200 was observed; device delivery remains unverified');
}
module.exports = { activeRevision, verifyRevision, verifyJob, successfulRequest, PROJECT, TARGET, ACCOUNT, JOB_NAME };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
