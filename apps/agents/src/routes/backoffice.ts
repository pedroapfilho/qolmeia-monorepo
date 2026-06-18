import { Hono } from "hono";
import { z } from "zod";

import { listActivity } from "@/activity/log";
import { getAction, listActions, listActionsForTicket, listPendingActions } from "@/db/action";
import { listCoverage, listDisciplines, setCoverage } from "@/db/assignment";
import { listCompaniesOverview } from "@/db/schema";
import { listTickets, loadTicket } from "@/db/ticket";
import { validateSession } from "@/lib/auth";
import { emitTeamEvent } from "@/team/events";
import {
  pauseMember,
  resumeMember,
  TeamMemberNotFoundError,
  TeamMemberNotPausableError,
  updateMember,
} from "@/team/mutations";
import { getMemberDetail, getTeamRoster } from "@/team/queries";

// Backoffice REST surface. OWNER/STAFF-only. Same `validateSession` as the
// agent paths, just with a different role guard. Every write — including the
// operator override on /actions/:id/decide — goes through the same
// `sendEvent` path the Correspondent uses; no privileged shortcut.
//
// Operators are Qolmeia platform staff, not customers (ADR 0005): they span
// every tenant and are authorized purely by role. The session's companyId is
// the operator's own internal org — it has no customer data and is never used
// to scope these reads/writes. Cross-tenant access is the point of the surface;
// per-company narrowing is an explicit `?companyId=` filter, not a wall.

type Vars = {
  role: string;
  userId: string;
};

const backofficeRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

backofficeRoutes.use("*", async (c, next) => {
  const session = await validateSession(c.req.raw, c.env);
  if (!session) {
    return c.text("Unauthorized", 401);
  }
  if (session.role !== "OWNER" && session.role !== "STAFF") {
    return c.text("Forbidden", 403);
  }
  c.set("role", session.role);
  c.set("userId", session.userId);
  return next();
});

backofficeRoutes.get("/tickets", async (c) => {
  const companyId = c.req.query("companyId");
  const status = c.req.query("status");
  const limitParam = Number(c.req.query("limit") ?? 50);
  const items = await listTickets(c.env.DB, { companyId, limit: limitParam, status });
  return c.json({ items });
});

// Stale-backlog view (T8): `?status=pending&sort=age` returns pending actions
// oldest-first, with a derived ageSeconds for operator triage.
backofficeRoutes.get("/actions", async (c) => {
  const status = c.req.query("status");
  const sort = c.req.query("sort");
  const companyId = c.req.query("companyId");

  if (status === "pending") {
    // The queue narrows to the operator's coverage (ADR 0005); an explicit
    // ?companyId= is a deliberate drill into one company that bypasses it.
    const items = companyId
      ? await listPendingActions(c.env.DB, { companyId })
      : await (async () => {
          const coverage = await listCoverage(c.env.DB, c.get("userId"));
          return listPendingActions(c.env.DB, {
            companyIds: coverage.companies,
            disciplines: coverage.disciplines,
          });
        })();
    const now = Date.now();
    // Explicit field copy (not `{...a, ageSeconds}`) — oxlint's no-map-spread
    // forbids spread inside .map. The `mapAction` boundary above guarantees
    // every `a` is camelCase + typed, so this stays a pure projection.
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

  // Any status — recent first. All list endpoints flow through the same
  // mapAction so the backoffice never sees raw snake_case columns.
  const items = await listActions(c.env.DB, { companyId });
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

  const action = await getAction(c.env.DB, id);
  if (!action) {
    return c.text("Not found", 404);
  }
  if (action.status !== "pending") {
    return c.json({ error: `action already ${action.status}` }, 409);
  }

  const ticket = await loadTicket(c.env.DB, action.ticketId);
  if (!ticket?.workflowId) {
    return c.json({ error: "no workflow for this action" }, 500);
  }

  const instance = await c.env.WORKER_JOB.get(ticket.workflowId);
  await instance.sendEvent({
    payload: {
      decidedByUserId: c.get("userId"),
      decision: parsed.data.decision,
      feedback: parsed.data.feedback,
    },
    type: `decision:${id}`,
  });

  return c.json({ ok: true });
});

backofficeRoutes.get("/activity", async (c) => {
  const companyId = c.req.query("companyId");
  const sinceRaw = c.req.query("since");
  const beforeRaw = c.req.query("before");
  const since = sinceRaw ? Number(sinceRaw) : undefined;
  const before = beforeRaw ? Number(beforeRaw) : undefined;
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
  const items = await listActivity(c.env.DB, { before, companyId, limit, since });
  return c.json({ items });
});

// Ticket detail — the operator drill-down. Includes the actions associated
// with this ticket so they can decide without an extra round-trip.
backofficeRoutes.get("/tickets/:id", async (c) => {
  const id = c.req.param("id");
  const ticket = await loadTicket(c.env.DB, id);
  if (!ticket) {
    return c.text("Not found", 404);
  }
  const actions = await listActionsForTicket(c.env.DB, id);
  return c.json({ actions, ticket });
});

// Action detail — used by /approvals/:id to render the proposal + decide form.
backofficeRoutes.get("/actions/:id", async (c) => {
  const id = c.req.param("id");
  const action = await getAction(c.env.DB, id);
  if (!action) {
    return c.text("Not found", 404);
  }
  const ticket = await loadTicket(c.env.DB, action.ticketId);
  const ageSeconds = Math.floor((Date.now() - action.createdAt) / 1000);
  return c.json({ action, ageSeconds, ticket });
});

const backofficePatchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  promptOverride: z.union([z.string().trim().min(1).max(20_000), z.null()]).optional(),
  status: z.enum(["active", "paused"]).optional(),
});

