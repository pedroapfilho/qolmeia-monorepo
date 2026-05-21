import type { ActivityLogRefType, ActivityLogType, PrismaClient } from "@repo/db";
import { prisma as defaultPrisma } from "@repo/db";
import { Hono } from "hono";

import { buildListResponse, parsePagination } from "@/lib/api-response";
import type { StaffContextVars } from "@/middleware/require-staff";

type ActivityPrisma = Pick<PrismaClient, "activityLog">;

type ActivityRouteDeps = {
  prisma?: ActivityPrisma;
};

// Whitelisted enum values. We cast at the prisma boundary because the
// generated enum types are const objects — `as ActivityLogType` keeps the
// query typed without pulling in zod for trivial enum membership.
const ACTIVITY_LOG_TYPES: ReadonlyArray<ActivityLogType> = [
  "MESSAGE_INBOUND",
  "MESSAGE_OUTBOUND",
  "AGENT_RUN_STARTED",
  "AGENT_RUN_FINISHED",
  "AGENT_RUN_FAILED",
  "ACTION_EXECUTED",
  "ACTION_FAILED",
  "ACTION_DRAFTED",
  "ACTION_APPROVED",
  "ACTION_REJECTED",
  "BUDGET_WARN_80",
  "BUDGET_WARN_100",
  "INSTRUCTIONS_UPDATED",
  "BUSINESS_IDEA_UPDATED",
  "OWNER_COMMAND",
  "ROUTINE_TRIGGERED",
  "ROUTINE_ENABLED",
  "ROUTINE_DISABLED",
  "MEMBER_INVITED",
  "MEMBER_JOINED",
];

const ACTIVITY_LOG_REF_TYPES: ReadonlyArray<ActivityLogRefType> = [
  "MESSAGE",
  "AGENT_RUN",
  "AGENT_ACTION",
  "ORGANIZATION",
  "ROUTINE",
  "NONE",
];

const filterEnumQuery = <T extends string>(
  raw: string | undefined,
  allowed: ReadonlyArray<T>,
): ReadonlyArray<T> => {
  if (!raw) {
    return [];
  }
  const allowedSet = new Set<string>(allowed);
  const found: Array<T> = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed.length > 0 && allowedSet.has(trimmed)) {
      found.push(trimmed as T);
    }
  }
  return found;
};

const buildActivityRoutes = (
  deps: ActivityRouteDeps = {},
): Hono<{ Variables: StaffContextVars }> => {
  const prisma = deps.prisma ?? defaultPrisma;
  const app = new Hono<{ Variables: StaffContextVars }>();

  // GET /activity — paginated unified timeline for the current org. Filter
  // by ?type=A,B and ?refType=C,D (unknown enum values are silently dropped).
  app.get("/", async (c) => {
    const orgId = c.get("orgId");
    const { cursorDate, limit } = parsePagination({
      cursor: c.req.query("cursor"),
      defaultLimit: 50,
      limit: c.req.query("limit"),
      maxLimit: 200,
    });

    const types = filterEnumQuery(c.req.query("type"), ACTIVITY_LOG_TYPES);
    const refTypes = filterEnumQuery(c.req.query("refType"), ACTIVITY_LOG_REF_TYPES);

    const rows = await prisma.activityLog.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      where: {
        orgId,
        ...(types.length > 0 ? { type: { in: [...types] } } : {}),
        ...(refTypes.length > 0 ? { refType: { in: [...refTypes] } } : {}),
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      },
    });

    const response = buildListResponse(rows, limit);
    return c.json({
      items: response.items.map((row) => ({
        actorId: row.actorId,
        createdAt: row.createdAt.toISOString(),
        id: row.id,
        orgId: row.orgId,
        payload: row.payload,
        refId: row.refId,
        refType: row.refType,
        summary: row.summary,
        type: row.type,
      })),
      nextCursor: response.nextCursor,
    });
  });

  return app;
};

export { ACTIVITY_LOG_REF_TYPES, ACTIVITY_LOG_TYPES, buildActivityRoutes };
export type { ActivityRouteDeps };
