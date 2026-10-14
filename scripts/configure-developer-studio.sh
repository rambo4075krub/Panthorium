#!/usr/bin/env bash
# Run once in the owner's Google Cloud Shell. Never paste the token into chat.
set -euo pipefail
studio_project=panthorium-staging
studio_secret=panthorium-staging-developer-github-token
studio_service=panthorium-backend-staging
studio_runtime=staging-runtime@panthorium-staging.iam.gserviceaccount.com
if ! gcloud secrets describe "$studio_secret" --project="$studio_project" >/dev/null 2>&1; then
  gcloud secrets create "$studio_secret" --project="$studio_project" --replication-policy=automatic
fi
read -r -s -p 'GitHub fine-grained token (hidden): ' studio_token
printf '\n'
if [[ -z "$studio_token" ]]; then echo 'No token entered; stopped.' >&2; exit 1; fi
printf '%s' "$studio_token" | gcloud secrets versions add "$studio_secret" --project="$studio_project" --data-file=-
unset studio_token
gcloud secrets add-iam-policy-binding "$studio_secret" --project="$studio_project" \
  --member="serviceAccount:$studio_runtime" --role=roles/secretmanager.secretAccessor
gcloud projects add-iam-policy-binding "$studio_project" \
  --member="serviceAccount:$studio_runtime" --role=roles/run.viewer
gcloud run services update "$studio_service" --project="$studio_project" --region=asia-southeast1 \
  --update-secrets="DEVELOPER_GITHUB_TOKEN=$studio_secret:latest" --quiet
echo 'Developer Studio configured. Sign in as the system owner and check Connections.'
