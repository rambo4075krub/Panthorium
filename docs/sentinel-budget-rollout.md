# Sentinel budget migration — not ready for activation

This branch prepares new sale snapshots, a token-oriented explanation, policy
text, modality accounting and a durable reservation primitive. It must not be
merged for production until the model-path and measurement gates below pass.
The reservation primitive is not yet attached to every provider path.

## Prepared values

| Plan | THB / month | Internal shared allowance | Input-text-only maximum | Output-text + thinking-only maximum |
| --- | ---: | ---: | ---: | ---: |
| Free, after promotion | 0 | 5,000 | 5,000 | 1,000 |
| Life | 189 | 750,000 | 750,000 | 150,000 |
| Work | 489 | 2,300,000 | 2,300,000 | 460,000 |
| Work Pro | 1,589 | 8,000,000 | 8,000,000 | 1,600,000 |

The token columns are alternatives from one shared budget, not two allowances.
Voice, image input, repeated context and tools consume the same budget. Existing
order/grant snapshots retain their quantities and expiration. The Free promotion
ends exclusively at 2026-12-01T00:00:00+07:00 and remains unlimited before that.

## Required activation evidence

1. Establish a paid production connection to the exact requested Extended
   Thinking model. Existing provider probes did not establish access. Never
   substitute a different model or expose provider keys to the browser.
2. Capture complete token-only usage for text, audio, image/video input,
   thinking, repeated context, tool responses, cancellation and resumption.
   `UsageAccumulator` requires an explicit verified session/turn contract.
   It does not guess that two similar reports represent duplicate usage.
3. Wire reservations before every provider dispatch, including HTTP, live
   audio, approval audio and background jobs. Bound input/context and output,
   settle only with complete verified evidence, preserve unresolved holds on
   disconnect, and close immediately on overrun. The database primitive alone
   is not an enforced end-to-end cost cap.
4. Implement and test asynchronous NON_BLOCKING calls. `turnComplete` is not
   completion for this model: wait for `interaction_status=IDLE`. Preserve the
   existing authorization and confirmation boundaries for tools.
5. A full current tool prompt can exceed the proposed Free allowance. Compact
   the server context and demonstrate a usable Free request before activation;
   do not ship an allowance that cannot start a supported operation.
6. Verify the Google Play production configuration and matching THB product
   prices before enabling purchase. Stripe uses server-side inline price_data,
   so deploying the catalog changes future checkouts, not existing grants.
7. Native image/video creation is not provided by this single Live model.
   Keep capability reporting truthful; do not add another model as a fallback.
8. Publish the revised policy and token explanation together with the verified
   catalog. General product surfaces use Sentinel AI; privacy disclosures still
   identify the actual external processor.

## Validation performed

- Unit cases: all priced modalities, thoughts, repeated context, duplicate
  reports, ambiguous counters, and asynchronous idle state.
- PostgreSQL in an isolated staging schema: races, held-credit exclusion,
  restart durability, exactly-once refunds, overrun evidence, period rollover
  and promotion. Test-created schema is removed afterwards.
- Existing billing summary, signed checkout, free promotion and public policy
  regressions. These do not substitute for a real-model cost benchmark.

References: https://aistudio.google.com/docs/models/gemini-3.8-live-extended-thinking
and https://aistudio.google.com/docs/pricing#gemini-3.8-live
