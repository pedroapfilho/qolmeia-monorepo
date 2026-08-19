import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "#/db/client";
import { requireCustomerForWrites, requireSession, type ValidatedSession } from "#/lib/auth";
import { seedCompanyMemory } from "#/team/seed-memory";

type Vars = { session: ValidatedSession };

const teamsRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

teamsRoutes.use("*", requireSession);
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

  let result;
  try {
    result = await getDb(c.env)("teams.confirm", {
      actorId: session.userId,
      companyId,
      templateIds: parsed.data.templateIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 400);
  }

  try {
    await seedCompanyMemory(c.env, companyId, {
      brief: result.brief,
      debriefSummary: "Time confirmado via onboarding.",
    });
  } catch (error) {
    // oxlint-disable-next-line no-console
    console.error("[teams] seedCompanyMemory failed (best-effort)", { companyId, error });
  }

  return c.json({ team: result.team });
});

export { teamsRoutes };
