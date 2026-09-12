# PostgreSQL connection budget

All 20 database consumers in the backend use `services/databasePool.js`. For the
same connection string and TLS settings, they borrow one pool per Node process.
The former implementation created one pool per module, each with pg's default
maximum of 10. Pools connect lazily; those defaults were potential capacity,
not a measurement of simultaneous connections.

## Current defaults

| Setting | Default | Purpose |
| --- | --- | --- |
| `DB_POOL_MAX` | `2` | Total concurrent database clients for all modules in one process |
| `DB_POOL_IDLE_TIMEOUT_MS` | `10000` | Ten-second idle timeout; CPU suspension can delay timer processing |
| `DB_POOL_CONNECTION_TIMEOUT_MS` | `5000` | Bound the wait for an available client or new connection |
| `application_name` | `panthorium-backend` | Identify application connections in `pg_stat_activity` |

The application queues database requests when both clients are busy. This trades
some database concurrency for capacity headroom; it does not limit HTTP requests
to two. A queue timeout is surfaced to the caller, with no fallback to volatile
storage. SQL transactions keep their checked-out client and release it in
`finally`. SIGTERM/SIGINT stop scheduling work, drain HTTP requests, then close
the shared pools, with a nine-second shutdown deadline.

The observed Cloud SQL settings were `max_connections=25`,
`superuser_reserved_connections=3`, `reserved_connections=0`: at most 22 general
connections for **all** clients, including Google-managed connections and tools.
The observed Cloud Run service and revision maximums were both 3 instances.

For the current single-process container and one database identity, the new
nominal application budget is **3 instances × 2 clients = 6**. For illustration,
six overlapping processes would use at most 12 application clients. Cloud Run
can temporarily exceed its scaling target, so this is a planning example, not a
global hard cap. Recalculate before raising the pool size, scaling limits,
worker count, or adding another service against the same database.

## Rollout and verification

1. Merge after the PostgreSQL regression and existing CI checks pass. The deploy
   workflow preserves existing environment and scaling settings. If Cloud Run
   already has `DB_POOL_MAX` set, confirm it is `2`; otherwise the code default
   applies without adding a secret or changing the database.
2. Confirm the new revision becomes Ready and serves traffic. The first rollout
   still overlaps containers using the old independent pools. If capacity is
   exhausted, inspect sessions/revisions before attempting another deployment.
3. In PostgreSQL, observe connections during requests and a later deployment:

   ```sql
   SELECT application_name, state, count(*) AS connections
   FROM pg_stat_activity
   WHERE usename = 'panthorium_app'
   GROUP BY application_name, state
   ORDER BY connections DESC;
   ```

   New application sessions are named `panthorium-backend`. A quiet snapshot
   alone cannot establish the maximum reached during deployment.
4. After the new revision is stable and old containers have drained, remove the
   temporary reserved-slot role granted during the incident, using an authorized
   database administrator:

   ```sql
   REVOKE pg_use_reserved_connections FROM panthorium_app;
   ```

   With `reserved_connections=0`, that role adds no reserved slots. Do not grant
   superuser or increase `max_connections` to compensate for independent pools.

## Regression checks

`npm test` includes pool configuration/sharing checks and the existing suite.
The `PostgreSQL pool regression` workflow starts disposable PostgreSQL 18 and
runs `test/database-pool-integration.js`. It boots all database modules, checks
HTTP readiness, exhausts/releases the pool, measures database sessions under
concurrent queries, tests transaction rollback and idle-client disconnect
recovery, then checks that pool shutdown releases connections. The integration
test requires `DATABASE_POOL_TEST_URL` and must only target a disposable test
database; it creates application tables.

References: [node-postgres pool API](https://node-postgres.com/apis/pool),
[pool sizing](https://node-postgres.com/guides/pool-sizing),
[Cloud Run maximum instances](https://docs.cloud.google.com/run/docs/configuring/max-instances).
