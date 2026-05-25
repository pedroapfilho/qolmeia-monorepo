import { Hono } from "hono";

import { listActiveTemplates } from "@/db/template";
import { validateSession, type ValidatedSession } from "@/lib/auth";
import { parseBrief } from "@/lib/company-brief";

// Authenticated-user introspection endpoints — what the client needs to
// route between the Planner and the Correspondent. The auth service still
// owns identity; this Worker route owns *company* state (onboarding/active)
// and the live template catalog.
//
// P7.0: GET /api/me relays the full MeResponse from the auth service so the
// client can target apps/agents instead of apps/api. Cosmetic step toward
// retiring apps/api's non-auth surface; membership data still comes from
// Postgres via the relay until full ownership moves to D1 in a later phase.

type Vars = { session: ValidatedSession };

const meRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

// Public relay — registered before the gating middleware so it handles its
// own auth (a pass-through, not a parsed-and-rebuilt response).
meRoutes.get("/", async (c) => {
  const tokenParam = new URL(c.req.url).searchParams.get("cf_session");
  const cookieHeader = c.req.header("Cookie");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (tokenParam) {
    headers.Authorization = `Bearer ${tokenParam}`;
  } else if (cookieHeader) {
    headers.Cookie = cookieHeader;
  } else {
    return c.text("Unauthorized", 401);
  }
  let response: Response;
  try {
    response = await fetch(`${c.env.AUTH_SERVICE_URL}/api/v1/me`, { headers });
  } catch (error) {
    // oxlint-disable-next-line no-console
    console.error("[/api/me] relay failed", { error });
    return c.text("Auth service unreachable", 502);
  }
  return new Response(response.body, {
    headers: { "Content-Type": "application/json" },
    status: response.status,
  });
});

// Everything below is gated by the same session validator that /agents uses.
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
