import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as z from "zod";

import type { SkillContext, UnknownSkill } from "@/skills/registry";

// Wraps one of our code skills (skills/registry.ts `UnknownSkill`) as a Flue
// tool. The zod `inputSchema` converts to JSON Schema — defineTool accepts raw
// JSON Schema, so there's no valibot rewrite — `execute` reuses the existing
// skill against the closed-over context, and the result is JSON-stringified for
// the model. (The D1 skill overlay — operator-tunable descriptions + the
// per-skill kill-switch — is not applied here yet; rebuilding that is a later
// piece of the migration.)
const skillTool = (skill: UnknownSkill, ctx: SkillContext): ToolDefinition =>
  defineTool({
    description: skill.description,
    execute: async (args) => JSON.stringify(await skill.execute(args, ctx)),
    name: skill.id,
    parameters: z.toJSONSchema(skill.inputSchema),
  });

export { skillTool };
