import { tool, type ToolSet } from "ai";
import type { ZodType } from "zod";

import { listSkillOverlays, type SkillOverlay } from "@/db/template";
import { decideActionSkill } from "@/skills/decide-action";
import { delegateToWorkerSkill } from "@/skills/delegate-to-worker";
import { extractBriefSkill } from "@/skills/extract-brief";
import { generateBrandImageSkill } from "@/skills/generate-brand-image";
import { proposeTeamSkill } from "@/skills/propose-team";
import { recallMemorySkill } from "@/skills/recall-memory";
import { rememberFactSkill } from "@/skills/remember-fact";

// The skill registry — code module pattern (spec decision 10). `execute()` and
// the zod input schema are code; the LLM-facing description, parameter hints,
// `defaultConfig`, and the enabled kill-switch are the D1 `skill` overlay
// (P3 onwards). Each skill takes unknown input + re-parses via its
// inputSchema (defense-in-depth: AI SDK's `tool()` also validates, but
// treating the input as untrusted at the skill boundary is the safer default).
type SkillContext = {
  agentInstanceId: string;
  companyId: string;
  env: Env;
};

type UnknownSkill = {
  description: string;
  execute(input: unknown, ctx: SkillContext): Promise<unknown>;
  id: string;
  inputSchema: ZodType;
};

const ALL_SKILLS: ReadonlyArray<UnknownSkill> = [
  rememberFactSkill,
  recallMemorySkill,
  delegateToWorkerSkill,
  generateBrandImageSkill,
  decideActionSkill,
  extractBriefSkill,
  proposeTeamSkill,
];

const codeRegistry = new Map<string, UnknownSkill>(ALL_SKILLS.map((s) => [s.id, s]));

// Resolves a skill set: joins code (execute + schema) with D1 overlay
// (description / config / enabled). An unknown skill id raises — templates
// can't reference skills that don't exist in code. A disabled overlay is
// silently skipped — that's the operator kill-switch.
const buildSkillTools = async (
  ctx: SkillContext,
  skillIds: ReadonlyArray<string>,
): Promise<ToolSet> => {
  if (skillIds.length === 0) {
    return {};
  }
  const overlays = await listSkillOverlays(ctx.env.DB, skillIds);
  const overlayMap = new Map<string, SkillOverlay>(overlays.map((o) => [o.id, o]));

  const tools: ToolSet = {};
  for (const id of skillIds) {
    const code = codeRegistry.get(id);
    if (!code) {
      throw new Error(`Template references unknown skill id: ${id}`);
    }
    const overlay = overlayMap.get(id);
    if (overlay && !overlay.enabled) {
      continue;
    }
    tools[id] = tool({
      description: overlay?.description ?? code.description,
      execute: (input) => code.execute(input, ctx),
      inputSchema: code.inputSchema,
    });
  }
  return tools;
};

// Test seam — `ALL_SKILLS` is the source of truth in code; the registry
// caches it for lookup-by-id.
const registerSkill = (skill: UnknownSkill): void => {
  codeRegistry.set(skill.id, skill);
};

export { ALL_SKILLS, buildSkillTools, registerSkill };
export type { SkillContext, UnknownSkill };
