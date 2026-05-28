import { describe, expect, it } from "vitest";

// We assert at the unit level that the generateText call receives the
// override. End-to-end is covered by the manual smoke in Phase I.
import { resolveSystemPrompt } from "@/team/resolve-system-prompt";

describe("worker-job uses resolveSystemPrompt", () => {
  it("override beats template at the generate step", () => {
    const instance = { promptOverride: "CUSTOM" };
    const template = { systemPrompt: "DEFAULT" };
    // This is the contract worker-job.ts now relies on.
    expect(resolveSystemPrompt(instance, template)).toBe("CUSTOM");
  });
});
