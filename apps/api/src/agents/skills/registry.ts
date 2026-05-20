import type { PrismaClient } from "@repo/db";
import { z } from "zod";

import { delegateToSpecialistSkill } from "./delegate-to-specialist";
import { extractSoulSkill } from "./extract-soul";
import { generateBrandImageSkill } from "./generate-brand-image";
import { labelBrandAssetSkill } from "./label-brand-asset";
import type { AnySkill } from "./types";

const ALL_SKILLS = [
  delegateToSpecialistSkill,
  extractSoulSkill,
  generateBrandImageSkill,
  labelBrandAssetSkill,
] as const satisfies ReadonlyArray<AnySkill>;

const findSkillById = (id: string): AnySkill | undefined =>
  (ALL_SKILLS as ReadonlyArray<AnySkill>).find((s) => s.id === id);

const renderSchema = (schema: AnySkill["inputSchema"]): object => {
  // Zod 4 exposes z.toJSONSchema as a top-level helper. If at runtime this
  // throws (older Zod or unsupported schema feature), the catch returns {}
  // so syncSkills still proceeds — the Skill table column is informational
  // for future admin tooling, never consumed by the runtime.
  try {
    return z.toJSONSchema(schema) as object;
  } catch {
    return {};
  }
};

const syncSkills = async (prisma: Pick<PrismaClient, "skill">): Promise<void> => {
  await Promise.all(
    (ALL_SKILLS as ReadonlyArray<AnySkill>).map((skill) => {
      const baseFields = {
        description: skill.description,
        displayName: skill.displayName,
        parametersJsonSchema: renderSchema(skill.inputSchema),
        requiredConnectorTypes: [...skill.requiredConnectorTypes],
        requiresApprovalDefault: skill.requiresApprovalDefault,
      };
      return prisma.skill.upsert({
        create: { ...baseFields, id: skill.id },
        update: baseFields,
        where: { id: skill.id },
      });
    }),
  );
};

export { ALL_SKILLS, findSkillById, syncSkills };
