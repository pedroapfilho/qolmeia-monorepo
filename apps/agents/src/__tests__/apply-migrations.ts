import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";

if (env.TEST_MIGRATIONS) {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
}

beforeEach(async () => {
  const list = await env.SESSIONS.list();
  await Promise.all(list.keys.map((k) => env.SESSIONS.delete(k.name)));
});
