import { describe, expect, it, vi } from "vitest";

import { draftMarketingStrategySkill } from "./draft-marketing-strategy";

describe("draftMarketingStrategySkill", () => {
  it("has the expected metadata", () => {
    expect(draftMarketingStrategySkill.id).toBe("draftMarketingStrategy");
    expect(draftMarketingStrategySkill.displayName).toBe("Draft Marketing Strategy");
    // Gated for CUSTOMER-side runs (Task 3.5 — §8 approval rule).
    expect(draftMarketingStrategySkill.requiresApprovalDefault).toBe(true);
  });

  it("validates input via Zod (goal required, others optional)", () => {
    const parsed = draftMarketingStrategySkill.inputSchema.parse({ goal: "Aumentar vendas" });
    expect(parsed.goal).toBe("Aumentar vendas");
    expect(parsed.audience).toBeUndefined();
    expect(() => draftMarketingStrategySkill.inputSchema.parse({ goal: "" })).toThrow();
  });

  it("execute() returns a strategy with all required fields", async () => {
    const result = await draftMarketingStrategySkill.execute(
      { audience: "donas de salão", goal: "Promover Black Friday", occasion: "Black Friday" },
      {
        agentInstanceId: "ai_1",
        dispatcher: { enqueueAndAwait: vi.fn() } as never,
        orgId: "org_1",
        parentRunArgs: {} as never,
        parentRunId: "run_test",
        prisma: {} as never,
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.headline.length).toBeGreaterThan(0);
      expect(result.copyDirection.length).toBeGreaterThan(0);
      expect(result.visualConcept.length).toBeGreaterThan(0);
      expect(result.channelMix.length).toBeGreaterThan(0);
      expect(result.headline).toContain("Black Friday");
      expect(result.copyDirection).toContain("donas de salão");
    }
  });
});
