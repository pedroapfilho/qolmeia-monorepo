import { Hono } from "hono";
import { z } from "zod";

import { listActivity } from "@/activity/log";
import { getAction, listActions, listActionsForTicket, listPendingActions } from "@/db/action";
import { listTickets, loadTicket } from "@/db/ticket";
import { validateSession } from "@/lib/auth";
import { emitTeamEvent } from "@/team/events";
import { TeamMemberNotFoundError, updateMember } from "@/team/mutations";
import { getMemberDetail, getTeamRoster } from "@/team/queries";

// Backoffice REST surface. OWNER/STAFF-only. Same `validateSession` as the
// agent paths, just with a different role guard. Every write — including the
// operator override on /actions/:id/decide — goes through the same
// `sendEvent` path the Correspondent uses; no privileged shortcut.

type Vars = {
  companyId: string;
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
  c.set("companyId", session.companyId);
  c.set("role", session.role);
  c.set("userId", session.userId);
  return next();
});

backofficeRoutes.get("/tickets", async (c) => {
  const companyId = c.req.query("companyId") ?? c.get("companyId");
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
  const companyId = c.req.query("companyId") ?? c.get("companyId");

  if (status === "pending") {
    const items = await listPendingActions(c.env.DB, { companyId });
    const now = Date.now();
    // Explicit field copy (not `{...a, ageSeconds}`) — oxlint's no-map-spread
    // forbids spread inside .map. The `mapAction` boundary above guarantees
    // every `a` is camelCase + typed, so this stays a pure projection.
    const enriched = items.map((a) => ({
      actionType: a.actionType,
      ageSeconds: Math.floor((now - a.createdAt) / 1000),
      companyId: a.companyId,
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
  if (action.companyId !== c.get("companyId")) {
    return c.text("Forbidden", 403);
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
  const companyId = c.req.query("companyId") ?? c.get("companyId");
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
  if (ticket.companyId !== c.get("companyId")) {
    return c.text("Forbidden", 403);
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
  if (action.companyId !== c.get("companyId")) {
    return c.text("Forbidden", 403);
  }
  const ticket = await loadTicket(c.env.DB, action.ticketId);
  return c.json({ action, ticket });
});

const backofficePatchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  promptOverride: z.union([z.string().trim().min(1).max(20_000), z.null()]).optional(),
});

backofficeRoutes.get("/teams/:companyId/members", async (c) => {
  const companyId = c.req.param("companyId");
  if (companyId !== c.get("companyId")) {
    return c.text("Forbidden", 403);
  }
  const members = await getTeamRoster(c.env.DB, companyId);
  return c.json({ members });
});

backofficeRoutes.get("/teams/:companyId/members/:id", async (c) => {
  if (c.req.param("companyId") !== c.get("companyId")) {
    return c.text("Forbidden", 403);
  }
  const member = await getMemberDetail(c.env.DB, c.req.param("companyId"), c.req.param("id"));
  if (!member) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ member });
});

backofficeRoutes.patch("/teams/:companyId/members/:id", async (c) => {
  const companyId = c.req.param("companyId");
  if (companyId !== c.get("companyId")) {
    return c.text("Forbidden", 403);
  }
  const id = c.req.param("id");
  const parsed = backofficePatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body" }, 400);
  }
  try {
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
    throw error;
  }
});

export { backofficeRoutes };
