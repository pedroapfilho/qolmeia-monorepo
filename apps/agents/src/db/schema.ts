import { briefCompleteness, parseBrief } from "#/lib/company-brief";

type CompanyStatus = "onboarding" | "active" | "paused";

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

type CompanyRow = {
  brief: string | null;
  created_at: number;
  id: string;
  locale: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
  updated_at: number;
};

const COMPANY_STATUSES: ReadonlyArray<CompanyStatus> = ["onboarding", "active", "paused"];

const toCompanyStatus = (value: string): CompanyStatus =>
  COMPANY_STATUSES.find((status) => status === value) ?? "onboarding";

const mapCompany = (row: CompanyRow): Company => ({
  brief: row.brief,
  createdAt: row.created_at,
  id: row.id,
  locale: row.locale,
  name: row.name,
  slug: row.slug,
  status: toCompanyStatus(row.status),
  timezone: row.timezone,
  updatedAt: row.updated_at,
});

const getCompany = async (db: D1Database, id: string): Promise<Company | null> => {
  const row = await db.prepare("SELECT * FROM company WHERE id = ?").bind(id).first<CompanyRow>();
  return row ? mapCompany(row) : null;
};

type CompanyOverview = {
  briefPercent: number;
  id: string;
  name: string;
  status: CompanyStatus;
};

const listCompaniesOverview = async (db: D1Database): Promise<Array<CompanyOverview>> => {
  const { results } = await db
    .prepare("SELECT id, name, status, brief FROM company ORDER BY created_at ASC")
    .all<{ brief: string | null; id: string; name: string; status: string }>();
  return results.map((row) => ({
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

const insertMemoryFact = async (db: D1Database, input: InsertMemoryFactInput): Promise<void> => {
  await db
    .prepare(
      `INSERT OR IGNORE INTO memory_fact
         (id, company_id, agent_instance_id, kind, content, salience, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.companyId,
      input.agentInstanceId,
      input.kind,
      input.content,
      input.salience ?? 0.5,
      Date.now(),
    )
    .run();
};

export { getCompany, insertMemoryFact, listCompaniesOverview };
export type { Company, CompanyOverview };
