#!/usr/bin/env bash
set -euo pipefail
# REVIEW FIRST. No commands execute unless explicitly invoked with --apply.
# The caller must already have the rights to configure Scheduler and act as this SA.
# Cloud Run interval fallback stays disabled unless PANTHORIUM_SCHEDULER_INTERVAL_FALLBACK=1.
# This creates a Scheduler job only; it does not alter Cloud Run ingress/IAM or deploy.
: "${SCHEDULER_PROJECT_ID:?Set SCHEDULER_PROJECT_ID}"
: "${SCHEDULER_REGION:?Set SCHEDULER_REGION}"
: "${SCHEDULER_SERVICE_ACCOUNT:?Set SCHEDULER_SERVICE_ACCOUNT}"
: "${SCHEDULER_TARGET_BASE_URL:?Set production/staging HTTPS origin}"
SCHEDULER_JOB_NAME="${SCHEDULER_JOB_NAME:-panthorium-durable-tick}"
SCHEDULER_TARGET_URL="${SCHEDULER_TARGET_BASE_URL%/}/internal/jobs/tick"
SCHEDULER_TOKEN_AUDIENCE="${SCHEDULER_OIDC_AUDIENCE:-${SCHEDULER_TARGET_BASE_URL%/}}"
[[ "$SCHEDULER_TARGET_BASE_URL" == https://* ]] || { echo 'HTTPS target required' >&2; exit 2; }
[[ "$SCHEDULER_SERVICE_ACCOUNT" == *@*.iam.gserviceaccount.com ]] || { echo 'Service-account email required' >&2; exit 2; }
command=(gcloud scheduler jobs create http "$SCHEDULER_JOB_NAME"
  --project "$SCHEDULER_PROJECT_ID" --location "$SCHEDULER_REGION"
  --schedule '* * * * *' --time-zone 'Etc/UTC' --uri "$SCHEDULER_TARGET_URL"
  --http-method POST --oidc-service-account-email "$SCHEDULER_SERVICE_ACCOUNT"
  --oidc-token-audience "$SCHEDULER_TOKEN_AUDIENCE" --attempt-deadline 180s
  --max-retry-attempts 2 --min-backoff 30s --max-backoff 60s)
printf 'Configure backend SCHEDULER_OIDC_AUDIENCE=%s\n' "$SCHEDULER_TOKEN_AUDIENCE"
printf 'Configure backend SCHEDULER_SERVICE_ACCOUNTS=%s\n' "$SCHEDULER_SERVICE_ACCOUNT"
printf 'Review command: '; printf '%q ' "${command[@]}"; printf '\n'
if [[ "${1:-}" == '--apply' ]]; then "${command[@]}"; else printf 'Dry run only. No cloud resources changed.\n'; fi
