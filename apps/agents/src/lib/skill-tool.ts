import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as z from "zod";

import { resolveSkills, type SkillContext } from "#/skills/registry";

const buildFlueTools = async (
  ctx: SkillContext,
  skillIds: ReadonlyArray<string>,
): Promise<Array<ToolDefinition>> => {
  const resolved = await resolveSkills(ctx, skillIds);
  return resolved.map((skill) =>
    defineTool({
      description: skill.description,
      execute: async (args) => JSON.stringify(await skill.execute(args)),
      name: skill.id,
      parameters: z.toJSONSchema(skill.inputSchema),
    }),
  );
};

export { buildFlueTools };
