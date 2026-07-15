import { Hono } from "hono";
import { z } from "zod";

import { listActivity } from "#/activity/log";
import { listEntitledActiveTemplates } from "#/db/template";
import { validateSession, type ValidatedSession } from "#/lib/auth";
import { briefCompleteness, companyBriefSchema, mergeBrief, parseBrief } from "#/lib/company-brief";
import { logError } from "#/lib/logger";
import { parsePositiveInt } from "#/lib/pagination";
import { buildCacheKey, readCachedString, writeCachedString } from "#/lib/session-cache";
import { emitTeamEvent, subscribeTeamEvents } from "#/team/events";
import {
  CorrespondentMissingError,
  hireMember,
  pauseMember,
  resumeMember,
  TeamMemberNotFoundError,
  TeamMemberNotPausableError,
  TemplateNotFoundError,
  TemplateRetiredError,
  updateMember,
} from "#/team/mutations";
import { getCatalogue, getMemberDetail, getTeamRoster } from "#/team/queries";

const RELAY_CACHE_TTL_SECONDS = 60;
const RELAY_CACHE_NAMESPACE = "me-relay";

type Vars = { session: ValidatedSession };

type TeamMutationErrorResult = { error: string; status: 400 | 404 | 500 };

const teamMutationErrorResponse = (error: unknown): TeamMutationErrorResult | null => {
  if (error instanceof TeamMemberNotPausableError) {
    return { error: error.message, status: 400 };
  }
  if (error instanceof TeamMemberNotFoundError) {
    return { error: "not found", status: 404 };
  }
  if (error instanceof TemplateNotFoundError || error instanceof TemplateRetiredError) {
    return { error: error.message, status: 404 };
  }
  if (error instanceof CorrespondentMissingError) {
    return { error: error.message, status: 500 };
  }
  return null;
};

const meRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

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
    response = await fetch(`${c.env.AUTH_SERVICE_URL}/api/me`, { headers });
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

meRoutes.use("*", async (c, next) => {
  const session = await validateSession(c.req.raw, c.env);
  if (!session) {
    return c.text("Unauthorized", 401);
  }
  c.set("session", session);
  return next();
});

meRoutes.get("/company", async (c) => {
  const { companyId } = c.get("session");
  const row = await c.env.DB.prepare("SELECT id, status, brief, slug FROM company WHERE id = ?")
    .bind(companyId)
    .first<{ brief: string | null; id: string; slug: string; status: string }>();
  if (!row) {
    return c.json({ error: "company not found" }, 404);
  }
  const brief = parseBrief(row.brief);
  return c.json({
    company: {
      brief,
      id: row.id,
      slug: row.slug,
      status: row.status,
    },
    completeness: briefCompleteness(brief),
  });
});

const briefPatchSchema = companyBriefSchema.partial();

meRoutes.patch("/company", async (c) => {
  const session = c.get("session");
  if (session.role !== "CUSTOMER") {
    return c.json({ error: "forbidden" }, 403);
  }
  const parsed = briefPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body" }, 400);
  }
  const row = await c.env.DB.prepare("SELECT id, status, brief, slug FROM company WHERE id = ?")
    .bind(session.companyId)
    .first<{ brief: string | null; id: string; slug: string; status: string }>();
  if (!row) {
    return c.json({ error: "company not found" }, 404);
  }
  const merged = mergeBrief(parseBrief(row.brief), parsed.data);
  await c.env.DB.prepare("UPDATE company SET brief = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(merged), Date.now(), session.companyId)
    .run();
  return c.json({
    company: { brief: merged, id: row.id, slug: row.slug, status: row.status },
    completeness: briefCompleteness(merged),
  });
});

meRoutes.get("/templates", async (c) => {
  const { companyId } = c.get("session");
  const templates = await listEntitledActiveTemplates(c.env.DB, companyId);
  return c.json({
    templates: templates.map((t) => ({
      description: t.description,
      displayName: t.displayName,
      id: t.id,
      workerKind: t.workerKind,
    })),
  });
});

