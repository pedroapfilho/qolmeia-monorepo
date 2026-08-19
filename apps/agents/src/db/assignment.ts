import type { OperatorAssignmentKind } from "@repo/db/worker";
import type { OperatorCoverage } from "@repo/worker-api/contracts";

import type { Database } from "#/db/client";

const listCoverage = async (db: Database, operatorUserId: string): Promise<OperatorCoverage> => {
  const rows = await db.operatorAssignment.findMany({ where: { operatorUserId } });
  const companies: Array<string> = [];
  const disciplines: Array<string> = [];
  for (const row of rows) {
    if (row.kind === "company") {
      companies.push(row.value);
    } else {
      disciplines.push(row.value);
    }
  }
  return { companies, disciplines };
};

const setCoverage = async (
  db: Database,
  operatorUserId: string,
  coverage: OperatorCoverage,
): Promise<void> => {
  const rows: ReadonlyArray<{ kind: OperatorAssignmentKind; value: string }> = [
    ...coverage.companies.map((value) => ({ kind: "company" as const, value })),
    ...coverage.disciplines.map((value) => ({ kind: "discipline" as const, value })),
  ];
  await db.$transaction(async (tx) => {
    await tx.operatorAssignment.deleteMany({ where: { operatorUserId } });
    if (rows.length) {
      await tx.operatorAssignment.createMany({
        data: rows.map((row) => ({
          id: crypto.randomUUID(),
          kind: row.kind,
          operatorUserId,
          value: row.value,
        })),
        skipDuplicates: true,
      });
    }
  });
};

const listDisciplines = async (db: Database): Promise<ReadonlyArray<string>> => {
  const rows = await db.agentTemplate.findMany({
    distinct: ["workerKind"],
    orderBy: { workerKind: "asc" },
    select: { workerKind: true },
  });
  return rows.map((row) => row.workerKind);
};

export { listCoverage, listDisciplines, setCoverage };
export type { OperatorCoverage } from "@repo/worker-api/contracts";
