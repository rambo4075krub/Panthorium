# Sentinel tuned Gemini direct API

Panthorium calls the tuned Gemini endpoint from the backend on each request.
It does not need an inference VM or a minimum Cloud Run instance running all
day. Tuned Gemini uses Google's managed shared endpoint and is billed per
token; the tuned-model endpoint itself has no separate serving-compute charge.
The Panthorium Cloud Run service can scale to zero when idle. The first request
after idle may take longer while Cloud Run starts the application container.

## Configure

Set these environment variables on the Panthorium backend service:

```text
SENTINEL_VERTEX_PROJECT_ID=<Google Cloud project ID or number>
SENTINEL_VERTEX_LOCATION=<endpoint location shown in Model Registry>
SENTINEL_VERTEX_ENDPOINT_ID=<endpoint ID for the selected default checkpoint>
SENTINEL_VERTEX_MODEL=sentinel-v3
SENTINEL_VERTEX_MAX_OUTPUT_TOKENS=4096
AI_PRIORITY=vertex,groq,openai,gemini
```

For staging deployments, set the repository/environment variables
`STAGING_VERTEX_PROJECT_ID`, `STAGING_VERTEX_LOCATION`, and
`STAGING_VERTEX_ENDPOINT_ID`; optionally set `STAGING_VERTEX_MODEL`. The
workflow leaves Vertex unconfigured if the first three values are all empty,
and rejects a partial configuration. The configured endpoint is ordered first
in the provider priority list.

Use the endpoint for the checkpoint selected as the tuned model's default in
Model Registry. Copy the endpoint location and endpoint ID from that endpoint's
details. Don't put credentials in the browser, the repository, or a client-side
environment variable.

On Cloud Run, grant the service's runtime service account permission to call
Vertex AI (`roles/aiplatform.user`) in the model project. The backend gets
short-lived Application Default Credentials from the Cloud Run metadata
server. No long-lived service account JSON key is used. For `eu` and `us`
multi-region endpoint locations, the adapter uses the corresponding
`aiplatform.<location>.rep.googleapis.com` hostname; for regional locations it
uses `<location>-aiplatform.googleapis.com`.

The endpoint API is called directly by `services/providerManager.js` using the
Gemini `generateContent` request format. If no endpoint is configured, Vertex
is omitted from provider availability. If the endpoint returns an error, the
gateway follows `AI_PRIORITY` and records which provider answered; remove other
providers from the priority list if you want Vertex-only routing.

## Learning behavior

- Long-term memory is stored per account in the existing memory repository and
  retrieved into that user's ordinary Sentinel chat when relevant. Guests do
  not receive another user's memory. Memory changes answers immediately, but
  does not change model weights.
- Conversation examples and evaluations continue through the existing training
  and review pipeline. Captured examples are candidates; they are not
  automatically treated as correct training labels.
- A later fine-tune is a separate Vertex job. Evaluate a new checkpoint on a
  held-out set, compare it to the current endpoint, and switch the configured
  endpoint only after it passes the release gate. Keep the previous endpoint
  ID available for rollback.

## Verification

After configuring and deploying the backend, check `/api/health` and
`/api/ai/providers`, then send one ordinary `/api/chat` request. Confirm its
response reports `provider: "vertex"`, the expected model, and non-null usage.
Send an invalid endpoint ID in staging to confirm errors are visible and
fallback behavior matches the configured priority. Check Cloud Run scaling has
minimum instances set to `0`; do not set a scheduled ping or uptime monitor that
keeps the service warm.
