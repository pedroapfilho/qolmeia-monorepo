import { apiGet, apiSend } from "@/lib/api-client";
import type {
  SkillCatalogResponse,
  TemplateInput,
  TemplateResponse,
  TemplatesResponse,
  TemplateStatus,
} from "@/lib/api-types";

// Query keys + thin fetch/mutation wrappers for the worker-template catalog.
// Co-located so the list page, the editor, and the skill multi-select share
// one cache namespace.
const templateKeys = {
  all: ["templates"] as const,
  detail: (id: string) => ["templates", id] as const,
  skills: ["template-skills"] as const,
};

const fetchTemplates = () => apiGet<TemplatesResponse>("/templates");

const fetchTemplate = (id: string) => apiGet<TemplateResponse>(`/templates/${id}`);

const fetchSkillCatalog = () => apiGet<SkillCatalogResponse>("/skills");

const createTemplate = (input: TemplateInput) =>
  apiSend<TemplateResponse>("POST", "/templates", input);

const updateTemplate = (id: string, input: TemplateInput) =>
  apiSend<TemplateResponse>("PATCH", `/templates/${id}`, input);

const setTemplateStatus = (id: string, status: TemplateStatus) =>
  apiSend<TemplateResponse>("PATCH", `/templates/${id}/status`, { status });

export {
  createTemplate,
  fetchSkillCatalog,
  fetchTemplate,
  fetchTemplates,
  setTemplateStatus,
  templateKeys,
  updateTemplate,
};
