import { applyD1Migrations, env } from "cloudflare:test";

// Seeds each test's isolated D1 storage with the schema before tests run.
if (env.TEST_MIGRATIONS) {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
}
