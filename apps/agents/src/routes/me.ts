import {
  briefCompleteness,
  companyBriefSchema,
  mergeBrief,
  parseBrief,
} from "@repo/worker-api/brief";
import type { TeamMemberView } from "@repo/worker-api/contracts";
import { type Context, Hono } from "hono";

import { listActivity } from "#/activity/log";
import { getDb } from "#/db/client";
import { listEntitledActiveTemplates } from "#/db/template";
import {
  fetchMe,
  requireCustomerForWrites,
  requireSession,
  type ValidatedSession,
} from "#/lib/auth";
import { logError } from "#/lib/logger";
import { parsePositiveInt } from "#/lib/pagination";
import { meAssetsRoutes } from "#/routes/me-assets";
import {
  hireTeamMember,
  hireTeamMemberSchema,
  setTeamMemberStatus,
  teamMemberPatchSchema,
  updateTeamMember,
} from "#/team/commands";
import { TEAM_ERROR_STATUS, TeamDomainError } from "#/team/errors";
import { subscribeTeamEvents } from "#/team/events";
import { getCatalogue, getMemberDetail, getTeamRoster } from "#/team/queries";

type MeEnv = { Bindings: Env; Variables: { session: ValidatedSession } };

const respondToTeamCommand = async (c: Context<MeEnv>, command: Promise<TeamMemberView>) => {
  try {
    return c.json({ member: await command });
  } catch (error) {
    if (error instanceof TeamDomainError) {
      return c.json({ error: error.publicMessage }, TEAM_ERROR_STATUS[error.code]);
    }
    throw error;
  }
};

const meRoutes = new Hono<MeEnv>();

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

meRoutes.post("/team/hire", async (c) => {
  const session = c.get("session");
  const parsed = hireTeamMemberSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body" }, 400);
  }
  return respondToTeamCommand(
    c,
    hireTeamMember(c.env, getDb(c.env), {
      actorId: session.userId,
      companyId: session.companyId,
      displayName: parsed.data.displayName,
      templateId: parsed.data.templateId,
    }),
  );
});

meRoutes.patch("/team/members/:id", async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");
  const parsed = teamMemberPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body" }, 400);
  }
  return respondToTeamCommand(
    c,
    updateTeamMember(c.env, getDb(c.env), {
      agentInstanceId: id,
      companyId: session.companyId,
      displayName: parsed.data.displayName,
      editedBy: "customer",
      operatorId: null,
      promptOverride: parsed.data.promptOverride,
    }),
  );
});

meRoutes.get("/team/members/:id", async (c) => {
  const session = c.get("session");
  const member = await getMemberDetail(getDb(c.env), session.companyId, c.req.param("id"));
  if (!member) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ member });
});

meRoutes.post("/team/members/:id/pause", (c) => {
  const session = c.get("session");
  return respondToTeamCommand(
    c,
    setTeamMemberStatus(c.env, getDb(c.env), {
      actorId: session.userId,
      agentInstanceId: c.req.param("id"),
      companyId: session.companyId,
      status: "paused",
    }),
  );
});

meRoutes.post("/team/members/:id/resume", (c) => {
  const session = c.get("session");
  return respondToTeamCommand(
    c,
    setTeamMemberStatus(c.env, getDb(c.env), {
      actorId: session.userId,
      agentInstanceId: c.req.param("id"),
      companyId: session.companyId,
      status: "active",
    }),
  );
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

meRoutes.route("/", meAssetsRoutes);

export { meRoutes };
