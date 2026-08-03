import { tool, type ToolSet } from "ai";
import type { ZodType } from "zod";

import { getDb } from "#/db/client";
import { listSkillOverlays } from "#/db/template";
import { logError, logInfo } from "#/lib/logger";
import { listAssetsSkill, readAssetSkill, saveAssetSkill } from "#/skills/assets";
import { decideActionSkill } from "#/skills/decide-action";
import { delegateToWorkerSkill } from "#/skills/delegate-to-worker";
import { draftSocialPostSkill } from "#/skills/draft-social-post";
import { extractBriefSkill } from "#/skills/extract-brief";
import { fetchUrlSkill } from "#/skills/fetch-url";
import { generateBrandImageSkill } from "#/skills/generate-brand-image";
import { proposeTeamSkill } from "#/skills/propose-team";
import { recallMemorySkill } from "#/skills/recall-memory";
import { rememberFactSkill } from "#/skills/remember-fact";
import { webSearchSkill } from "#/skills/web-search";

type SkillContext = {
  agentInstanceId: string;
  companyId: string;
  env: Env;
};

type UnknownSkill = {
  description: string;
  execute: (input: unknown, ctx: SkillContext) => Promise<unknown>;
  id: string;
  inputSchema: ZodType;
};

const ALL_SKILLS: ReadonlyArray<UnknownSkill> = [
  rememberFactSkill,
  recallMemorySkill,
  delegateToWorkerSkill,
  generateBrandImageSkill,
  draftSocialPostSkill,
  decideActionSkill,
  extractBriefSkill,
  proposeTeamSkill,
  listAssetsSkill,
  readAssetSkill,
  saveAssetSkill,
  webSearchSkill,
  fetchUrlSkill,
];

const codeRegistry = new Map<string, UnknownSkill>(ALL_SKILLS.map((s) => [s.id, s]));

const previewResult = (result: unknown): unknown => {
  if (typeof result === "string") {
    return result.slice(0, 200);
  }
  if (typeof result === "number" || typeof result === "boolean" || typeof result === "bigint") {
    return String(result).slice(0, 200);
  }
  return result;
};

type ResolvedSkill = {
  description: string;
  execute: (input: unknown) => Promise<unknown>;
  id: string;
  inputSchema: ZodType;
};

const runSkill = async (
  ctx: SkillContext,
  id: string,
  code: UnknownSkill,
  input: unknown,
): Promise<unknown> => {
  const start = Date.now();
  const baseFields = {
    agentInstanceId: ctx.agentInstanceId,
    companyId: ctx.companyId,
    input: JSON.stringify(input),
    skillId: id,
  };
  logInfo("agent.tool.start", baseFields);
  try {
    // Agent renders are synchronous and use a persisted overlay snapshot. Read
    // the current row again at the execution boundary so a newly-disabled
    // skill cannot run during the one-render refresh window.
    const [liveOverlay] = await listSkillOverlays(getDb(ctx.env), [id]);
    if (liveOverlay !== undefined && !liveOverlay.enabled) {
      throw new Error(`Skill "${id}" is disabled`);
    }
    const result = await code.execute(input, ctx);
    logInfo("agent.tool.ok", {
      ...baseFields,
      durationMs: Date.now() - start,
      result: JSON.stringify(previewResult(result)),
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError("agent.tool.err", { ...baseFields, durationMs: Date.now() - start, error: message });
    throw error;
  }
};

// Flue 2 agent functions must be synchronous, so the overlay read (one
// Postgres query) is split off from tool assembly: agents await it in
// useAgentStart on every delivery and hand the latest persisted snapshot to a
// synchronous resolveSkills. runSkill independently enforces the live switch.
// Narrow projection, because it round-trips through usePersistentState and
// must stay JSON.
type SkillOverlaySnapshot = { description: string; enabled: boolean };
type SkillOverlayMap = Record<string, SkillOverlaySnapshot>;

const loadSkillOverlays = async (
  env: Env,
  skillIds: ReadonlyArray<string>,
): Promise<SkillOverlayMap> => {
  if (skillIds.length === 0) {
    return {};
  }
  const overlays = await listSkillOverlays(getDb(env), skillIds);
  const map: SkillOverlayMap = {};
  for (const overlay of overlays) {
    map[overlay.id] = { description: overlay.description, enabled: overlay.enabled };
  }
  return map;
};

const resolveSkills = (
  ctx: SkillContext,
  skillIds: ReadonlyArray<string>,
  overlays: SkillOverlayMap | null,
): ReadonlyArray<ResolvedSkill> => {
  const resolved: Array<ResolvedSkill> = [];
  for (const id of skillIds) {
    const code = codeRegistry.get(id);
    if (!code) {
      throw new Error(`References unknown skill id: ${id}`);
    }
    const overlay = overlays?.[id];
    if (overlay && !overlay.enabled) {
      continue;
    }
    resolved.push({
      description: overlay?.description ?? code.description,
      execute: (input) => runSkill(ctx, id, code, input),
      id,
      inputSchema: code.inputSchema,
    });
  }
  return resolved;
};

const buildSkillTools = async (
  ctx: SkillContext,
  skillIds: ReadonlyArray<string>,
): Promise<ToolSet> => {
  const overlays = await loadSkillOverlays(ctx.env, skillIds);
  const tools: ToolSet = {};
  for (const skill of resolveSkills(ctx, skillIds, overlays)) {
    tools[skill.id] = tool({
      description: skill.description,
      execute: skill.execute,
      inputSchema: skill.inputSchema,
    });
  }
  return tools;
};

const registerSkill = (skill: UnknownSkill): void => {
  codeRegistry.set(skill.id, skill);
};

const isKnownSkill = (id: string): boolean => codeRegistry.has(id);

type SkillCatalogEntry = {
  description: string;
  displayName: string;
  id: string;
};

const skillDisplayName = (id: string): string =>
  id
    .replaceAll(/(?<lower>[a-z0-9])(?<upper>[A-Z])/gv, "$<lower> $<upper>")
    .split(/\s+/v)
    .filter(Boolean)
    .map((w) => w.charAt(0).toLocaleUpperCase("pt-BR") + w.slice(1))
    .join(" ");

const listSkillCatalog = (): ReadonlyArray<SkillCatalogEntry> =>
  ALL_SKILLS.map((s) => ({
    description: s.description,
    displayName: skillDisplayName(s.id),
    id: s.id,
  })).toSorted((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));

export {
  buildSkillTools,
  isKnownSkill,
  listSkillCatalog,
  loadSkillOverlays,
  registerSkill,
  resolveSkills,
};
export type { ResolvedSkill, SkillCatalogEntry, SkillContext, SkillOverlayMap, UnknownSkill };
