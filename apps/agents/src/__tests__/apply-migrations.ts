import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";

import { createSqlFixtureCompat, resetSqlFixture } from "#/__tests__/sql-fixture-compat";
import { getDb } from "#/db/client";

const api = getDb(env);
const fixtureConfig = {
  baseUrl: env.TEST_FIXTURE_URL,
  secret: env.TEST_FIXTURE_SECRET,
};
Object.assign(env, { DB: Object.assign(api, createSqlFixtureCompat(fixtureConfig)) });

beforeEach(async () => {
  await resetSqlFixture(fixtureConfig);
  const keys = await env.SESSIONS.list();
  await Promise.allSettled(keys.keys.map(({ name }) => env.SESSIONS.delete(name)));
});
