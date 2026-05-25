import { Hono } from "hono";

import { listActiveTemplates } from "@/db/template";
import { validateSession, type ValidatedSession } from "@/lib/auth";
import { parseBrief } from "@/lib/company-brief";

// Authenticated-user introspection endpoints — what the client needs to
// route between the Planner and the Correspondent. The auth service still
// owns identity (`/api/v1/me`); this Worker route owns *company* state
// (onboarding/active) and the live template catalog.

type Vars = { session: ValidatedSession };

const meRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

meRoutes.use("*", async (c, next) => {
  const session = await validateSession(c.req.raw, c.env);
  if (!session) {
    return c.text("Unauthorized", 401);
  }
  c.set("session", session);
  await next();
});

meRoutes.get("/company", async (c) => {
  const { companyId } = c.get("session");
  const row = await c.env.DB.prepare("SELECT id, status, brief, slug FROM company WHERE id = ?")
    .bind(companyId)
    .first<{ brief: string | null; id: string; slug: string; status: string }>();
  if (!row) {
    return c.json({ error: "company not found" }, 404);
  }
  return c.json({
    company: {
      brief: parseBrief(row.brief),
      id: row.id,
      slug: row.slug,
      status: row.status,
    },
  });
});

meRoutes.get("/templates", async (c) => {
  const templates = await listActiveTemplates(c.env.DB);
  return c.json({
    templates: templates.map((t) => ({
      description: t.description,
      displayName: t.displayName,
      id: t.id,
      workerKind: t.workerKind,
    })),
  });
});

export { meRoutes };