// Operator overview of every company + its roster. The back office is a
// Qolmeia-staff surface (OWNER/STAFF, gated above), so it spans all tenants —
// not just the operator's own company.
backofficeRoutes.get("/companies", async (c) => {
  const companies = await listCompaniesOverview(c.env.DB);
  const withRosters = await Promise.all(
    companies.map(async (company) => ({
      briefPercent: company.briefPercent,
      id: company.id,
      members: await getTeamRoster(c.env.DB, company.id),
      name: company.name,
      status: company.status,
    })),
  );
  return c.json({ companies: withRosters });
});

// The operator's own coverage (ADR 0005): the companies + disciplines they
// cover, plus the option lists to populate the picker. Self-service — keyed on
// the session user, never another operator (an admin-assigns-others surface
// waits on the operator directory, which doesn't exist yet).
backofficeRoutes.get("/assignments/me", async (c) => {
  const [coverage, disciplines, companies] = await Promise.all([
    listCoverage(c.env.DB, c.get("userId")),
    listDisciplines(c.env.DB),
    listCompaniesOverview(c.env.DB),
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
  await setCoverage(c.env.DB, c.get("userId"), parsed.data);
  return c.json({ assigned: parsed.data });
});

backofficeRoutes.get("/teams/:companyId/members", async (c) => {
  const companyId = c.req.param("companyId");
  const members = await getTeamRoster(c.env.DB, companyId);
  return c.json({ members });
});

backofficeRoutes.get("/teams/:companyId/members/:id", async (c) => {
  const member = await getMemberDetail(c.env.DB, c.req.param("companyId"), c.req.param("id"));
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
    // Pause/resume is its own transition (the "Pausar"/"Retomar" button); when
    // present it takes precedence over the rename/prompt edit path.
    if (parsed.data.status !== undefined) {
      const paused = parsed.data.status === "paused";
      const member = paused
        ? await pauseMember(c.env.DB, companyId, id, c.get("userId"))
        : await resumeMember(c.env.DB, companyId, id, c.get("userId"));
      await emitTeamEvent(c.env, {
        companyId,
        reason: paused ? "paused" : "resumed",
        type: "team:roster",
      });
      return c.json({ member });
    }
    const member = await updateMember(c.env.DB, {
      agentInstanceId: id,
      companyId,
      displayName: parsed.data.displayName,
      editedBy: "operator",
      operatorId: c.get("userId"),
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

export { backofficeRoutes };
