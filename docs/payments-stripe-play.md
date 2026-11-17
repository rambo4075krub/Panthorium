# Panthorium payments on the notebook server

The production backend and PostgreSQL database run on the operator's notebook. Cloudflare Tunnel routes `panthorium.net` to the existing notebook edge. This integration does not deploy Cloud Run, enable retired GCP services, move the database, or change the notebook deployment controller. The existing `Publish notebook release` workflow remains the release path.

## Browser and desktop

`BILLING_PROVIDER=stripe` selects hosted Checkout. Until configuration is verified, checkout stays disabled. The server uses Stripe API `2026-10-28.endive` and the pinned Node SDK. Server-side catalog snapshots fix each order's product, amount, currency, policy version and accepted terms. All products, including month-long access, use one-time payments; there are no subscriptions, automatic renewal, or automatic top-ups.

The client first accepts the displayed terms, then creates a session. The separate Stripe page collects payment details. The return page is informational. Only a verified provider result grants account entitlements. Pending orders can be resumed from the authenticated account. Electron requires the updated native bridge to open the system browser; old versions display an update instruction. Native Android never opens a Stripe checkout link for these digital goods.

## Runtime configuration

| Setting | Meaning |
| --- | --- |
| `BILLING_PROVIDER` | `stripe` to select the new web checkout; otherwise legacy Omise remains selected |
| `STRIPE_MODE` | `test` or `live`, exactly matching the key and webhook |
| `STRIPE_LIVE_ENABLED` | `1` is additionally required for live payments |
| `STRIPE_SECRET_KEY` | Restricted server API key; never a client/public value |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the exact endpoint and mode |
| `STRIPE_PUBLIC_ORIGIN` | `https://panthorium.net`, or the preview origin for tests |

Use a dedicated Stripe sandbox for provider tests. Staging must never contain live credentials. Store credentials using the existing Windows DPAPI runtime configuration, not source control, chat, frontend files, build artifacts or command-line arguments. `ops/payments/configure-notebook-stripe.ps1` reads hidden input, verifies the account and Checkout read access, preserves existing runtime settings and writes an encrypted backup. It does not restart the running server. Supply `-ExpectedAccount` with the selected live or sandbox account ID; the script rejects a key belonging to a different account. No live charges are used as tests.

The restricted key needs access to create/read/expire Checkout Sessions and the related inline Products/Prices/PaymentIntents, plus read access to Charges, Balance Transactions, Refunds and Disputes. The setup probe also reads the account identity. Start from restricted permissions, verify the sandbox flow, and grant only permissions required by the observed operations. The integration does not initiate refunds, payouts, or transfers.

Create the webhook at `/api/billing/stripe/webhook` on the corresponding HTTPS origin with:

```
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
charge.refunded
charge.dispute.created
charge.dispute.updated
charge.dispute.closed
```

Preserve the raw request body through proxies. The endpoint verifies Stripe's signature and mode, then retrieves current payment data with the server key. It checks stored IDs, catalog amount/currency, metadata and captured payment before updating grants. Temporary failures return an error so Stripe can retry; do not acknowledge a failed database update. Keep the notebook and tunnel available. After an outage, verify webhook delivery retries and reconcile pending orders before accepting additional payments.

## Google Play app

The Android bridge uses Play Billing 9.1.0, one-time products and server verification. Product IDs are `panthorium_` followed by the catalog ID with hyphens replaced by underscores, such as `panthorium_life` and `panthorium_work_pro`. Create all enabled products in the correct Play Console application, with one ordinary buy option and the exact displayed THB price. Multi-quantity, rentals, automatic subscriptions and promotional purchase types are not supported. Provider-verified Play Points discounts are accepted only when the returned coupon or percentage exactly reconciles the catalog price; the cash ledger records the actual paid amount, including zero cash for points-only purchases. The native client checks the freshly queried price and currency before launching the Google purchase sheet.

Required runtime settings are `GOOGLE_PLAY_BILLING_ENABLED=1`, `GOOGLE_PLAY_BILLING_MODE=test|live`, a stable random 32-byte `GOOGLE_PLAY_RECEIPT_KEY` encoded as 64 hex characters, and `GOOGLE_PLAY_SERVICE_ACCOUNT_FILE` pointing to protected server credentials with the Play Developer API permissions needed for product reads, purchase/order reads and consumption. Grant access to `com.panthorium.browser` in Play Console. This uses Google's Play API; it does not require Cloud Run or Cloud SQL.

Keep Play disabled until the store catalog, API credentials and internal-test release are verified. Test mode accepts only license tester purchases and never grants production quotas. Live mode rejects test, promo and rewarded purchase types. Google-provided purchase state, account/profile binding, quantity, order amount and product must match before granting. The encrypted receipt and its unique hash prevent replay. The server consumes a one-time purchase only after the entitlement transaction commits. Restore checks unconsumed purchases when the package page opens and from the restore button. The notebook polls recorded active purchases every five minutes to recover pending transactions and reconcile refunds. A purchase completed before its token reaches the backend requires opening restore in the original account; Google may refund an unacknowledged purchase if it is not recovered in time. Verify this flow on actual Play test devices before enabling live purchase.

## Policy and operations

Privacy/Policy 3.15 is shared by the public page and in-app view. New purchases do not offer discretionary refunds for a change of mind, non-use or unused quota. Statutory rights and payment-provider/store dispute processes remain applicable. Existing purchases retain their accepted terms. A provider-confirmed refund, including a partial refund, revokes that order's grant; disputes suspend it, and a won dispute restores the original unexpired grant without resetting usage or expiry. If two paid membership orders conflict, the second is marked for operator review and does not overwrite the active membership.

The finance view includes Stripe, Google Play and historical Omise orders. Verified income/refund references are recorded once. Processor fees and payouts still require their actual accounting records. Sandbox transactions are excluded from the production ledger. Do not delete old orders during a provider migration.

## Validation before activation

Run `npm run check`, `npm test`, `npm run test:postgres` against an explicitly isolated `TEST_DATABASE_URL`, and the Android release build smoke check. Run a real sandbox checkout and licensed Play test purchase, including cancel/pending/duplicate callback/restore/refund cases. Verify no production entitlement is created by either test mode. Confirm signed webhook delivery and account ownership on the notebook backend. Enable live settings only after provider tests pass and the correct release is active.
