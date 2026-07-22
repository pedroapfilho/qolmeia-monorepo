import type { Database } from "#/db/client";

type OperatorCoverage = {
  companies: ReadonlyArray<string>;
  disciplines: ReadonlyArray<string>;
};

const listCoverage = async (db: Database, operatorUserId: string): Promise<OperatorCoverage> => {
  const rows = await db.operatorAssignment.findMany({ where: { operatorUserId } });
  return {
    companies: rows.filter((row) => row.kind === "company").map((row) => row.value),
    disciplines: rows.filter((row) => row.kind === "discipline").map((row) => row.value),
  };
};

const setCoverage = async (
  db: Database,
  operatorUserId: string,
  coverage: OperatorCoverage,
): Promise<void> => {
  const rows = [
    ...coverage.companies.map((value) => ({ kind: "company", value })),
    ...coverage.disciplines.map((value) => ({ kind: "discipline", value })),
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
export type { OperatorCoverage };
