import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

if (env.TEST_MIGRATIONS) {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
}

beforeEach(async () => {
  if (env.SESSIONS) {
    const list = await env.SESSIONS.list();
    await Promise.all(list.keys.map((k) => env.SESSIONS.delete(k.name)));
  }
});
