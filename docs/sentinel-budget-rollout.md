# Sentinel token packages and Extended Live rollout

New purchases use Life THB 189 / 750,000 shared units, Work THB 489 /
2,300,000, and Work Pro THB 1,589 / 8,000,000. Public cards explain these
as maximum input-text tokens or one-fifth as many output-plus-thinking tokens.
These are alternative uses of ONE budget, not separate input/output grants.
Voice, image input, tool results and repeated context use the same budget.
Existing paid snapshots retain their quantities and expiry. Free remains
unlimited until 2026-12-01T00:00:00+07:00; afterwards its 5,000-unit trial
uses a compact latest-question context, no tools, LOW thinking and a short
answer. It is a minimal trial, not a promise of many chat turns.

## Runtime and accounting

`PANTHORIUM_GEMINI_EXTENDED=1` selects only the requested Extended Thinking
model via Google's Developer API, authenticated with the server-only restricted
`PANTHORIUM_GEMINI_API_KEY`. Production startup disables local/hybrid inference
and training. No fallback model is used. Public branding is Sentinel AI;
privacy disclosures identify Google as the external processor.

The exact model rejected TEXT-only setup in real probes. HTTP text chat uses
AUDIO plus transcription and must include that cost. Tool declarations are
NON_BLOCKING and completion waits for interaction_status=IDLE. Tool execution
retains existing account checks and exact-action approval gates.

Reservations precede HTTP, live and private voice-approval dispatch. Shared
PostgreSQL locks prevent concurrent spending of the same allowance. Settlement
returns unused units to the exact original grants. Process crashes or incomplete
provider reports retain durable holds; they do not silently refund unknown cost.
The UI separates available and pending units; pending reservations do not trigger
90/95/100-percent actual-usage alerts. Operators must investigate unresolved
holds against stored numeric usage before manual correction; there is no timed
automatic refund. No prompt, audio, transcript or credential enters these records.

Provider modality details sometimes do not add up to prompt totals, and total
counts sometimes include thoughts and sometimes exclude them. The disclosed
service conversion conservatively prices unclassified input at 4 and output at
14 units/token. Missing transcription counts use UTF-8 bytes as an upper-bound
estimate at 5 units/byte, less any text output already reported. This is a service
quota policy, not a claim of exact Google invoice classification. Each utterance
rebills its context; snapshots within an utterance use per-field maxima. No cache
discount is assumed. Unknown modalities or inconsistent totals stop the session.

Paid requests use MEDIUM thinking, request 1,024 output tokens and accept at most
96,000 estimated context units. Live sessions last at most three minutes and can
be restarted. Provider thinking can exceed the configured output-token limit,
as observed in the full-tool probe: do not treat that parameter as a guaranteed
cost ceiling. Durable overrun evidence stops further dispatch, and pricing keeps
a separate risk reserve. These controls do not guarantee project profitability.

## Validation

- Real paid Developer API text and asynchronous toy-tool replies reached IDLE,
  settled their reservations, and returned unused units.
- Post-promotion Free answered a short Thai question: 5,000 reserved, 4,669 used,
  331 returned in that sample. Actual costs vary by request.
- All 62 current live tool schemas were accepted; an arithmetic request called
  the calculator and finished: 114,064 reserved, 87,879 used. The maximum schema
  fixture contains 78,049 UTF-8 bytes. This is a bounded synthetic test, not a
  claim that every external connector or user operation has been exercised.
- Model probes used temporary service-restricted keys, deleted afterwards.
- Isolated PostgreSQL tests cover concurrent reservations, durable holds,
  exactly-once refunds, overrun evidence, period rollover and promotion.
- HTTP and gateway tests cover pre-dispatch reservation, asynchronous tools,
  IDLE handling, queued usage during disconnect and disabling other models.
- Existing billing, approval, policy and application regressions run in npm test
  and GitHub CI before the deployment publisher can advance the notebook ref.

## Activation and known limits

1. Pass PR and main CI. Use `ops/ai/configure-notebook-extended.ps1` to create
   a service-restricted production key in the existing encrypted configuration.
   It never prints or accepts a key in chat. Deployment is still required.
2. The normal CI publisher advances deploy/notebook-production; the notebook
   backs up/restores a test copy, runs its probes, drains, swaps and health-checks.
   Verify the actual activated SHA and served catalog, not just CI success.
3. Stripe already uses server-side inline price_data; the catalog controls new
   checkouts. Do not change or reprice already-paid orders.
4. Google Play remains disabled: the authorized Android Publisher query returned
   403 PERMISSION_DENIED on 2026-11-18. Correct account/service identity access,
   matching store prices and a licensed purchase test are still required.
5. This single Live model does not generate native images or videos. Do not
   advertise those generation features as ready or invoke another model silently.
   Existing supported tools retain their own permissions and availability.
6. Production receipt and cost assumptions belong in the private owner report.
   Historical GCP savings must not be subtracted twice; missing home-server,
   support, tax and store-tier costs prevent a no-loss guarantee.

References: https://aistudio.google.com/docs/models/gemini-3.8-live-extended-thinking
and https://aistudio.google.com/docs/pricing#gemini-3.8-live
