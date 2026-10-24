"use strict";

const assert = require("node:assert/strict");
const { randomUUID, randomBytes, createHash } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const { PostgresAuthRepository } = require("../repositories/authRepository");
const { AuthService } = require("../services/authService");
const { AccountAdminService } = require("../services/accountAdminService");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function main() {
  // Never use DATABASE_URL here: only a deliberately selected test database.
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    if (process.env.CI) throw new Error("TEST_DATABASE_URL is required for the PostgreSQL auth security gate in CI");
    console.log("SKIP PostgreSQL auth security: TEST_DATABASE_URL is not set. Real transaction/concurrency checks were not run.");
    return;
  }
  const schema = "panthorium_auth_ci_" + randomBytes(10).toString("hex");
  const adminPool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  let pool;
  let created = false;
  try {
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000, options: `-c search_path=${schema},public -c statement_timeout=15000` });
    const repository = Object.create(PostgresAuthRepository.prototype);
    repository.pool = pool;
    await repository.init();
    const userId = randomUUID();
    const actorId = randomUUID();
    const user = await repository.createUser({ id: userId, username: "security-fixture", passwordHash: await bcrypt.hash("Initial-test-password", 4), roles: [], permissions: ["chat"] });

    // Exercise the additive migration with a pre-existing legacy refresh row.
    await pool.query("ALTER TABLE panthorium_refresh_tokens DROP COLUMN account_version");
    const legacyHash = sha256("legacy-refresh-fixture");
    await pool.query("INSERT INTO panthorium_refresh_tokens(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '1 day')", [randomUUID(), userId, legacyHash]);
    await repository.init();
    assert.equal((await repository.consumeRefreshToken(legacyHash)).accountVersion, null);

    const auth = new AuthService({ repository, config: { jwtSecret: "test-only-postgres-auth-security-key", accessTokenTtl: "15m", refreshTokenDays: 1 }, audit: { record() {} } });
    const accounts = new AccountAdminService(auth, pool);
    await accounts.init();
    auth.accountPolicy = (id) => accounts.policy(id);
    auth.validateAccountPrincipal = (principal) => accounts.validate(principal);
    auth.invalidateAccountSessions = (id, actor, options) => accounts.invalidate(id, actor, options);
    const first = await auth.issueSession(user);
    const firstPrincipal = auth.verifyAccessToken(first.accessToken);
    assert.equal(firstPrincipal.accountVersion, 0);
    assert.equal((await pool.query("SELECT account_version FROM panthorium_refresh_tokens WHERE user_id=$1", [userId])).rows[0].account_version, 0);

    // If any transaction statement fails after the password update and token
    // deletion, all three recovery changes must roll back together.
    const originalHash = (await repository.findUserById(userId)).passwordHash;
    accounts.pool = {
      query: (...args) => pool.query(...args),
      connect: async () => {
        const client = await pool.connect();
        return {
          query: (sql, values) => {
            if (sql.startsWith("INSERT INTO panthorium_account_policies")) throw new Error("injected_policy_write_failure");
            return client.query(sql, values);
          },
          release: () => client.release()
        };
      }
    };
    await assert.rejects(() => accounts.invalidate(userId, actorId, { passwordHash: "must-not-commit" }), /injected_policy_write_failure/);
    accounts.pool = pool;
    assert.equal((await repository.findUserById(userId)).passwordHash, originalHash);
    assert.equal((await accounts.policy(userId)).credentialVersion, 0);
    assert.equal((await pool.query("SELECT COUNT(*)::integer AS count FROM panthorium_refresh_tokens WHERE user_id=$1", [userId])).rows[0].count, 1);
    assert.equal((await accounts.history(userId)).length, 0);

    await auth.resetManagedUserPassword(userId, "Replacement-test-password", actorId);
    assert.equal((await accounts.policy(userId)).credentialVersion, 1);
    assert.equal((await repository.listActiveSessions()).length, 0);
    await assert.rejects(() => accounts.validate(firstPrincipal), /account_session_revoked/);
    assert.equal(await auth.refresh(first.refreshToken), null);
    assert.equal(await auth.login(user.username, "Initial-test-password"), null);
    const current = await auth.login(user.username, "Replacement-test-password");
    assert.equal(auth.verifyAccessToken(current.accessToken).accountVersion, 1);

    // A refresh inserted after reset still cannot resume an older generation.
    const delayedOldRefresh = await auth.issueRefreshToken({ id: userId, accountVersion: 0 });
    await pool.query("UPDATE panthorium_refresh_tokens SET created_at=NOW()+INTERVAL '1 hour' WHERE token_hash=$1", [sha256(delayedOldRefresh)]);
    await assert.rejects(() => auth.refresh(delayedOldRefresh), /account_session_revoked/);

    // Same-millisecond reset and valid refresh must be decided by generation,
    // not rejected by the legacy timestamp fallback.
    const policy = await accounts.policy(userId);
    await pool.query("UPDATE panthorium_refresh_tokens SET created_at=$2 WHERE token_hash=$1", [sha256(current.refreshToken), policy.sessionsRevokedAt]);
    const refreshed = await auth.refresh(current.refreshToken);
    assert.equal(auth.verifyAccessToken(refreshed.accessToken).accountVersion, 1);
    assert.equal(await auth.refresh(current.refreshToken), null, "refresh rotation is single-use");

    // Missing users must not leave a new policy or audit row behind.
    const missingId = randomUUID();
    await assert.rejects(() => accounts.invalidate(missingId, actorId, { passwordHash: "unused-fixture-hash" }), /user_not_found/);
    assert.equal((await pool.query("SELECT * FROM panthorium_account_policies WHERE user_id=$1", [missingId])).rowCount, 0);
    assert.equal((await accounts.history(missingId)).length, 0);

    // Separate service instances represent distinct workers sharing PostgreSQL.
    // All revocations must advance one generation without lost updates.
    const otherAccounts = new AccountAdminService(auth, pool);
    await otherAccounts.init();
    const resets = await Promise.all(Array.from({ length: 6 }, (_, index) => (index % 2 ? accounts : otherAccounts).invalidate(userId, actorId)));
    assert.equal((await accounts.policy(userId)).credentialVersion, 7);
    assert.equal(resets.reduce((sum, result) => sum + result.revokedSessions, 0), 1);
    assert.equal((await repository.listActiveSessions()).length, 0);
    await assert.rejects(() => accounts.validate(auth.verifyAccessToken(refreshed.accessToken)), /account_session_revoked/);
    console.log("PostgreSQL auth security passed: additive refresh migration, atomic reset/rollback, missing-user rollback, generation checks, single-use refresh and concurrent revocation");
  } finally {
    if (pool) await pool.end();
    if (created) await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
