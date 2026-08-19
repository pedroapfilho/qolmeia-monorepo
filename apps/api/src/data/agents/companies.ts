import { briefCompleteness, mergeBrief, parseBrief } from "@repo/worker-api/brief";
import type { Company, CompanyOverview } from "@repo/worker-api/contracts";
import { correspondentIdFor, plannerIdFor } from "@repo/worker-api/contracts";
import type { CustomerCompany } from "@repo/worker-api/internal";

import { entitleCompanyToAllActiveTemplates } from "./templates";
import type { Database } from "./types";

const mapCompany = (row: {
  brief: unknown;
  createdAt: Date;
  id: string;
  locale: string;
  name: string;
  slug: string;
  status: Company["status"];
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

const getCustomerCompany = async (db: Database, id: string): Promise<CustomerCompany | null> => {
  const row = await db.company.findUnique({
    select: { brief: true, id: true, slug: true, status: true },
    where: { id },
  });
  return row ? { ...row, brief: parseBrief(row.brief) } : null;
};

const updateCompanyBrief = async (
  db: Database,
  companyId: string,
  updates: Parameters<typeof mergeBrief>[1],
): Promise<CustomerCompany | null> => {
  const company = await getCustomerCompany(db, companyId);
  if (!company) {
    return null;
  }
  const brief = mergeBrief(company.brief, updates);
  await db.company.update({ data: { brief }, where: { id: companyId } });
  return { ...company, brief };
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

const listProactiveCompanies = async (db: Database) => {
  const rows = await db.company.findMany({
    select: { brief: true, id: true },
    where: { status: "active" },
  });
  return rows.map((row) => ({ brief: parseBrief(row.brief), id: row.id }));
};

const insertMemoryFact = async (
  db: Database,
  input: {
    agentInstanceId: string;
    companyId: string;
    content: string;
    id: string;
    kind: string;
    salience?: number;
  },
): Promise<void> => {
  await db.memoryFact.upsert({
    create: { ...input, salience: input.salience ?? 0.5 },
    update: {},
    where: { id: input.id },
  });
};

const provisionCompany = async (
  db: Database,
  input: { id: string; name: string; slug: string },
): Promise<{ ok: true }> => {
  await db.company.upsert({
    create: input,
    update: { name: input.name, slug: input.slug },
    where: { id: input.id },
  });
  await db.agentInstance.createMany({
    data: [
      {
        companyId: input.id,
        displayName: "Correspondente Qolmeia",
        id: correspondentIdFor(input.id),
        role: "correspondent",
      },
      {
        companyId: input.id,
        displayName: "Planejador Qolmeia",
        id: plannerIdFor(input.id),
        role: "planner",
      },
    ],
    skipDuplicates: true,
  });
  await entitleCompanyToAllActiveTemplates(db, input.id);
  return { ok: true };
};

const lastProactiveSuggestionAt = async (
  db: Database,
  companyId: string,
): Promise<number | null> => {
  const row = await db.activityLog.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
    where: { companyId, type: "WORKER_PROACTIVE_SUGGESTION" },
  });
  return row?.createdAt.getTime() ?? null;
};

export {
  getCompany,
  getCustomerCompany,
  insertMemoryFact,
  lastProactiveSuggestionAt,
  listCompaniesOverview,
  listProactiveCompanies,
  provisionCompany,
  updateCompanyBrief,
};
