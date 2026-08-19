import { execFile } from "node:child_process";
import path from "node:path";

import { serve } from "@hono/node-server";
import { prisma, seedProductDefaults } from "@repo/db";
import { verifyInternalSecret } from "@repo/internal-auth";
import { Hono } from "hono";
import { z } from "zod";

const PORT = 4011;
const JSON_COLUMNS = new Set([
  "brief",
  "can_delegate_to",
  "default_config",
  "default_policies",
  "metadata",
  "param_hints",
  "payload",
  "proposed",
  "result",
  "skill_ids",
]);

const querySchema = z.object({
  bindings: z.array(z.json()),
  mode: z.enum(["all", "run"]),
  sql: z.string().min(1),
});

const databaseUrl = process.env.DATABASE_URL;
const secret = process.env.AGENTS_FIXTURE_SECRET;

if (databaseUrl === undefined || secret === undefined) {
  throw new Error("DATABASE_URL and AGENTS_FIXTURE_SECRET are required");
}

const parsedDatabaseUrl = new URL(databaseUrl);
const allowedHost =
  parsedDatabaseUrl.hostname === "localhost" || parsedDatabaseUrl.hostname === "127.0.0.1";
if (!allowedHost || parsedDatabaseUrl.searchParams.get("schema") !== "agents_test") {
  throw new Error("Fixture service requires the local agents_test schema");
}

const runDbPush = (repoRoot: string): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(
      "pnpm",
      ["--filter=@repo/db", "exec", "prisma", "db", "push", "--accept-data-loss"],
      { cwd: repoRoot, env: { ...process.env, DATABASE_URL: databaseUrl } },
      (error) => {
        if (error !== null) {
          reject(new Error(error.message, { cause: error }));
          return;
        }
        resolve();
      },
    );
  });

const ensureSchema = async (): Promise<void> => {
  const existing = await prisma.$queryRawUnsafe<Array<{ table_name: string | null }>>(
    "SELECT to_regclass('agents_test.company')::text AS table_name",
  );
  if (existing[0]?.table_name === null || existing[0]?.table_name === undefined) {
    await runDbPush(path.resolve(import.meta.dirname, "../../../.."));
  }
};

const normalizeRow = (row: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (value instanceof Date) {
        return [key, value.getTime()];
      }
      if (JSON_COLUMNS.has(key) && value !== null && typeof value !== "string") {
        return [key, JSON.stringify(value)];
      }
      if (typeof value === "bigint") {
        return [key, Number(value)];
      }
      if (typeof value === "boolean") {
        return [key, value ? 1 : 0];
      }
      return [key, value];
    }),
  );

const resetDatabase = async (): Promise<void> => {
  await prisma.action.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.memoryFact.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.team.deleteMany();
  await prisma.agentInstance.deleteMany();
  await prisma.companyTemplateEntitlement.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.operatorAssignment.deleteMany();
  await prisma.company.deleteMany();
  await prisma.agentTemplate.deleteMany();
  await prisma.skill.deleteMany();
  await seedProductDefaults(prisma);
};

await ensureSchema();

const app = new Hono();

app.use("*", async (c, next) => {
  const auth = verifyInternalSecret({
    expected: secret,
    header: c.req.header("Authorization"),
  });
  if (auth.kind !== "ok") {
    return c.json({ error: "Forbidden" }, 403);
  }
  // oxlint-disable-next-line node/callback-return -- Hono middleware must await downstream handlers before returning control to the framework.
  await next();
  return undefined;
});

app.get("/healthz", (c) => c.json({ status: "ok" }));

app.post("/reset", async (c) => {
  await resetDatabase();
  return c.json({ ok: true });
});

app.post("/query", async (c) => {
  const input = querySchema.parse(await c.req.json());
  if (input.mode === "run") {
    const changes = await prisma.$executeRawUnsafe(input.sql, ...input.bindings);
    return c.json({ meta: { changes }, results: [], success: true });
  }
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    input.sql,
    ...input.bindings,
  );
  return c.json({ results: rows.map(normalizeRow), success: true });
});

app.onError((error, c) => c.json({ error: error.message }, 500));

const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: PORT });

const handleShutdown = async (): Promise<void> => {
  server.close();
  await prisma.$disconnect();
};

process.on("SIGINT", () => {
  // oxlint-disable-next-line no-void -- Node signal listeners cannot return the shutdown promise, but disconnecting Prisma keeps the process alive until cleanup finishes.
  void handleShutdown();
});
process.on("SIGTERM", () => {
  // oxlint-disable-next-line no-void -- Node signal listeners cannot return the shutdown promise, but disconnecting Prisma keeps the process alive until cleanup finishes.
  void handleShutdown();
});
