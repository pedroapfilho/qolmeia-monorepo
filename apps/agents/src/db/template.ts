import type { AgentTemplate, Skill as PrismaSkill } from "@repo/db/worker";

import type { Database } from "#/db/client";
import { toEnum } from "#/db/mappers";

type TemplateStatus = "active" | "retired";
type Template = {
  createdAt: number;
  defaultActionType: string;
  defaultPolicies: Record<string, string>;
  description: string;
  displayName: string;
  id: string;
  model: string;
  skillIds: ReadonlyArray<string>;
  status: TemplateStatus;
  systemPrompt: string;
  updatedAt: number;
  version: number;
  workerKind: string;
};
type SkillOverlay = {
  defaultConfig: Record<string, unknown> | null;
  description: string;
  displayName: string;
  enabled: boolean;
  id: string;
  paramHints: Record<string, string> | null;
  updatedAt: number;
};

const toTemplateStatus = toEnum<TemplateStatus>(["active", "retired"], "active");
const mapTemplate = (row: AgentTemplate): Template => ({
  createdAt: row.createdAt.getTime(),
  defaultActionType: row.defaultActionType,
  // oxlint-disable-next-line no-unsafe-type-assertion -- JSON column seeded by @repo/db product-seed; shape is owned by this repo
  defaultPolicies: row.defaultPolicies as Record<string, string>,
  description: row.description,
  displayName: row.displayName,
  id: row.id,
  model: row.model,
  // oxlint-disable-next-line no-unsafe-type-assertion -- JSON column seeded by @repo/db product-seed; shape is owned by this repo
  skillIds: row.skillIds as Array<string>,
  status: toTemplateStatus(row.status),
  systemPrompt: row.systemPrompt,
  updatedAt: row.updatedAt.getTime(),
  version: row.version,
  workerKind: row.workerKind,
});
const mapSkillOverlay = (row: PrismaSkill): SkillOverlay => ({
  // oxlint-disable-next-line no-unsafe-type-assertion -- JSON column seeded by @repo/db product-seed; shape is owned by this repo
  defaultConfig: row.defaultConfig as Record<string, unknown> | null,
  description: row.description,
  displayName: row.displayName,
  enabled: row.enabled === 1,
  id: row.id,
  // oxlint-disable-next-line no-unsafe-type-assertion -- JSON column seeded by @repo/db product-seed; shape is owned by this repo
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
      where: { companyId, enabled: 1, templateId },
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
    where: { companyId, enabled: 1, templateId: { in: uniqueIds } },
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
    where: { entitlements: { some: { companyId, enabled: 1 } }, status: "active" },
  });
  return rows.map(mapTemplate);
};
const listAllTemplates = async (db: Database): Promise<ReadonlyArray<Template>> => {
  const rows = await db.agentTemplate.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map(mapTemplate);
};

type TemplateInput = {
  defaultActionType: string;
  defaultPolicies: Record<string, string>;
  description: string;
  displayName: string;
  model: string;
  skillIds: ReadonlyArray<string>;
  systemPrompt: string;
  workerKind: string;
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
export type { SkillOverlay, Template, TemplateInput, TemplateStatus };
