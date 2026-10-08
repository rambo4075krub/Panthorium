# Panthorium cloud infrastructure readiness

## Product boundary

Panthorium remains a cloud-backed web workspace served through Panthorium Browser. This work adds cloud dependency checks; it does not add device-side services or local persistence.

## Implemented in this change

- Production readiness fails when PostgreSQL is unavailable or absent; development may still use its in-memory test mode.
- Production readiness checks that the configured Cloud Storage bucket is reachable with the runtime identity. The check lists only a reserved health-check prefix and returns no object names.
- Production readiness verifies that Sentinel V4 is configured through Vertex AI.
- `/health` reports only pass/fail component checks and safe error codes. Cloud Run reserves some paths ending in `z`, so Cloud Run checks must use `/health`.
- Staging checks `/health` after deployment. Production deploys a tagged Cloud Run candidate without traffic, checks `/health` and Voice Identity, then routes production traffic; a post-routing health failure restores the prior revision.
- Regression tests cover missing dependencies and healthy/unhealthy states.

## Remaining cloud work

1. **Dedicated background worker / durable queue.** The scheduled Agent and reminder loops still run inside the web process. Deploy a separate Cloud Run worker or move due work to Cloud Tasks/Pub/Sub, with idempotent claims, retry/backoff, and dead-letter handling. This needs production Cloud Run and IAM configuration before enabling it.
2. **Recovery proof.** Configure and run Cloud SQL point-in-time recovery and Cloud Storage versioning/retention tests; record RPO/RTO and restore evidence. Code inspection cannot prove backups are usable.
3. **SLO and load acceptance.** Add measured latency percentiles, error-budget burn, concurrency/load tests, and Cloud Run instance limits based on measured Cloud SQL connection capacity.
4. **GitHub-to-GCP identity.** Migrate the production deploy workflow from the long-lived service-account JSON secret to Workload Identity Federation after production pool/provider/service-account identifiers are configured. Do not guess those resource names.
5. **App hardening for desktop delivery.** Review Electron signing and update channels separately; this does not change the cloud-only user data policy.

## Acceptance

- Both staging and production deployment workflows pass `/health`.
- Cloud Storage access check runs using the service runtime identity.
- No device-local persistent data path is introduced.
- A green health check is necessary but does not replace account-isolation, voice, or device acceptance tests.
