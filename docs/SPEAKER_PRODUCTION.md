# Production speaker deployment

The production deployment calls `deploy-speaker-production.yml` before the backend
deployment. The parent `deploy-gcp.yml` workflow owns the `panthorium-production`
concurrency lock and runs on `main` push or manual dispatch. The reusable speaker
workflow and its credential-bearing job also require `refs/heads/main`. A failed
speaker security gate stops the production rollout.

This is deployment preparation. Source tests do not establish that production IAM,
service identities, model calibration, or live readiness have been verified.

## Complete runtime image

The deployment Dockerfile builds a minimal Ubuntu 24.04 runtime with Python 3.12,
all pinned CPU model dependencies, the verified model snapshot, and native media
libraries built against the same ABI. The vendor's patched zlib and libc files
retain their original package identities and ownership. No administration shell
or package manager is included. The complete image runs as UID/GID 10001.

CI and registry-digest verification share the same composite action. Every release
requires complete filesystem and package inventory checks, nine real decoder
formats, offline model inference, an unfiltered report, and the strict High/Critical
gate. Only the reviewed FFmpeg source backport may receive an image-bound fixed
statement after checking the actual independently reproduced executable hashes.
All other findings remain visible. A passing threshold does not assert that all
Medium or lower findings are fixed or that biometric calibration is complete.

## Existing infrastructure required

- The existing `GCP_PROJECT_ID` and `GCP_SA_KEY` production deployment credentials,
  the `panthorium` Artifact Registry repository in `asia-southeast1`, and working
  Cloud Build permissions. The production project must differ from staging.
- Existing services `panthorium-backend` and `panthorium-speaker`. Each must be
  ready and have 100% of traffic on its latest ready revision. The workflow does
  not bootstrap an absent service or guess which older revision should be used.
- A pre-provisioned, enabled `speaker-runtime@PROJECT.iam.gserviceaccount.com`
  identity with no project-level roles. The backend identity is read from the
  existing backend service and must be a separate explicit account in that project.
- The private speaker service must have its IAM invoker check enabled and exactly
  the backend account as its service-level `roles/run.invoker` caller. No public
  project or speaker-service IAM bindings are accepted by the existing verifier.
- The deployment identity must have `roles/iam.serviceAccountUser` on the
  dedicated speaker account (or an equivalent reviewed `iam.serviceAccounts.actAs`
  grant) to attach it to a revision. This is separate from granting the speaker
  account access to project resources.
- The deployment identity must already be able to read the relevant IAM/service
  state and mint a Google ID token for the backend account. The token is used only
  for authenticated speaker health checks with the canonical speaker URL as its
  audience. This workflow creates no account and grants no IAM role.
- The existing backend must have its Voice Identity gate and template key
  configured and use Google identity authentication, without a static speaker
  bearer token. Other backend settings and secret references are preserved.

An infrastructure owner must review inherited IAM, organization policies and
resource-specific permissions separately. These checks do not prove the absence
of every possible inherited grant.

## Verification and rollout

1. Run the full speaker container security gate. Validate existing identities,
   current traffic and authenticated live health before spending on a new build.
2. Build the full speaker image once using `cloudbuild.speaker.production.yaml`.
   Resolve Cloud Build's immutable digest and run the same native/model/SBOM and
   vulnerability verification against that exact digest. No gate is bypassed.
3. Deploy a private, bounded, non-root speaker candidate with no production
   traffic. Verify its exact ready revision, image, identity and service policy.
   Check its tagged health URL as the backend identity. Redirects and tag URLs
   outside the exact canonical Cloud Run service host are rejected.
4. Prepare a no-traffic backend association candidate using the existing backend
   image's resolved digest. Change only `BIOMETRIC_SPEAKER_URL`. Verify unchanged
   runtime settings, environment entries, Cloud SQL/VPC/scaling annotations and
   other revision metadata, then check both backend health endpoints.
5. Recheck candidate identities and old traffic immediately before promotion.
   Promote and check the speaker first; promote and check the backend association
   second. Only then may the parent deploy the new backend application image.

Recovery covers this speaker-and-association rollout. A later failure while the
parent builds or deploys the new backend application image can leave the verified
speaker update serving the previous backend application. The parent has its own
backend traffic recovery; this is not an atomic release of both application images.

If a check or traffic update fails, restore the backend's previous traffic before
restoring speaker traffic. A failed command that may already have changed traffic
also enters recovery. Recovery refuses to overwrite an observed unrelated revision
or traffic change. If backend recovery cannot be verified, leave the verified
speaker candidate in place and fail for operator review. Unique candidate tags are
removed during a successful recovery; revisions are retained for inspection.

Cloud configuration JSON and tokens stay in private temporary runner storage or
memory and are not uploaded. Tokens are masked before use. Retained artifacts are
the Cloud Build result and image-security evidence, not runtime environment values.

The rollout checks service operation and exact deployed artifacts. They do not
replace real owner/impostor voice calibration or prove biometric accuracy.

## Local verification

With an already authenticated Google Cloud SDK, inspect the selected services
without changing them or printing secret values:

```sh
python scripts/check-cloud-readiness.py --project PROJECT --region asia-southeast1 --backend-service BACKEND --speaker-service SPEAKER
```

The checker also supports Windows with the SDK's `gcloud.cmd` on `PATH`. It
resolves that launcher only after validating the exact read-only command. Passing
these scoped checks does not approve a release or establish deployment-identity
permissions; inherited/resource IAM and release-image verification remain separate.

```sh
python3 -m unittest discover -s speaker-service -p 'test_production_deployment.py' -v
```

The tests use mocked cloud operations and synthetic configurations. They exercise
identity/URL restrictions, configuration preservation, successful ordering,
unhealthy candidates, ambiguous traffic-update failures, and guarded rollback.

Official behavior references:

- [Cloud Run revision status](https://docs.cloud.google.com/run/docs/reference/rest/v1/namespaces.revisions)
- [Service-to-service ID token audiences](https://docs.cloud.google.com/run/docs/authenticating/service-to-service)
- [Traffic tags and rollback](https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration)
