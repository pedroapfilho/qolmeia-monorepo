import type { PrismaClient } from "@repo/db";
import { prisma as defaultPrisma } from "@repo/db";
import { Hono } from "hono";
import { z, ZodError } from "zod";

import { approveAction, editAction, rejectAction } from "@/agents/approvals";
import { buildListResponse, notFound, parsePagination, validationError } from "@/lib/api-response";
import type { StaffContextVars } from "@/middleware/require-staff";

type ApprovalsPrisma = Pick<PrismaClient, "activityLog" | "agentAction" | "agentInstance">;

// Injected so tests can spy on the transitions without re-mocking the
// whole prisma surface. Defaults wire up to the existing approval helpers.
type ApprovalsRouteDeps = {
  approveAction?: typeof approveAction;
  editAction?: typeof editAction;
  prisma?: ApprovalsPrisma;
  rejectAction?: typeof rejectAction;
};

const rejectBodySchema = z.object({ reason: z.string().max(2000).optional() });

const editBodySchema = z.object({
  newInput: z.unknown().refine((value) => value !== null && typeof value === "object", {
    message: "newInput must be an object",
  }),
});

type DraftedActionRow = {
  agentInstance: { orgId: string; template: { displayName: string } };
  agentInstanceId: string;
  createdAt: Date;
  id: string;
  proposedInput: unknown;
  proposedSummary: string;
  skill: { displayName: string; id: string };
  skillId: string;
};

const serialiseDrafted = (row: DraftedActionRow) => ({
  agentInstanceId: row.agentInstanceId,
  agentTemplateDisplayName: row.agentInstance.template.displayName,
  createdAt: row.createdAt.toISOString(),
  id: row.id,
  proposedInput: row.proposedInput,
  proposedSummary: row.proposedSummary,
  skill: { displayName: row.skill.displayName, id: row.skill.id },
  skillId: row.skillId,
});

const buildApprovalsRoutes = (
  deps: ApprovalsRouteDeps = {},
): Hono<{ Variables: StaffContextVars }> => {
  const prisma = deps.prisma ?? defaultPrisma;
  const approve = deps.approveAction ?? approveAction;
  const reject = deps.rejectAction ?? rejectAction;
  const edit = deps.editAction ?? editAction;

  const app = new Hono<{ Variables: StaffContextVars }>();

  // GET /approvals — paginated list of DRAFTED actions awaiting decision.
  // Cursor is the createdAt of the last item; we order desc so the freshest
  // approvals surface first.
  app.get("/", async (c) => {
    const orgId = c.get("orgId");
    const { cursorDate, limit } = parsePagination({
      cursor: c.req.query("cursor"),
      defaultLimit: 20,
      limit: c.req.query("limit"),
      maxLimit: 100,
    });

    const rows = await prisma.agentAction.findMany({
      include: {
        agentInstance: {
          select: { orgId: true, template: { select: { displayName: true } } },
        },
        skill: { select: { displayName: true, id: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      // Peek one extra to know whether nextCursor should be set.
      take: limit + 1,
      where: {
        agentInstance: { orgId },
        status: "DRAFTED",
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      },
    });

    // Defensive: the where clause already filters to orgId via the relation,
    // but the include returns the raw orgId so we re-check here.
    const owned = rows.filter((row) => row.agentInstance.orgId === orgId);
    const response = buildListResponse(owned, limit);
    return c.json({
      items: response.items.map((row) => serialiseDrafted(row as DraftedActionRow)),
      nextCursor: response.nextCursor,
    });
  });

  // Looks the action up and verifies it belongs to the caller's org. Returns
  // null when the action doesn't exist OR exists in a different org — we
  // intentionally don't distinguish the two so a 404 doesn't leak existence.
  const findActionInOrg = async (
    actionId: string,
    orgId: string,
  ): Promise<{ id: string; orgId: string } | null> => {
    const row = await prisma.agentAction.findUnique({
      select: { agentInstance: { select: { orgId: true } }, id: true },
      where: { id: actionId },
    });
    if (!row || row.agentInstance.orgId !== orgId) {
      return null;
    }
    return { id: row.id, orgId: row.agentInstance.orgId };
  };

  // POST /approvals/:id/approve
  app.post("/:id/approve", async (c) => {
    const orgId = c.get("orgId");
    const session = c.get("session");
    const id = c.req.param("id");

    const owned = await findActionInOrg(id, orgId);
    if (!owned) {
      return notFound(c, "Approval not found");
    }

    const updated = await approve({
      actionId: id,
      decidedByUserId: session.user.id,
      prisma,
    });
    return c.json({ action: { id: updated.id, status: updated.status } });
  });

  // POST /approvals/:id/reject
  app.post("/:id/reject", async (c) => {
    const orgId = c.get("orgId");
    const session = c.get("session");
    const id = c.req.param("id");

    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      // Empty body is fine — reason is optional.
    }
    const parsed = rejectBodySchema.safeParse(body);
    if (!parsed.success) {
      return validationError(c, parsed.error);
    }

    const owned = await findActionInOrg(id, orgId);
    if (!owned) {
      return notFound(c, "Approval not found");
    }

    const updated = await reject({
      actionId: id,
      decidedByUserId: session.user.id,
      prisma,
      reason: parsed.data.reason,
    });
    return c.json({ action: { id: updated.id, status: updated.status } });
  });

  // POST /approvals/:id/edit
  app.post("/:id/edit", async (c) => {
    const orgId = c.get("orgId");
    const session = c.get("session");
    const id = c.req.param("id");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return validationError(
        c,
        new ZodError([
          { code: "custom", input: undefined, message: "Invalid JSON body", path: [] },
        ]),
      );
    }

    const parsed = editBodySchema.safeParse(body);
    if (!parsed.success) {
      return validationError(c, parsed.error);
    }

    const owned = await findActionInOrg(id, orgId);
    if (!owned) {
      return notFound(c, "Approval not found");
    }

    const updated = await edit({
      actionId: id,
      decidedByUserId: session.user.id,
      // Cast: the Zod schema guards newInput is an object; editAction wants
      // `object`.
      newInput: parsed.data.newInput as object,
      prisma,
    });
    return c.json({ action: { id: updated.id, status: updated.status } });
  });

  return app;
};

export { buildApprovalsRoutes, editBodySchema, rejectBodySchema };
export type { ApprovalsRouteDeps };
