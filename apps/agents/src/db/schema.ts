import type { Company, CompanyOverview } from "@repo/worker-api/contracts";

import type { Database } from "#/db/client";

const getCompany = (db: Database, companyId: string): Promise<Company | null> =>
  db("companies.get", { companyId });

const listCompaniesOverview = (db: Database): Promise<ReadonlyArray<CompanyOverview>> =>
  db("companies.listOverview", {});

type InsertMemoryFactInput = {
  agentInstanceId: string;
  companyId: string;
  content: string;
  id: string;
  kind: string;
  salience?: number;
};

const insertMemoryFact = async (db: Database, input: InsertMemoryFactInput): Promise<void> => {
  await db("memory.insert", input);
};

export { getCompany, insertMemoryFact, listCompaniesOverview };
export type { Company, CompanyOverview } from "@repo/worker-api/contracts";
