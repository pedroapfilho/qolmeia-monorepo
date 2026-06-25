type OperatorCoverage = {
  companies: ReadonlyArray<string>;
  disciplines: ReadonlyArray<string>;
};

type AssignmentRow = {
  kind: string;
  value: string;
};

const listCoverage = async (db: D1Database, operatorUserId: string): Promise<OperatorCoverage> => {
  const { results } = await db
    .prepare("SELECT kind, value FROM operator_assignment WHERE operator_user_id = ?")
    .bind(operatorUserId)
    .all<AssignmentRow>();
  return {
    companies: results.filter((r) => r.kind === "company").map((r) => r.value),
    disciplines: results.filter((r) => r.kind === "discipline").map((r) => r.value),
  };
};

const setCoverage = async (
  db: D1Database,
  operatorUserId: string,
  coverage: OperatorCoverage,
): Promise<void> => {
  const now = Date.now();
  const rows: ReadonlyArray<AssignmentRow> = [
    ...coverage.companies.map((value) => ({ kind: "company", value })),
    ...coverage.disciplines.map((value) => ({ kind: "discipline", value })),
  ];
  await db.batch([
    db.prepare("DELETE FROM operator_assignment WHERE operator_user_id = ?").bind(operatorUserId),
    ...rows.map((r) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO operator_assignment
             (id, operator_user_id, kind, value, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), operatorUserId, r.kind, r.value, now),
    ),
  ]);
};

const listDisciplines = async (db: D1Database): Promise<ReadonlyArray<string>> => {
  const { results } = await db
    .prepare(
      "SELECT DISTINCT worker_kind FROM template WHERE worker_kind IS NOT NULL ORDER BY worker_kind",
    )
    .all<{ worker_kind: string }>();
  return results.map((r) => r.worker_kind);
};

export { listCoverage, listDisciplines, setCoverage };
export type { OperatorCoverage };
