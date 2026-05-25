import { Hono } from "hono";
import { z } from "zod";

import { listActivity } from "@/activity/log";
import { getAction, listPendingActions } from "@/db/action";
import { loadTicket } from "@/db/ticket";
import { validateSession } from "@/lib/auth";

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
  await next();
});

backofficeRoutes.get("/tickets", async (c) => {
  const companyId = c.req.query("companyId") ?? c.get("companyId");
  const status = c.req.query("status");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

  const { results } = status
    ? await c.env.DB.prepare(
        "SELECT id, company_id, agent_instance_id, title, brief, status, origin, workflow_id, created_at, updated_at FROM ticket WHERE company_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?",
      )
        .bind(companyId, status, limit)
        .all<Record<string, unknown>>()
    : await c.env.DB.prepare(
        "SELECT id, company_id, agent_instance_id, title, brief, status, origin, workflow_id, created_at, updated_at FROM ticket WHERE company_id = ? ORDER BY created_at DESC LIMIT ?",
      )
        .bind(companyId, limit)
        .all<Record<string, unknown>>();
  return c.json({ items: results });
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

  // Any status — recent first
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM action WHERE company_id = ? ORDER BY created_at DESC LIMIT 200",
  )
    .bind(companyId)
    .all<Record<string, unknown>>();
  return c.json({ items: results });
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
  const since = sinceRaw ? Number(sinceRaw) : undefined;
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
  const items = await listActivity(c.env.DB, { companyId, limit, since });
  return c.json({ items });
});

export { backofficeRoutes };
