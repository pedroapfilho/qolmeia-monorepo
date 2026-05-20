import { extractSoulSkill } from "./extract-soul";
import type { Skill } from "./types";

const ALL_SKILLS: ReadonlyArray<Skill<unknown, unknown>> = [
  extractSoulSkill as Skill<unknown, unknown>,
];

export { ALL_SKILLS };
