import { safeJson, toEnum } from "#/db/mappers";

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

type TemplateRow = {
  created_at: number;
  default_action_type: string | null;
  default_policies: string;
  description: string;
  display_name: string;
  id: string;
  model: string;
  skill_ids: string;
  status: string;
  system_prompt: string;
  updated_at: number;
  version: number;
  worker_kind: string;
};

type SkillRow = {
  default_config: string | null;
  description: string;
  display_name: string;
  enabled: number;
  id: string;
  param_hints: string | null;
  updated_at: number;
};

const toTemplateStatus = toEnum<TemplateStatus>(["active", "retired"], "active");

const mapTemplate = (row: TemplateRow): Template => ({
  createdAt: row.created_at,
  defaultActionType: row.default_action_type ?? "worker_deliverable",
  defaultPolicies: safeJson<Record<string, string>>(row.default_policies, {}),
  description: row.description,
  displayName: row.display_name,
  id: row.id,
  model: row.model,
  skillIds: safeJson<Array<string>>(row.skill_ids, []),
  status: toTemplateStatus(row.status),
  systemPrompt: row.system_prompt,
  updatedAt: row.updated_at,
  version: row.version,
  workerKind: row.worker_kind,
});

const mapSkillOverlay = (row: SkillRow): SkillOverlay => ({
  defaultConfig: safeJson<Record<string, unknown> | null>(row.default_config, null),
  description: row.description,
  displayName: row.display_name,
  enabled: row.enabled === 1,
  id: row.id,
  paramHints: safeJson<Record<string, string> | null>(row.param_hints, null),
  updatedAt: row.updated_at,
});

const getTemplate = async (db: D1Database, id: string): Promise<Template | null> => {
  const row = await db.prepare("SELECT * FROM template WHERE id = ?").bind(id).first<TemplateRow>();
  return row ? mapTemplate(row) : null;
};

const isTemplateEntitledForCompany = async (
  db: D1Database,
  companyId: string,
  templateId: string,
): Promise<boolean> => {
  const row = await db
    .prepare(
      `SELECT 1 AS one
         FROM company_template_entitlement
        WHERE company_id = ? AND template_id = ? AND enabled = 1
        LIMIT 1`,
    )
    .bind(companyId, templateId)
    .first<{ one: number }>();
  return Boolean(row);
};

const assertTemplatesEntitledForCompany = async (
  db: D1Database,
  companyId: string,
  templateIds: ReadonlyArray<string>,
): Promise<void> => {
  const uniqueIds = [...new Set(templateIds)].filter(Boolean);
  if (uniqueIds.length === 0) {
    return;
  }
  const placeholders = uniqueIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT template_id
         FROM company_template_entitlement
        WHERE company_id = ? AND enabled = 1
          AND template_id IN (${placeholders})`,
    )
    .bind(companyId, ...uniqueIds)
    .all<{ template_id: string }>();
  const entitled = new Set(results.map((row) => row.template_id));
  const missing = uniqueIds.find((id) => !entitled.has(id));
  if (missing !== undefined) {
    throw new Error(`Template ${missing} is not entitled for company ${companyId}`);
  }
};

const entitleCompanyToAllActiveTemplates = async (
  db: D1Database,
  companyId: string,
): Promise<void> => {
  const now = Date.now();
  await db
    .prepare(
      `INSERT OR IGNORE INTO company_template_entitlement
         (company_id, template_id, enabled, created_at, updated_at)
       SELECT ?, id, 1, ?, ?
         FROM template
        WHERE status = 'active'`,
    )
    .bind(companyId, now, now)
    .run();
};

const listEntitledActiveTemplates = async (
  db: D1Database,
  companyId: string,
): Promise<ReadonlyArray<Template>> => {
  const { results } = await db
    .prepare(
      `SELECT t.*
         FROM template t
         JOIN company_template_entitlement e ON e.template_id = t.id
        WHERE e.company_id = ? AND e.enabled = 1 AND t.status = 'active'
        ORDER BY t.display_name ASC`,
    )
    .bind(companyId)
    .all<TemplateRow>();
  return results.map(mapTemplate);
};

const listAllTemplates = async (db: D1Database): Promise<ReadonlyArray<Template>> => {
  const { results } = await db
    .prepare("SELECT * FROM template ORDER BY created_at DESC")
    .all<TemplateRow>();
  return results.map(mapTemplate);
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

const createTemplate = async (db: D1Database, input: TemplateInput): Promise<Template> => {
  const id = `tpl-${crypto.randomUUID()}`;
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO template
         (id, worker_kind, display_name, description, system_prompt, model,
          skill_ids, default_policies, default_action_type, status, version,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
    )
    .bind(
      id,
      input.workerKind,
      input.displayName,
      input.description,
      input.systemPrompt,
      input.model,
      JSON.stringify(input.skillIds),
      JSON.stringify(input.defaultPolicies),
      input.defaultActionType,
      now,
      now,
    )
    .run();
  const created = await getTemplate(db, id);
  if (!created) {
    throw new Error(`Failed to create template ${id}`);
  }
  return created;
};

const updateTemplate = async (
  db: D1Database,
  id: string,
  input: TemplateInput,
): Promise<Template | null> => {
  const now = Date.now();
  const result = await db
    .prepare(
      `UPDATE template
         SET worker_kind = ?, display_name = ?, description = ?, system_prompt = ?,
             model = ?, skill_ids = ?, default_policies = ?, default_action_type = ?,
             version = version + 1, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.workerKind,
      input.displayName,
      input.description,
      input.systemPrompt,
      input.model,
      JSON.stringify(input.skillIds),
      JSON.stringify(input.defaultPolicies),
      input.defaultActionType,
      now,
      id,
    )
    .run();
  if (result.meta.changes === 0) {
    return null;
  }
  return getTemplate(db, id);
};

const setTemplateStatus = async (
  db: D1Database,
  id: string,
  status: TemplateStatus,
): Promise<Template | null> => {
  const result = await db
    .prepare("UPDATE template SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, Date.now(), id)
    .run();
  if (result.meta.changes === 0) {
    return null;
  }
  return getTemplate(db, id);
};

const listSkillOverlays = async (
  db: D1Database,
  skillIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<SkillOverlay>> => {
  if (skillIds.length === 0) {
    return [];
  }
  const placeholders = skillIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT * FROM skill WHERE id IN (${placeholders})`)
    .bind(...skillIds)
    .all<SkillRow>();
  return results.map(mapSkillOverlay);
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
