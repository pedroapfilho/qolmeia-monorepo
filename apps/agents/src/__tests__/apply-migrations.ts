import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

// Seeds each test's isolated D1 storage with the schema before tests run.
if (env.TEST_MIGRATIONS) {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
}

// The SESSIONS KV cache is shared across tests by default. Clear it before
// each so the validateSession cache layer doesn't bleed state between
// tests that all use the same cf_session=tok token in their fixtures.
beforeEach(async () => {
  if (env.SESSIONS) {
    const list = await env.SESSIONS.list();
    await Promise.all(list.keys.map((k) => env.SESSIONS.delete(k.name)));
  }
});
