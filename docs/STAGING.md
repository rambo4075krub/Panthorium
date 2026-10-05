# Staging acceptance before production

Status: the staging workflow deploys to an isolated Cloud Run service. Production is deployed by the separate `main` workflow.
Staging deployment success does not by itself verify Cloud Storage object access or acceptance on each device.

## One-time setup

Use a separate GCP project to isolate production secrets and data. Enable Cloud Run, Cloud Build, Artifact Registry, Secret Manager and Cloud SQL APIs.
Create Artifact Registry Docker repository panthorium-staging in asia-southeast1.
Create a separate PostgreSQL database with a dedicated staging application role; do not restore production personal data.
Create a staging runtime service account with Cloud SQL Client, access only to staging secrets, and `roles/storage.objectUser` on the staging bucket only.
Create private Cloud Storage buckets for staging and production in their intended projects. Keep the bucket names different, enable Public Access Prevention, and do not mix test objects with production data.
Authorize the staging deployment account for Cloud Build submission, Artifact Registry, Cloud Run deployment and acting as the runtime account; authorize the build account to push images.
For production Cloud Run, configure `BIOMETRIC_SPEAKER_URL` and `BIOMETRIC_TEMPLATE_KEY` before merging to `main`; store the encryption key in Secret Manager and grant the production runtime service account access to that secret. If the speaker provider is another Cloud Run service, grant the production runtime account `roles/run.invoker` on that service. The production workflow checks these settings and verifies the deployed health endpoint reports Voice Identity configured and enabled.
For production Cloud Storage, grant `roles/storage.objectUser` on the production bucket to the service account running `panthorium-backend`; do not grant public access. The GitHub deploy identity also needs permission to deploy Cloud Run, but it should not receive object data access unless your setup requires it.

Use Cloud Shell after replacing the uppercase placeholders with the exact bucket names and service account emails:
```sh
gcloud storage buckets add-iam-policy-binding "gs://YOUR_STAGING_BUCKET" \
  --member="serviceAccount:YOUR_STAGING_RUNTIME_SA" \
  --role="roles/storage.objectUser"

gcloud storage buckets add-iam-policy-binding "gs://YOUR_PRODUCTION_BUCKET" \
  --member="serviceAccount:YOUR_PRODUCTION_RUNTIME_SA" \
  --role="roles/storage.objectUser"
```
Get the production runtime service account from Google Cloud Console → Cloud Run → `panthorium-backend` → Security. If the production speaker provider is Cloud Run, also grant that service's invoker role to the same runtime identity.

Create Secret Manager secrets in the staging project:
- panthorium-staging-database-url: connection string for the staging-only database.
- panthorium-staging-jwt: newly generated signing secret, different from production.
- panthorium-staging-admin-password: new test administrator password.
Configure separate Groq, OpenAI, Gemini and Anthropic provider keys on the staging service before AI tests; never copy production secrets implicitly. Staging uses Groq as the teacher and OpenAI/Gemini/Anthropic as independent evaluators, requiring at least two evaluators. Automatic capture remains disabled and autonomous promotion remains paused until benchmark acceptance passes.

In repository Settings → Secrets and variables → Actions → Variables, set:
- `PANTHORIUM_STAGING_FILES_BUCKET`: private staging bucket name.
- `PANTHORIUM_PRODUCTION_FILES_BUCKET`: private production bucket name; it must differ from the staging value.
These are bucket names, not credentials. Both deployment workflows stop before deployment if either value is missing or the names match.

Create GitHub environment staging:
- Variable STAGING_GCP_PROJECT_ID
- Variable STAGING_RUNTIME_SA: runtime account email in that project
- Variable STAGING_SQL_INSTANCE: PROJECT:asia-southeast1:INSTANCE
- Variable STAGING_DEPLOY_SA: staging-deployer@panthorium-staging.iam.gserviceaccount.com
- Variable STAGING_WIF_PROVIDER: projects/124818950958/locations/global/workloadIdentityPools/github-staging/providers/github

Use Workload Identity Federation with issuer https://token.actions.githubusercontent.com.
The provider must require repository_id 1354665126, repository_owner_id 323206227, ref refs/heads/staging, environment staging and event_name push.
Grant roles/iam.workloadIdentityUser on the staging deployer only to that repository in the github-staging pool.
No STAGING_GCP_SA_KEY is required.

Build identity: 124818950958-compute@developer.gserviceaccount.com, explicitly selected by the workflow.
Build source bucket: gs://panthorium-staging_cloudbuild. The deployer uploads source; the build identity reads it, writes build logs and pushes images to the staging repository.
Temporary GitHub authentication files are excluded from source uploads and Docker build context.

The connected repository tool cannot create these environment variables/secrets or provision Google Cloud resources. Never paste credentials into chat or commit them.
Once configuration is complete, re-run the failed staging workflow.

## Routine

After setting both repository bucket variables and the bucket IAM bindings, push reviewed changes to staging. The workflow tests, builds, deploys and publishes the /admin URL in its run summary.
On staging, sign in to a test account and verify Notes can create, reload, edit, and delete a note; verify Files can upload, list, download, and delete; verify a second account cannot read the first account's objects. The current automated Cloud Storage tests use mocked requests, so this real-bucket check is required before promoting to `main`.
Use a fresh test administrator and a separate ordinary test account created with existing user management.
Do not use production passwords.
Automated health and page checks are not voice acceptance tests.

Before requesting production promotion:
- Confirm Learning Lab and other requested windows visibly open after Thai and English voice commands.
- Confirm ordinary users cannot open admin functions or access admin APIs.
- Confirm the spoken reply omits the label “เสียงตอบกลับ”.
- Confirm destructive actions wait for an explicit confirmation and cancellation does nothing.
- Record staging commit SHA, test results and owner acceptance in the promotion PR.
- Re-test if the staging commit changes.

Only after owner acceptance merge into main; its existing production workflow deploys.
This workflow does not configure branch protection or enforce owner acceptance automatically. Until GitHub environment/branch protection is configured, acceptance is a manual release gate.

## Cloud SQL Unix socket

Staging DATABASE_URL must use host=/cloudsql/panthorium-staging:asia-southeast1:panthorium-staging-db.
The staging deployment sets DATABASE_SSL_MODE=disable for this local Unix socket; the managed Cloud SQL Auth Proxy encrypts the onward database connection.
Do not reuse this setting for a direct TCP database connection. Global application and production TLS defaults are unchanged.
