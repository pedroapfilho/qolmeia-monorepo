import type { OperatorCoverage } from "@repo/worker-api/contracts";

import type { Database } from "#/db/client";

const listCoverage = (db: Database, operatorUserId: string): Promise<OperatorCoverage> =>
  db("assignments.get", { operatorUserId });

const setCoverage = async (
  db: Database,
  operatorUserId: string,
  coverage: OperatorCoverage,
): Promise<void> => {
  await db("assignments.set", { coverage, operatorUserId });
};

const listDisciplines = async (db: Database): Promise<ReadonlyArray<string>> => {
  const result = await db("assignments.options", {});
  return result.disciplines;
};

export { listCoverage, listDisciplines, setCoverage };
export type { OperatorCoverage } from "@repo/worker-api/contracts";
