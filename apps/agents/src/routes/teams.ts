import { Hono } from "hono";
import { z } from "zod";

import { logActivity } from "#/activity/log";
import { getDb } from "#/db/client";
import { materializeTeam } from "#/db/team";
import { requireCustomerForWrites, validateSession, type ValidatedSession } from "#/lib/auth";
import { parseBrief } from "#/lib/company-brief";
import { seedCompanyMemory } from "#/team/seed-memory";

type Vars = { session: ValidatedSession };

const teamsRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

teamsRoutes.use("*", async (c, next) => {
  const session = await validateSession(c.req.raw, c.env);
  if (!session) {
    return c.text("Unauthorized", 401);
  }
  c.set("session", session);
  return next();
});

teamsRoutes.use("*", requireCustomerForWrites);

const confirmBodySchema = z.object({
  templateIds: z.array(z.string().min(1)).min(1).max(20),
});

teamsRoutes.post("/:companyId/confirm", async (c) => {
  const companyId = c.req.param("companyId");
  const session = c.get("session");
  if (session.companyId !== companyId) {
    return c.text("Forbidden", 403);
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const parsed = confirmBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
  }

  const db = getDb(c.env);
  const company = await db.company.findUnique({
    select: { brief: true, status: true },
    where: { id: companyId },
  });
  if (!company) {
    return c.text("Not found", 404);
  }

  let team;
  try {
    team = await materializeTeam(db, {
      companyId,
      templateIds: parsed.data.templateIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 400);
  }

  await db.company.update({ data: { status: "active" }, where: { id: companyId } });

  try {
    const brief = parseBrief(company.brief);
    await seedCompanyMemory(c.env, companyId, {
      brief,
      debriefSummary: "Time confirmado via onboarding.",
    });
  } catch (error) {
    // oxlint-disable-next-line no-console
    console.error("[teams] seedCompanyMemory failed (best-effort)", { companyId, error });
  }

  await logActivity(db, {
    actorId: session.userId,
    companyId,
    payload: { templateIds: parsed.data.templateIds, ...team },
    refId: team.teamId,
    refType: "team",
    summary: "Time confirmado.",
    type: "TEAM_CONFIRMED",
  });

  return c.json({ team });
});

export { teamsRoutes };
