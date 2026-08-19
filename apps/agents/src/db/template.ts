import type {
  SkillOverlay,
  Template,
  TemplateInput,
  TemplateStatus,
} from "@repo/worker-api/contracts";

import type { Database } from "#/db/client";

const getTemplate = (db: Database, templateId: string): Promise<Template | null> =>
  db("templates.get", { templateId });

const listEntitledActiveTemplates = (
  db: Database,
  companyId: string,
): Promise<ReadonlyArray<Template>> => db("templates.listActive", { companyId });

const listAllTemplates = (db: Database): Promise<ReadonlyArray<Template>> =>
  db("templates.listAll", {});

const createTemplate = (db: Database, input: TemplateInput): Promise<Template> =>
  db("templates.create", input);

const updateTemplate = (
  db: Database,
  templateId: string,
  input: TemplateInput,
): Promise<Template | null> => db("templates.update", { ...input, templateId });

const setTemplateStatus = (
  db: Database,
  templateId: string,
  status: TemplateStatus,
): Promise<Template | null> => db("templates.setStatus", { status, templateId });

const listSkillOverlays = (
  db: Database,
  skillIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<SkillOverlay>> => db("templates.overlays", { skillIds });

export {
  createTemplate,
  getTemplate,
  listAllTemplates,
  listEntitledActiveTemplates,
  listSkillOverlays,
  setTemplateStatus,
  updateTemplate,
};
export type {
  SkillOverlay,
  Template,
  TemplateInput,
  TemplateStatus,
} from "@repo/worker-api/contracts";
