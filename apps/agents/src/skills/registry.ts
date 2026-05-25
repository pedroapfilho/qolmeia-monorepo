import { tool, type ToolSet } from "ai";
import type { ZodType } from "zod";

import { recallMemorySkill } from "@/skills/recall-memory";
import { rememberFactSkill } from "@/skills/remember-fact";

// The skill registry — code module pattern (spec decision 10). P3 will add
// the D1 `skill` overlay that lets operators tune description/config without
// a deploy; for P2 the description lives here. Each skill takes unknown
// input + re-parses via its inputSchema (defense-in-depth: AI SDK's `tool()`
// also validates, but treating the input as untrusted at the skill boundary
// is the safer default).
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

const ALL_SKILLS: ReadonlyArray<UnknownSkill> = [rememberFactSkill, recallMemorySkill];

const buildSkillTools = (ctx: SkillContext): ToolSet => {
  const tools: ToolSet = {};
  for (const skill of ALL_SKILLS) {
    tools[skill.id] = tool({
      description: skill.description,
      execute: (input) => skill.execute(input, ctx),
      inputSchema: skill.inputSchema,
    });
  }
  return tools;
};

export { ALL_SKILLS, buildSkillTools };
export type { SkillContext, UnknownSkill };
