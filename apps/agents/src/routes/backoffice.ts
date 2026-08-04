import { Hono } from "hono";
import { z } from "zod";

import { ACTIVITY_CATEGORIES, listActivity } from "#/activity/log";
import { getAction, listActions, listActionsForTicket, listPendingActions } from "#/db/action";
import { listCoverage, listDisciplines, setCoverage } from "#/db/assignment";
import { getDb } from "#/db/client";
import { listCompaniesOverview } from "#/db/schema";
import {
  createTemplate,
  getTemplate,
  listAllTemplates,
  setTemplateStatus,
  updateTemplate,
} from "#/db/template";
import { listTickets, loadTicket } from "#/db/ticket";
import { requireStaffSession, type ValidatedSession } from "#/lib/auth";
import { parsePositiveInt, parseTimestamp } from "#/lib/pagination";
import { isKnownSkill, listSkillCatalog } from "#/skills/registry";
import { emitTeamEvent } from "#/team/events";
import {
  pauseMember,
  resumeMember,
  TeamMemberNotFoundError,
  TeamMemberNotPausableError,
  updateMember,
} from "#/team/mutations";
import { getMemberDetail, getTeamRoster, listTeamRosters } from "#/team/queries";

type Vars = { session: ValidatedSession };

const backofficeRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

backofficeRoutes.use("*", requireStaffSession);

backofficeRoutes.get("/tickets", async (c) => {
  const companyId = c.req.query("companyId");
  const status = c.req.query("status");
  const limit = parsePositiveInt(c.req.query("limit"), 50, 200);
  const items = await listTickets(getDb(c.env), { companyId, limit, status });
  return c.json({ items });
});

backofficeRoutes.get("/actions", async (c) => {
  const status = c.req.query("status");
  const sort = c.req.query("sort");
  const companyId = c.req.query("companyId");

  const db = getDb(c.env);
  if (status === "pending") {
    const items =
      companyId !== undefined && companyId !== ""
        ? await listPendingActions(db, { companyId })
        : await (async () => {
            const coverage = await listCoverage(db, c.get("session").userId);
            return listPendingActions(db, {
              companyIds: coverage.companies,
              disciplines: coverage.disciplines,
            });
          })();
    const now = Date.now();
    const enriched = items.map((a) => ({
      actionType: a.actionType,
      agent: a.agent,
      ageSeconds: Math.floor((now - a.createdAt) / 1000),
      companyId: a.companyId,
      companyName: a.companyName,
      createdAt: a.createdAt,
      decidedAt: a.decidedAt,
      decidedByUserId: a.decidedByUserId,
      feedback: a.feedback,
      id: a.id,
      policy: a.policy,
      proposed: a.proposed,
      status: a.status,
      ticketId: a.ticketId,
    }));
    const sorted =
      sort === "age" ? enriched.toSorted((x, y) => y.ageSeconds - x.ageSeconds) : enriched;
    return c.json({ items: sorted });
  }

  const items = await listActions(db, { companyId });
  return c.json({ items });
});

const decideBodySchema = z.object({
  decision: z.enum(["approved", "changes_requested", "rejected"]),
  feedback: z.string().max(2000).optional(),
});

backofficeRoutes.post("/actions/:id/decide", async (c) => {
  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const parsed = decideBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
  }

  const db = getDb(c.env);
  const action = await getAction(db, id);
  if (!action) {
    return c.text("Not found", 404);
  }
  if (action.status !== "pending") {
    return c.json({ error: `action already ${action.status}` }, 409);
  }

  const ticket = await loadTicket(db, action.ticketId);
  if (ticket === null || ticket.workflowId === null || ticket.workflowId === "") {
    return c.json({ error: "no workflow for this action" }, 500);
  }

  const instance = await c.env.WORKER_JOB.get(ticket.workflowId);
  await instance.sendEvent({
    payload: {
      decidedByUserId: c.get("session").userId,
      decision: parsed.data.decision,
      feedback: parsed.data.feedback,
    },
    type: `decision:${id}`,
  });

  return c.json({ ok: true });
});

backofficeRoutes.get("/activity", async (c) => {
  const companyId = c.req.query("companyId");
  const since = parseTimestamp(c.req.query("since"));
  const before = parseTimestamp(c.req.query("before"));
  const limit = parsePositiveInt(c.req.query("limit"), 100, 500);
  const rawCategory = c.req.query("category");
  const category = ACTIVITY_CATEGORIES.find((value) => value === rawCategory);
  const items = await listActivity(getDb(c.env), { before, category, companyId, limit, since });
  return c.json({ items });
});

backofficeRoutes.get("/tickets/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env);
  const ticket = await loadTicket(db, id);
  if (!ticket) {
    return c.text("Not found", 404);
  }
  const actions = await listActionsForTicket(db, id);
  return c.json({ actions, ticket });
});

backofficeRoutes.get("/actions/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env);
  const action = await getAction(db, id);
  if (!action) {
    return c.text("Not found", 404);
  }
  const ticket = await loadTicket(db, action.ticketId);
  const ageSeconds = Math.floor((Date.now() - action.createdAt) / 1000);
  return c.json({ action, ageSeconds, ticket });
});

const backofficePatchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  promptOverride: z.union([z.string().trim().min(1).max(20_000), z.null()]).optional(),
  status: z.enum(["active", "paused"]).optional(),
});

backofficeRoutes.get("/companies", async (c) => {
  const db = getDb(c.env);
  const companies = await listCompaniesOverview(db);
  const rosters = await listTeamRosters(
    db,
    companies.map((company) => company.id),
  );
  const withRosters = companies.map((company) => ({
    briefPercent: company.briefPercent,
    id: company.id,
    members: rosters.get(company.id) ?? [],
    name: company.name,
    status: company.status,
  }));
  return c.json({ companies: withRosters });
});

backofficeRoutes.get("/assignments/me", async (c) => {
  const db = getDb(c.env);
  const [coverage, disciplines, companies] = await Promise.all([
    listCoverage(db, c.get("session").userId),
    listDisciplines(db),
    listCompaniesOverview(db),
  ]);
  return c.json({
    assigned: coverage,
    options: {
      companies: companies.map((co) => ({ id: co.id, name: co.name })),
      disciplines,
    },
  });
});

const coverageBodySchema = z.object({
  companies: z.array(z.string().min(1)).max(1000),
  disciplines: z.array(z.string().min(1)).max(100),
});

backofficeRoutes.put("/assignments/me", async (c) => {
  const parsed = coverageBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body" }, 400);
  }
  await setCoverage(getDb(c.env), c.get("session").userId, parsed.data);
  return c.json({ assigned: parsed.data });
});

backofficeRoutes.get("/teams/:companyId/members", async (c) => {
  const companyId = c.req.param("companyId");
  const members = await getTeamRoster(getDb(c.env), companyId);
  return c.json({ members });
});

backofficeRoutes.get("/teams/:companyId/members/:id", async (c) => {
  const member = await getMemberDetail(getDb(c.env), c.req.param("companyId"), c.req.param("id"));
  if (!member) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ member });
});

backofficeRoutes.patch("/teams/:companyId/members/:id", async (c) => {
  const companyId = c.req.param("companyId");
  const id = c.req.param("id");
  const parsed = backofficePatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body" }, 400);
  }
  try {
    if (parsed.data.status !== undefined) {
      const paused = parsed.data.status === "paused";
      const member = paused
        ? await pauseMember(getDb(c.env), companyId, id, c.get("session").userId)
        : await resumeMember(getDb(c.env), companyId, id, c.get("session").userId);
      await emitTeamEvent(c.env, {
        companyId,
        reason: paused ? "paused" : "resumed",
        type: "team:roster",
      });
      return c.json({ member });
    }
    const member = await updateMember(getDb(c.env), {
      agentInstanceId: id,
      companyId,
      displayName: parsed.data.displayName,
      editedBy: "operator",
      operatorId: c.get("session").userId,
      promptOverride: parsed.data.promptOverride,
    });
    await emitTeamEvent(c.env, {
      companyId,
      reason: parsed.data.promptOverride === undefined ? "renamed" : "prompt_changed",
      type: "team:roster",
    });
    return c.json({ member });
  } catch (error) {
    if (error instanceof TeamMemberNotFoundError) {
      return c.json({ error: "not found" }, 404);
    }
    if (error instanceof TeamMemberNotPausableError) {
      return c.json({ error: "not pausable" }, 409);
    }
    throw error;
  }
});

const skillIdsSchema = z.array(z.string().min(1)).refine((ids) => ids.every(isKnownSkill), {
  message: "unknown skill id",
});

const templateBodySchema = z.object({
  defaultActionType: z.string().trim().min(1).max(80).default("worker_deliverable"),
  defaultPolicies: z.record(z.string(), z.string()).default({}),
  description: z.string().trim().min(1).max(2000),
  displayName: z.string().trim().min(1).max(120),
  model: z.string().trim().min(1).max(160),
  skillIds: skillIdsSchema,
  systemPrompt: z.string().trim().min(1).max(20_000),
  workerKind: z.string().trim().min(1).max(80),
});

const templateStatusSchema = z.object({
  status: z.enum(["active", "retired"]),
});

backofficeRoutes.get("/skills", (c) => {
  return c.json({ items: listSkillCatalog() });
});

backofficeRoutes.get("/templates", async (c) => {
  const items = await listAllTemplates(getDb(c.env));
  return c.json({ items });
});

backofficeRoutes.get("/templates/:id", async (c) => {
  const template = await getTemplate(getDb(c.env), c.req.param("id"));
  if (!template) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ template });
});

backofficeRoutes.post("/templates", async (c) => {
  const parsed = templateBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
  }
  const template = await createTemplate(getDb(c.env), parsed.data);
  return c.json({ template }, 201);
});

backofficeRoutes.patch("/templates/:id", async (c) => {
  const parsed = templateBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
  }
  const template = await updateTemplate(getDb(c.env), c.req.param("id"), parsed.data);
  if (!template) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ template });
});

backofficeRoutes.patch("/templates/:id/status", async (c) => {
  const parsed = templateStatusSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
  }
  const template = await setTemplateStatus(getDb(c.env), c.req.param("id"), parsed.data.status);
  if (!template) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ template });
});

export { backofficeRoutes };
