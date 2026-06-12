import { getAgentByName } from "agents";
import { Hono } from "hono";
import { z } from "zod";

import { logActivity } from "@/activity/log";
import { materializeTeam } from "@/db/team";
import { validateSession, type ValidatedSession } from "@/lib/auth";
import { parseBrief } from "@/lib/company-brief";

// Team confirm. The customer goes through the Planner debrief, picks the
// templates from the proposed candidates, and POSTs here to materialize the
// Team. Re-plan = the same call with a different templateIds set; the
// idempotent materializer + status flip handle both first-time and re-plan.

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

  const company = await c.env.DB.prepare("SELECT status, brief FROM company WHERE id = ?")
    .bind(companyId)
    .first<{ brief: string | null; status: string }>();
  if (!company) {
    return c.text("Not found", 404);
  }

  let team;
  try {
    team = await materializeTeam(c.env.DB, {
      companyId,
      templateIds: parsed.data.templateIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 400);
  }

  await c.env.DB.prepare("UPDATE company SET status = 'active', updated_at = ? WHERE id = ?")
    .bind(Date.now(), companyId)
    .run();

  // Seed the Correspondent's memory with the brief so its first turn knows
  // who the customer is. RPC failure is logged but doesn't fail the confirm
  // — the brief stays in D1, the Correspondent re-reads it on next access.
  try {
    const brief = parseBrief(company.brief);
    const corr = await getAgentByName(c.env.CORRESPONDENT, companyId);
    await corr.seedMemory({
      brief,
      debriefSummary: "Time confirmado via onboarding.",
    });
  } catch (error) {
    // oxlint-disable-next-line no-console
    console.error("[teams] seedMemory RPC failed (best-effort)", { companyId, error });
  }

  await logActivity(c.env, {
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
