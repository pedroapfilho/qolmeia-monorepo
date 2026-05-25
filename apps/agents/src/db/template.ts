// Typed shapes + queries for the catalog (template, skill). Skills here are
// the operator-tunable D1 overlay over the code skill registry — the code
// owns `execute` and the input schema; D1 owns the LLM-facing description,
// per-parameter hints, default config, and the enabled kill-switch.

type TemplateStatus = "active" | "retired";

type Template = {
  createdAt: number;
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

const safeJson = <T>(value: string | null, fallback: T): T => {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const toTemplateStatus = (value: string): TemplateStatus =>
  value === "retired" ? "retired" : "active";

const mapTemplate = (row: TemplateRow): Template => ({
  createdAt: row.created_at,
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

const getTemplateByWorkerKind = async (
  db: D1Database,
  workerKind: string,
): Promise<Template | null> => {
  const row = await db
    .prepare("SELECT * FROM template WHERE worker_kind = ? AND status = 'active' LIMIT 1")
    .bind(workerKind)
    .first<TemplateRow>();
  return row ? mapTemplate(row) : null;
};

const listActiveTemplates = async (db: D1Database): Promise<ReadonlyArray<Template>> => {
  const { results } = await db
    .prepare("SELECT * FROM template WHERE status = 'active' ORDER BY display_name ASC")
    .all<TemplateRow>();
  return results.map(mapTemplate);
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
  getTemplate,
  getTemplateByWorkerKind,
  listActiveTemplates,
  listSkillOverlays,
};
export type { SkillOverlay, Template, TemplateStatus };
