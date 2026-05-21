import { describe, expect, it } from "vitest";

import { resolveModelForAgent } from "./ai";

describe("resolveModelForAgent", () => {
  it("returns the template defaultModel when modelOverride is null", () => {
    const model = resolveModelForAgent({
      instance: { modelOverride: null },
      template: { defaultModel: "openai/gpt-5.4-mini" },
    });
    expect(model).toBe("openai/gpt-5.4-mini");
  });

  it("returns the instance modelOverride when set (override wins over template default)", () => {
    const model = resolveModelForAgent({
      instance: { modelOverride: "anthropic/claude-3.5-sonnet" },
      template: { defaultModel: "openai/gpt-5.4-mini" },
    });
    expect(model).toBe("anthropic/claude-3.5-sonnet");
  });

  it("treats empty-string override as a truthy value (operator opt-in via DB)", () => {
    // Empty string is not null ⇒ it wins. Documented so callers know the
    // contract: only `null` falls back; empty strings are operator footguns.
    const model = resolveModelForAgent({
      instance: { modelOverride: "" },
      template: { defaultModel: "openai/gpt-5.4-mini" },
    });
    expect(model).toBe("");
  });
});
