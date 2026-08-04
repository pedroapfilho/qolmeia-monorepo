import { Hono } from "hono";
import { z } from "zod";

import { listActivity } from "#/activity/log";
import { getDb } from "#/db/client";
import { listEntitledActiveTemplates } from "#/db/template";
import {
  fetchMe,
  requireCustomerForWrites,
  requireSession,
  type ValidatedSession,
} from "#/lib/auth";
import { briefCompleteness, companyBriefSchema, mergeBrief, parseBrief } from "#/lib/company-brief";
import { logError } from "#/lib/logger";
import { parsePositiveInt } from "#/lib/pagination";
import { meAssetsRoutes } from "#/routes/me-assets";
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

// Registered above requireSession on purpose: this route is how a client
// discovers which orgs it belongs to, so it cannot require a resolved org
// itself. fetchMe still rejects a request that carries no credentials.
meRoutes.get("/", async (c) => {
  const result = await fetchMe(c.req.raw, c.env);
  if (result.kind === "no-credentials") {
    return c.text("Unauthorized", 401);
  }
  if (result.kind === "unreachable") {
    return c.text("Auth service unreachable", 502);
  }

  return new Response(result.body, {
    headers: {
      "Content-Type": "application/json",
      "X-Cache": result.cached ? "hit" : "miss",
    },
    status: result.status,
  });
});

meRoutes.use("*", requireSession);
meRoutes.use("*", requireCustomerForWrites);

meRoutes.get("/company", async (c) => {
  const { companyId } = c.get("session");
  const row = await getDb(c.env).company.findUnique({
    select: { brief: true, id: true, slug: true, status: true },
    where: { id: companyId },
  });
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
  const parsed = briefPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body" }, 400);
  }
  const db = getDb(c.env);
  const row = await db.company.findUnique({
    select: { brief: true, id: true, slug: true, status: true },
    where: { id: session.companyId },
  });
  if (!row) {
    return c.json({ error: "company not found" }, 404);
  }
  const merged = mergeBrief(parseBrief(row.brief), parsed.data);
  await db.company.update({ data: { brief: merged }, where: { id: session.companyId } });
  return c.json({
    company: { brief: merged, id: row.id, slug: row.slug, status: row.status },
    completeness: briefCompleteness(merged),
  });
});

meRoutes.get("/templates", async (c) => {
  const { companyId } = c.get("session");
  const templates = await listEntitledActiveTemplates(getDb(c.env), companyId);
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
    const members = await getTeamRoster(getDb(c.env), companyId);
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
  const templates = await getCatalogue(getDb(c.env), session.companyId);
  return c.json({ templates });
});

const hireSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  templateId: z.string().min(1),
});

meRoutes.post("/team/hire", async (c) => {
  const session = c.get("session");
  const parsed = hireSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body" }, 400);
  }
  try {
    const member = await hireMember(getDb(c.env), {
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
  const id = c.req.param("id");
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body" }, 400);
  }
  try {
    const member = await updateMember(getDb(c.env), {
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
  const member = await getMemberDetail(getDb(c.env), session.companyId, c.req.param("id"));
  if (!member) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ member });
});

meRoutes.post("/team/members/:id/pause", async (c) => {
  const session = c.get("session");
  try {
    const member = await pauseMember(
      getDb(c.env),
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
  try {
    const member = await resumeMember(
      getDb(c.env),
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
  const entries = await listActivity(getDb(c.env), { companyId, limit });
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

// Mounted here rather than a second time at /api/me in app.ts: two mounts on
// one prefix ran both use("*") chains, so every asset request validated its
// session twice.
meRoutes.route("/", meAssetsRoutes);

export { meRoutes };
