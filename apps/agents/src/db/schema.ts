import type { CompanyStatus } from "@repo/db/worker";
import { briefCompleteness, parseBrief } from "@repo/worker-api/brief";
import type { Company, CompanyOverview } from "@repo/worker-api/contracts";

import type { Database } from "#/db/client";

const mapCompany = (row: {
  brief: unknown;
  createdAt: Date;
  id: string;
  locale: string;
  name: string;
  slug: string;
  status: CompanyStatus;
  timezone: string;
  updatedAt: Date;
}): Company => ({
  brief: parseBrief(row.brief),
  createdAt: row.createdAt.getTime(),
  id: row.id,
  locale: row.locale,
  name: row.name,
  slug: row.slug,
  status: row.status,
  timezone: row.timezone,
  updatedAt: row.updatedAt.getTime(),
});

const getCompany = async (db: Database, id: string): Promise<Company | null> => {
  const row = await db.company.findUnique({ where: { id } });
  return row ? mapCompany(row) : null;
};

const listCompaniesOverview = async (db: Database): Promise<Array<CompanyOverview>> => {
  const rows = await db.company.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map((row) => ({
    briefPercent: briefCompleteness(parseBrief(row.brief)).percent,
    id: row.id,
    name: row.name,
    status: row.status,
  }));
};

type InsertMemoryFactInput = {
  agentInstanceId: string;
  companyId: string;
  content: string;
  id: string;
  kind: string;
  salience?: number;
};
const insertMemoryFact = async (db: Database, input: InsertMemoryFactInput): Promise<void> => {
  await db.memoryFact.upsert({
    create: { ...input, salience: input.salience ?? 0.5 },
    update: {},
    where: { id: input.id },
  });
};

export { getCompany, insertMemoryFact, listCompaniesOverview };
export type { Company, CompanyOverview } from "@repo/worker-api/contracts";
