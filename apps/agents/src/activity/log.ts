import type { ActivityEvent, ActivityType } from "#/activity/types";
import { safeJson } from "#/db/mappers";

type LogActivityInput = ActivityEvent & {
  actorId?: string;
  companyId: string;
  summary: string;
};

const logActivity = async (env: { DB: D1Database }, input: LogActivityInput): Promise<void> => {
  try {
    await env.DB.prepare(
      `INSERT INTO activity_log
         (id, company_id, type, ref_type, ref_id, summary, payload, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        input.companyId,
        input.type,
        input.refType,
        input.refId,
        input.summary,
        input.payload === undefined ? null : JSON.stringify(input.payload),
        input.actorId ?? null,
        Date.now(),
      )
      .run();
  } catch (error) {
    // oxlint-disable-next-line no-console
    console.error("[activity] log write failed (best-effort, continuing)", {
      error,
      type: input.type,
    });
  }
};

type ActivityEntry = {
  actorId: string | null;
  companyId: string;
  companyName: string;
  createdAt: number;
  id: string;
  payload: Record<string, unknown> | null;
  refId: string | null;
  refType: string | null;
  summary: string;
  type: ActivityType | string;
};

type ActivityRow = {
  actor_id: string | null;
  company_id: string;
  company_name: string;
  created_at: number;
  id: string;
  payload: string | null;
  ref_id: string | null;
  ref_type: string | null;
  summary: string;
  type: string;
};

const mapActivity = (row: ActivityRow): ActivityEntry => ({
  actorId: row.actor_id,
  companyId: row.company_id,
  companyName: row.company_name,
  createdAt: row.created_at,
  id: row.id,
  payload: safeJson<Record<string, unknown> | null>(row.payload, null),
  refId: row.ref_id,
  refType: row.ref_type,
  summary: row.summary,
  type: row.type,
});

const ACTIVITY_CATEGORIES = ["ACTION", "TICKET", "WORKER", "TEAM", "MEMBER"] as const;

type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

type ListActivityOptions = {
  before?: number;
  category?: ActivityCategory;
  companyId?: string;
  limit?: number;
  since?: number;
};

const listActivity = async (
  db: D1Database,
  options: ListActivityOptions = {},
): Promise<ReadonlyArray<ActivityEntry>> => {
  const limit = options.limit ?? 100;
  const clauses: Array<string> = [];
  const params: Array<number | string> = [];
  if (options.companyId) {
    clauses.push("al.company_id = ?");
    params.push(options.companyId);
  }
  if (options.since !== undefined) {
    clauses.push("al.created_at >= ?");
    params.push(options.since);
  }
  if (options.before !== undefined) {
    clauses.push("al.created_at < ?");
    params.push(options.before);
  }
  if (options.category) {
    clauses.push(String.raw`al.type LIKE ? ESCAPE '\'`);
    params.push(String.raw`${options.category}\_%`);
  }
  params.push(limit);
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const { results } = await db
    .prepare(
      `SELECT al.*, co.name AS company_name
         FROM activity_log al
         JOIN company co ON co.id = al.company_id
         ${where} ORDER BY al.created_at DESC LIMIT ?`,
    )
    .bind(...params)
    .all<ActivityRow>();
  return results.map(mapActivity);
};

export { ACTIVITY_CATEGORIES, listActivity, logActivity };
export type { ActivityEntry, LogActivityInput };
