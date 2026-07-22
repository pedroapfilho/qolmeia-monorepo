import type { Database } from "#/db/client";
import { toEnum } from "#/db/mappers";
import { briefCompleteness, parseBrief } from "#/lib/company-brief";

type CompanyStatus = "active" | "onboarding" | "paused";
type Company = {
  brief: string | null;
  createdAt: number;
  id: string;
  locale: string;
  name: string;
  slug: string;
  status: CompanyStatus;
  timezone: string;
  updatedAt: number;
};

const toCompanyStatus = toEnum<CompanyStatus>(["onboarding", "active", "paused"], "onboarding");
const mapCompany = (row: {
  brief: unknown;
  createdAt: Date;
  id: string;
  locale: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
  updatedAt: Date;
}): Company => ({
  brief: row.brief === null ? null : JSON.stringify(row.brief),
  createdAt: row.createdAt.getTime(),
  id: row.id,
  locale: row.locale,
  name: row.name,
  slug: row.slug,
  status: toCompanyStatus(row.status),
  timezone: row.timezone,
  updatedAt: row.updatedAt.getTime(),
});

const getCompany = async (db: Database, id: string): Promise<Company | null> => {
  const row = await db.company.findUnique({ where: { id } });
  return row ? mapCompany(row) : null;
};

type CompanyOverview = { briefPercent: number; id: string; name: string; status: CompanyStatus };
const listCompaniesOverview = async (db: Database): Promise<Array<CompanyOverview>> => {
  const rows = await db.company.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map((row) => ({
    briefPercent: briefCompleteness(parseBrief(row.brief)).percent,
    id: row.id,
    name: row.name,
    status: toCompanyStatus(row.status),
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
export type { Company, CompanyOverview };
