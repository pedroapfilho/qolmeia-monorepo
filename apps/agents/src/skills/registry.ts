import { tool, type ToolSet } from "ai";
import type { ZodType } from "zod";

import { listSkillOverlays, type SkillOverlay } from "@/db/template";
import { logError, logInfo } from "@/lib/logger";
import { decideActionSkill } from "@/skills/decide-action";
import { delegateToWorkerSkill } from "@/skills/delegate-to-worker";
import { draftSocialPostSkill } from "@/skills/draft-social-post";
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
];

const codeRegistry = new Map<string, UnknownSkill>(ALL_SKILLS.map((s) => [s.id, s]));

// Trim a result preview so the log line stays bounded. The full result
// goes back to the model regardless; this is only for observability.
const previewResult = (result: unknown): unknown => {
  if (result === null || result === undefined) {
    return result;
  }
  if (typeof result === "object") {
    return result;
  }
  return String(result).slice(0, 200);
};

// Resolves a skill set: joins code (execute + schema) with D1 overlay
// (description / config / enabled). An unknown skill id raises — templates
// can't reference skills that don't exist in code. A disabled overlay is
// silently skipped — that's the operator kill-switch.
//
// Every tool call emits `agent.tool.start` + `agent.tool.ok|err` so the
// trace is visible in `wrangler tail` / Workers Observability. Inputs +
// results land truncated by the logger so a chat that generates a 2KB
// image-prompt doesn't bloat the log line.
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
      execute: async (input) => {
        const start = Date.now();
        const baseFields = {
          agentInstanceId: ctx.agentInstanceId,
          companyId: ctx.companyId,
          input: JSON.stringify(input),
          skillId: id,
        };
        logInfo("agent.tool.start", baseFields);
        try {
          const result = await code.execute(input, ctx);
          logInfo("agent.tool.ok", {
            ...baseFields,
            durationMs: Date.now() - start,
            result: JSON.stringify(previewResult(result)),
          });
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logError("agent.tool.err", {
            ...baseFields,
            durationMs: Date.now() - start,
            error: message,
          });
          throw error;
        }
      },
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
