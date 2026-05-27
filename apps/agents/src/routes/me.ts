import { Hono } from "hono";

import { listActivity } from "@/activity/log";
import { listActiveTemplates } from "@/db/template";
import { validateSession, type ValidatedSession } from "@/lib/auth";
import { parseBrief } from "@/lib/company-brief";
import { logError } from "@/lib/logger";
import { buildCacheKey, readCachedString, writeCachedString } from "@/lib/session-cache";

// Authenticated-user introspection endpoints — what the client needs to
// route between the Planner and the Correspondent. The auth service still
// owns identity; this Worker route owns *company* state (onboarding/active)
// and the live template catalog.
//
// GET /api/me relays the full MeResponse from the auth service so the Next
// apps target apps/agents uniformly. The response is cached in KV for
// `RELAY_CACHE_TTL_SECONDS` so multiple page renders in quick succession
// don't drive Better Auth's per-IP rate limit (100/15min on /api/v1/me).
//
// The customer's asset gallery + upload live in routes/me-assets.ts —
// they have a different shape (multipart, multi-step transaction) from
// the small projections here.

const RELAY_CACHE_TTL_SECONDS = 60;
const RELAY_CACHE_NAMESPACE = "me-relay";

type Vars = { session: ValidatedSession };

const meRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

// Public relay — registered before the gating middleware so it handles its
// own auth (a pass-through, not a parsed-and-rebuilt response).
meRoutes.get("/", async (c) => {
  const tokenParam = new URL(c.req.url).searchParams.get("cf_session");
  const cookieHeader = c.req.header("Cookie") ?? null;
  if (!tokenParam && !cookieHeader) {
    return c.text("Unauthorized", 401);
  }

  const cacheKey = await buildCacheKey({
    cookie: cookieHeader,
    namespace: RELAY_CACHE_NAMESPACE,
    token: tokenParam,
  });
  const cached = await readCachedString(c.env, cacheKey);
  if (cached) {
    return new Response(cached, {
      headers: { "Content-Type": "application/json", "X-Cache": "hit" },
      status: 200,
    });
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (tokenParam) {
    headers.Authorization = `Bearer ${tokenParam}`;
  } else if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }
  let response: Response;
  try {
    response = await fetch(`${c.env.AUTH_SERVICE_URL}/api/v1/me`, { headers });
  } catch (error) {
    logError("me.relay.err", {
      error: error instanceof Error ? error.message : String(error),
    });
    return c.text("Auth service unreachable", 502);
  }

  const body = await response.text();
  if (response.ok) {
    await writeCachedString(c.env, cacheKey, body, RELAY_CACHE_TTL_SECONDS);
  }

  return new Response(body, {
    headers: { "Content-Type": "application/json", "X-Cache": "miss" },
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

const parsePositiveInt = (raw: string | undefined, fallback: number, max: number): number => {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
};

meRoutes.get("/activity", async (c) => {
  const { companyId } = c.get("session");
  const limit = parsePositiveInt(c.req.query("limit"), 50, 200);
  const entries = await listActivity(c.env.DB, { companyId, limit });
  return c.json({
    items: entries.map((entry) => ({
      createdAt: new Date(entry.createdAt).toISOString(),
      id: entry.id,
      summary: entry.summary,
      type: entry.type,
    })),
    nextCursor: null,
  });
});

export { meRoutes };
