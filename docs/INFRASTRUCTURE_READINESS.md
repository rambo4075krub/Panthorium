# Panthorium cloud infrastructure readiness

## Product boundary

Panthorium remains a cloud-backed web workspace served through Panthorium Browser. This work adds cloud dependency checks; it does not add device-side services or local persistence.

## Implemented in this change

- Production readiness fails when PostgreSQL is unavailable or absent; development may still use its in-memory test mode.
- Production readiness checks that the configured Cloud Storage bucket is reachable with the runtime identity. The check lists only a reserved health-check prefix and returns no object names.
- Production readiness checks storage, database and the capacity service when configured. The AI check follows the selected profile in `ProductionIntelligenceService.readiness()`. The notebook production profile checks Gemini Live configuration.
- `/health/live` checks HTTP process liveness. `/health/ready` and the existing `/health` return the aggregate readiness state with no dependency details. Readiness returns 503 while draining. Notebook releases advertising probes version 1 are checked on the candidate and at the front door.
- Staging checks `/health` after deployment. Production deploys a tagged Cloud Run candidate without traffic, checks `/health` and Voice Identity, then routes production traffic; a post-routing health failure restores the prior revision.
- Regression tests cover missing dependencies and healthy/unhealthy states.

The notebook backup verifier also checks that restored work reviews reference a retained baseline, evidence positions are valid, and stored quote totals match their line items. It returns aggregate counts.

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
