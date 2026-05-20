import { extractSoulSkill } from "./extract-soul";
import { generateBrandImageSkill } from "./generate-brand-image";
import { labelBrandAssetSkill } from "./label-brand-asset";
import type { Skill } from "./types";

const ALL_SKILLS: ReadonlyArray<Skill<unknown, unknown>> = [
  extractSoulSkill as Skill<unknown, unknown>,
  generateBrandImageSkill as Skill<unknown, unknown>,
  labelBrandAssetSkill as Skill<unknown, unknown>,
];

export { ALL_SKILLS };
