import { seedProductDefaults } from "@repo/db/worker";
import { env } from "cloudflare:test";
import { beforeEach } from "vitest";

import { createSqlFixtureCompat } from "#/__tests__/sql-fixture-compat";
import { getDb } from "#/db/client";

const db = getDb(env);
Object.assign(env, { DB: createSqlFixtureCompat(db) });

beforeEach(async () => {
  await db.action.deleteMany();
  await db.activityLog.deleteMany();
  await db.memoryFact.deleteMany();
  await db.teamMember.deleteMany();
  await db.ticket.deleteMany();
  await db.team.deleteMany();
  await db.agentInstance.deleteMany();
  await db.companyTemplateEntitlement.deleteMany();
  await db.asset.deleteMany();
  await db.operatorAssignment.deleteMany();
  await db.company.deleteMany();
  await db.agentTemplate.deleteMany();
  await db.skill.deleteMany();
  await seedProductDefaults(db);
  const keys = await env.SESSIONS.list();
  await Promise.all(keys.keys.map(({ name }) => env.SESSIONS.delete(name)));
});
