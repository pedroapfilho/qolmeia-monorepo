import { describe, expect, it } from "vitest";

import { getSkillRenderer } from "./index";

describe("getSkillRenderer", () => {
  it("returns null for any skill id today (registry is empty)", () => {
    expect(getSkillRenderer("anything")).toBeNull();
    expect(getSkillRenderer("generateBrandImage")).toBeNull();
    expect(getSkillRenderer("")).toBeNull();
  });
});
