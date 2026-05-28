import { describe, expect, it } from "vitest";

import { nextDisplayName } from "@/team/naming";

describe("nextDisplayName", () => {
  it("returns the base name when none exists yet", () => {
    expect(nextDisplayName("Designer", [])).toBe("Designer");
  });

  it("returns the base name when no exact match exists (renamed instances)", () => {
    expect(nextDisplayName("Designer", ["Marina", "Carla"])).toBe("Designer");
  });

  it("appends #2 when base exists once", () => {
    expect(nextDisplayName("Designer", ["Designer"])).toBe("Designer #2");
  });

  it("finds the lowest free integer", () => {
    expect(nextDisplayName("Designer", ["Designer", "Designer #2", "Designer #4"])).toBe(
      "Designer #3",
    );
  });

  it("ignores case differences in existing names", () => {
    expect(nextDisplayName("Designer", ["designer"])).toBe("Designer #2");
  });
});
