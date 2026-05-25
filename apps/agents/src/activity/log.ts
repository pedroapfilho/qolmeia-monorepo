// Append-only per-company activity timeline. Writes are best-effort: a failed
// log write never fails the request (the system-of-record is the ticket /
// action row itself; activity_log is the human-readable timeline). Errors
// are surfaced via console.error so wrangler tail / observability sees them
// instead of being silently swallowed.

type LogActivityInput = {
  actorId?: string;
  companyId: string;
  payload?: Record<string, unknown>;
  refId?: string;
  refType?: string;
  summary: string;
  type: string;
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
        input.refType ?? null,
        input.refId ?? null,
        input.summary,
        input.payload ? JSON.stringify(input.payload) : null,
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
  createdAt: number;
  id: string;
  payload: Record<string, unknown> | null;
  refId: string | null;
  refType: string | null;
  summary: string;
  type: string;
};

type ActivityRow = {
  actor_id: string | null;
  company_id: string;
  created_at: number;
  id: string;
  payload: string | null;
  ref_id: string | null;
  ref_type: string | null;
  summary: string;
  type: string;
};

const safeJson = (value: string | null): Record<string, unknown> | null => {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const mapActivity = (row: ActivityRow): ActivityEntry => ({
  actorId: row.actor_id,
  companyId: row.company_id,
  createdAt: row.created_at,
  id: row.id,
  payload: safeJson(row.payload),
  refId: row.ref_id,
  refType: row.ref_type,
  summary: row.summary,
  type: row.type,
});

type ListActivityOptions = {
  companyId: string;
  limit?: number;
  since?: number;
};

const listActivity = async (
  db: D1Database,
  options: ListActivityOptions,
): Promise<ReadonlyArray<ActivityEntry>> => {
  const limit = options.limit ?? 100;
  const cursor = options.since
    ? db
        .prepare(
          "SELECT * FROM activity_log WHERE company_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?",
        )
        .bind(options.companyId, options.since, limit)
    : db
        .prepare("SELECT * FROM activity_log WHERE company_id = ? ORDER BY created_at DESC LIMIT ?")
        .bind(options.companyId, limit);
  const { results } = await cursor.all<ActivityRow>();
  return results.map(mapActivity);
};

export { listActivity, logActivity };
export type { ActivityEntry, LogActivityInput };
