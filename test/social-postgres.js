"use strict";
const { Pool } = require("pg");
const { randomBytes } = require("node:crypto");
const { SocialRepository } = require("../services/socialRepository");
const { suite } = require("./social-service");
(async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    if (process.env.CI) throw Error("TEST_DATABASE_URL required");
    console.log("SKIP Social PostgreSQL: test database not configured");
    return;
  }
  const schema = "social_test_" + randomBytes(8).toString("hex"),
    admin = new Pool({ connectionString, max: 1 });
  let pool;
  try {
    await admin.query("CREATE SCHEMA " + schema);
    pool = new Pool({
      connectionString,
      max: 6,
      options: "-c search_path=" + schema + ",public",
    });
    await suite(new SocialRepository({ pool }));
    await require("./contact-support").suite(new SocialRepository({ pool }));
    await require("./social-notifications").suite(new SocialRepository({ pool }));
  } finally {
    if (pool) await pool.end();
    await admin.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
    await admin.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
