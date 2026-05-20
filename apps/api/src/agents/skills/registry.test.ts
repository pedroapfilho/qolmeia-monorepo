import { describe, expect, it, vi } from "vitest";

import { ALL_SKILLS, findSkillById, syncSkills } from "./registry";

describe("skill registry", () => {
  it("exports the 3 Phase 5b skills", () => {
    const ids = ALL_SKILLS.map((s) => s.id).toSorted();
    expect(ids).toEqual(["extractSoul", "generateBrandImage", "labelBrandAsset"]);
  });

  it("findSkillById returns the matching skill or undefined", () => {
    expect(findSkillById("extractSoul")?.id).toBe("extractSoul");
    expect(findSkillById("nonexistent")).toBeUndefined();
  });

  it("syncSkills upserts each skill into the Skill table with rendered JSON schema", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const fakePrisma = { skill: { upsert } } as never;

    await syncSkills(fakePrisma);

    expect(upsert).toHaveBeenCalledTimes(3);
    const firstCallArg = upsert.mock.calls[0]![0] as {
      create: {
        description: string;
        displayName: string;
        id: string;
        parametersJsonSchema: object;
      };
      update: { description: string };
      where: { id: string };
    };
    expect(firstCallArg.where).toEqual({ id: firstCallArg.create.id });
    expect(firstCallArg.create.parametersJsonSchema).toBeTypeOf("object");
    expect(firstCallArg.create.displayName.length).toBeGreaterThan(0);
  });
});
