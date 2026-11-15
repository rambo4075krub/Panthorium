# Security response boundaries

IP blocks apply before authentication to `/api`, `/oauth` and `/mcp`, including
guest creation, refresh and existing access tokens. Block lookup failure returns
503. Readiness and static recovery pages remain reachable. Live WebSocket
upgrades check the block; established voice sessions recheck the block and
session every 30 seconds and before authenticated tool execution.

The notebook edge and backend must remain bound to loopback behind Cloudflare
Tunnel. With `TRUST_PROXY=1`, client identity comes only from a valid
`CF-Connecting-IP` received over loopback. `X-Forwarded-For`, `Forwarded` and
`X-Real-IP` do not select a security identity. Direct non-loopback peers always
use their socket address. A different hosting/proxy topology requires its own
explicit verified identity contract. Do not expose the notebook backend or edge
directly on the network.

All addresses are validated and canonicalized, including hexadecimal IPv4-mapped
IPv6. One-time transactional migrations normalize historical audit addresses and
merge duplicate blocks while retaining their longest expiration. Mixed block
ownership becomes `migrated`, preventing an old automated undo from deleting a
manual block. Detection aggregates the entire time window; the audit log page's
500-row display limit does not affect alerts or automatic blocking.

Registered-user JWTs contain `sid`. The refresh row is also the durable session:
rotation atomically consumes its token and replaces the hash without changing
the session ID. Deletion cannot be undone by a concurrent refresh. Every API
authentication validates the live session and current account policy. Logout and
single-session revocation invalidate both access and refresh. Legacy tokens
without a session ID require one new login after deployment. Account-wide
revocation and password resets retain their generation checks.

An administrator cannot manually block their current canonical IP. Loopback
addresses cannot be blocked. For recovery on the Windows notebook, use the
current backend loopback address from `Host/<stage>/active.json`, authenticate as
an administrator and remove the block in Security. Authentication, role checks
and founder protection still apply; there is no recovery password or role bypass.

Deploy to staging through the CI-published notebook ref first. The controller
backs up the database and uploads, tests a private restored database and checks
the new process before switching the edge. Confirm the active release receipt,
then promote the same changes to main. Follow the controller's existing rollback
procedure; never restore a database snapshot automatically after public exposure.

Regression gates: `test/security-boundaries.js`,
`test/security-boundaries-postgres.js`, `test/security-auth-postgres.js`,
`test/security-auth-recovery.js`, `test/local-insights-postgres.js`, and the
bounded full-application attack simulation against disposable PostgreSQL.
