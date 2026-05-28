import { describe, expect, it } from "vitest";

import { resolveSystemPrompt } from "@/team/resolve-system-prompt";

describe("resolveSystemPrompt", () => {
  it("returns the template prompt when override is null", () => {
    const out = resolveSystemPrompt(
      { promptOverride: null },
      { systemPrompt: "DEFAULT" },
    );
    expect(out).toBe("DEFAULT");
  });

  it("returns the override when set", () => {
    const out = resolveSystemPrompt(
      { promptOverride: "CUSTOM" },
      { systemPrompt: "DEFAULT" },
    );
    expect(out).toBe("CUSTOM");
  });

  it("treats empty string as an explicit override (not a fallback trigger)", () => {
    // Documented behaviour: '' !== null. If a user saves an empty editor we
    // honour the intent. The UI is responsible for disallowing it if needed.
    const out = resolveSystemPrompt(
      { promptOverride: "" },
      { systemPrompt: "DEFAULT" },
    );
    expect(out).toBe("");
  });
});