meRoutes.get("/team", async (c) => {
  const { companyId } = c.get("session");
  try {
    const members = await getTeamRoster(c.env.DB, companyId);
    return c.json({ members });
  } catch (error) {
    logError("me.team.failed", {
      companyId,
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({ error: "failed to load team" }, 500);
  }
});

meRoutes.get("/team/events", (c) => {
  const { companyId } = c.get("session");
  return subscribeTeamEvents(c.env, companyId, c.req.raw.signal);
});

meRoutes.get("/catalogue", async (c) => {
  const session = c.get("session");
  const templates = await getCatalogue(c.env.DB, session.companyId);
  return c.json({ templates });
});

const hireSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  templateId: z.string().min(1),
});

meRoutes.post("/team/hire", async (c) => {
  const session = c.get("session");
  if (session.role !== "CUSTOMER") {
    return c.json({ error: "forbidden" }, 403);
  }
  const parsed = hireSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body" }, 400);
  }
  try {
    const member = await hireMember(c.env.DB, {
      actorId: session.userId,
      companyId: session.companyId,
      displayName: parsed.data.displayName,
      templateId: parsed.data.templateId,
    });
    await emitTeamEvent(c.env, {
      companyId: session.companyId,
      reason: "hired",
      type: "team:roster",
    });
    return c.json({ member });
  } catch (error) {
    const mapped = teamMutationErrorResponse(error);
    if (mapped) {
      return c.json({ error: mapped.error }, mapped.status);
    }
    throw error;
  }
});

const patchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  promptOverride: z.union([z.string().trim().min(1).max(20_000), z.null()]).optional(),
});

meRoutes.patch("/team/members/:id", async (c) => {
  const session = c.get("session");
  if (session.role !== "CUSTOMER") {
    return c.json({ error: "forbidden" }, 403);
  }
  const id = c.req.param("id");
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body" }, 400);
  }
  try {
    const member = await updateMember(c.env.DB, {
      agentInstanceId: id,
      companyId: session.companyId,
      displayName: parsed.data.displayName,
      editedBy: "customer",
      operatorId: null,
      promptOverride: parsed.data.promptOverride,
    });
    await emitTeamEvent(c.env, {
      companyId: session.companyId,
      reason: parsed.data.promptOverride === undefined ? "renamed" : "prompt_changed",
      type: "team:roster",
    });
    return c.json({ member });
  } catch (error) {
    const mapped = teamMutationErrorResponse(error);
    if (mapped) {
      return c.json({ error: mapped.error }, mapped.status);
    }
    throw error;
  }
});

meRoutes.get("/team/members/:id", async (c) => {
  const session = c.get("session");
  const member = await getMemberDetail(c.env.DB, session.companyId, c.req.param("id"));
  if (!member) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ member });
});

meRoutes.post("/team/members/:id/pause", async (c) => {
  const session = c.get("session");
  if (session.role !== "CUSTOMER") {
    return c.json({ error: "forbidden" }, 403);
  }
  try {
    const member = await pauseMember(
      c.env.DB,
      session.companyId,
      c.req.param("id"),
      session.userId,
    );
    await emitTeamEvent(c.env, {
      companyId: session.companyId,
      reason: "paused",
      type: "team:roster",
    });
    return c.json({ member });
  } catch (error) {
    const mapped = teamMutationErrorResponse(error);
    if (mapped) {
      return c.json({ error: mapped.error }, mapped.status);
    }
    throw error;
  }
});

meRoutes.post("/team/members/:id/resume", async (c) => {
  const session = c.get("session");
  if (session.role !== "CUSTOMER") {
    return c.json({ error: "forbidden" }, 403);
  }
  try {
    const member = await resumeMember(
      c.env.DB,
      session.companyId,
      c.req.param("id"),
      session.userId,
    );
    await emitTeamEvent(c.env, {
      companyId: session.companyId,
      reason: "resumed",
      type: "team:roster",
    });
    return c.json({ member });
  } catch (error) {
    const mapped = teamMutationErrorResponse(error);
    if (mapped) {
      return c.json({ error: mapped.error }, mapped.status);
    }
    throw error;
  }
});

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
