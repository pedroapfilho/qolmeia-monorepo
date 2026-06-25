import { describe, expect, it } from "vitest";

import { resolveSystemPrompt } from "#/team/resolve-system-prompt";

describe("resolveSystemPrompt", () => {
  it("returns the template prompt when override is null", () => {
    const out = resolveSystemPrompt({ promptOverride: null }, { systemPrompt: "DEFAULT" });
    expect(out).toBe("DEFAULT");
  });

  it("returns the override when set", () => {
    const out = resolveSystemPrompt({ promptOverride: "CUSTOM" }, { systemPrompt: "DEFAULT" });
    expect(out).toBe("CUSTOM");
  });

  it("treats empty string as an explicit override (not a fallback trigger)", () => {
    // Unit test of the pure resolver: empty string is a legal resolver input.
    // In practice the mutation layer (updateMember) normalises empty/whitespace
    // overrides to NULL before they reach this code; this case only fires if a
    // future caller stores '' directly via raw SQL.
    const out = resolveSystemPrompt({ promptOverride: "" }, { systemPrompt: "DEFAULT" });
    expect(out).toBe("");
  });
});
