import type { AgentTemplate, Skill as PrismaSkill } from "@repo/db/worker";
import type { Template, TemplateInput, TemplateStatus } from "@repo/worker-api/contracts";

import type { Database } from "#/db/client";

type SkillOverlay = {
  defaultConfig: Record<string, unknown> | null;
  description: string;
  displayName: string;
  enabled: boolean;
  id: string;
  paramHints: Record<string, string> | null;
  updatedAt: number;
};

const mapTemplate = (row: AgentTemplate): Template => ({
  createdAt: row.createdAt.getTime(),
  defaultActionType: row.defaultActionType,
  // SAFETY: The product seed owns this JSON column and writes string policy values.
  // oxlint-disable-next-line no-unsafe-type-assertion
  defaultPolicies: row.defaultPolicies as Record<string, string>,
  description: row.description,
  displayName: row.displayName,
  id: row.id,
  model: row.model,
  // SAFETY: The product seed owns this JSON column and writes string skill IDs.
  // oxlint-disable-next-line no-unsafe-type-assertion
  skillIds: row.skillIds as Array<string>,
  status: row.status,
  systemPrompt: row.systemPrompt,
  updatedAt: row.updatedAt.getTime(),
  version: row.version,
  workerKind: row.workerKind,
});
const mapSkillOverlay = (row: PrismaSkill): SkillOverlay => ({
  // SAFETY: The product seed owns this JSON column and writes object configuration.
  // oxlint-disable-next-line no-unsafe-type-assertion
  defaultConfig: row.defaultConfig as Record<string, unknown> | null,
  description: row.description,
  displayName: row.displayName,
  enabled: row.enabled,
  id: row.id,
  // SAFETY: The product seed owns this JSON column and writes string hints.
  // oxlint-disable-next-line no-unsafe-type-assertion
  paramHints: row.paramHints as Record<string, string> | null,
  updatedAt: row.updatedAt.getTime(),
});

const getTemplate = async (db: Database, id: string): Promise<Template | null> => {
  const row = await db.agentTemplate.findUnique({ where: { id } });
  return row ? mapTemplate(row) : null;
};
const isTemplateEntitledForCompany = async (
  db: Database,
  companyId: string,
  templateId: string,
): Promise<boolean> =>
  Boolean(
    await db.companyTemplateEntitlement.findFirst({
      select: { companyId: true },
      where: { companyId, enabled: true, templateId },
    }),
  );

const assertTemplatesEntitledForCompany = async (
  db: Database,
  companyId: string,
  templateIds: ReadonlyArray<string>,
): Promise<void> => {
  const uniqueIds = [...new Set(templateIds)].filter(Boolean);
  if (!uniqueIds.length) {
    return;
  }
  const rows = await db.companyTemplateEntitlement.findMany({
    select: { templateId: true },
    where: { companyId, enabled: true, templateId: { in: uniqueIds } },
  });
  const entitled = new Set(rows.map((row) => row.templateId));
  const missing = uniqueIds.find((id) => !entitled.has(id));
  if (missing !== undefined) {
    throw new Error(`Template ${missing} is not entitled for company ${companyId}`);
  }
};

const entitleCompanyToAllActiveTemplates = async (
  db: Database,
  companyId: string,
): Promise<void> => {
  const templates = await db.agentTemplate.findMany({
    select: { id: true },
    where: { status: "active" },
  });
  await db.companyTemplateEntitlement.createMany({
    data: templates.map(({ id: templateId }) => ({ companyId, templateId })),
    skipDuplicates: true,
  });
};

const listEntitledActiveTemplates = async (
  db: Database,
  companyId: string,
): Promise<ReadonlyArray<Template>> => {
  const rows = await db.agentTemplate.findMany({
    orderBy: { displayName: "asc" },
    where: { entitlements: { some: { companyId, enabled: true } }, status: "active" },
  });
  return rows.map(mapTemplate);
};
const listAllTemplates = async (db: Database): Promise<ReadonlyArray<Template>> => {
  const rows = await db.agentTemplate.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map(mapTemplate);
};

const createTemplate = async (db: Database, input: TemplateInput): Promise<Template> =>
  mapTemplate(
    await db.agentTemplate.create({
      data: { ...input, id: `tpl-${crypto.randomUUID()}`, skillIds: [...input.skillIds] },
    }),
  );
const updateTemplate = async (
  db: Database,
  id: string,
  input: TemplateInput,
): Promise<Template | null> => {
  const result = await db.agentTemplate.updateMany({
    data: { ...input, skillIds: [...input.skillIds], version: { increment: 1 } },
    where: { id },
  });
  return result.count ? getTemplate(db, id) : null;
};
const setTemplateStatus = async (
  db: Database,
  id: string,
  status: TemplateStatus,
): Promise<Template | null> => {
  const result = await db.agentTemplate.updateMany({ data: { status }, where: { id } });
  return result.count ? getTemplate(db, id) : null;
};

const listSkillOverlays = async (
  db: Database,
  skillIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<SkillOverlay>> => {
  if (!skillIds.length) {
    return [];
  }
  const rows = await db.skill.findMany({ where: { id: { in: [...skillIds] } } });
  return rows.map(mapSkillOverlay);
};

export {
  assertTemplatesEntitledForCompany,
  createTemplate,
  entitleCompanyToAllActiveTemplates,
  getTemplate,
  isTemplateEntitledForCompany,
  listAllTemplates,
  listEntitledActiveTemplates,
  listSkillOverlays,
  setTemplateStatus,
  updateTemplate,
};
export type { SkillOverlay };
export type { Template, TemplateInput, TemplateStatus } from "@repo/worker-api/contracts";
