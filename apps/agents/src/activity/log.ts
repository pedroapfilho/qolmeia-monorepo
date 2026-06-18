// Append-only per-company activity timeline. Writes are best-effort: a failed
// log write never fails the request (the system-of-record is the ticket /
// action row itself; activity_log is the human-readable timeline). Errors
// are surfaced via console.error so wrangler tail / observability sees them
// instead of being silently swallowed.
//
// Inputs are typed via `ActivityEvent` (see ./types.ts) — every legal
// (type, refType, payload-shape) triplet is enumerated there. Adding a new
// event type means extending the union and adding a category case; the
// compiler will refuse a typo or a missing renderer.

import type { ActivityEvent, ActivityType } from "@/activity/types";
import { safeJson } from "@/db/mappers";

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
  // The reader-side stays string-typed so legacy rows (older event-type
  // values that didn't exist when this code was deployed) deserialize
  // without throwing. The writer-side guarantees only listed types land.
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

type ListActivityOptions = {
  before?: number;
  companyId?: string;
  limit?: number;
  since?: number;
};

// Two-axis paging. `since` returns entries at-or-after a floor (the
// "what's new" subscription) while `before` returns entries strictly older
// than a ceiling (the "load older" pagination button). Both axes default
// to absent → unbounded. companyId is optional: the customer feed always
// scopes to one company, while the operator feed spans every tenant (the
// company JOIN labels each row).
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

export { listActivity, logActivity };
export type { ActivityEntry, LogActivityInput };
