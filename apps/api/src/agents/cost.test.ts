import { describe, expect, it, vi } from "vitest";

import { checkBudgetThresholds, computeRunCost } from "./cost";

describe("computeRunCost", () => {
  it("computes token-only cost rounded up to cents", () => {
    const out = computeRunCost({
      externalSkillCalls: [],
      inputTokens: 100_000,
      outputTokens: 50_000,
    });
    // 100_000 * 0.000055 + 50_000 * 0.000220 = 5.5 + 11 = 16.5 → ceil to 17
    expect(out.costCents).toBe(17);
  });

  it("adds per-image cost for generateBrandImage calls", () => {
    const out = computeRunCost({
      externalSkillCalls: ["generateBrandImage"],
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(out.costCents).toBe(22);
  });

  it("sums tokens + multiple external calls", () => {
    const out = computeRunCost({
      externalSkillCalls: ["generateBrandImage", "generateBrandImage"],
      inputTokens: 50_000,
      outputTokens: 0,
    });
    // tokens: 50_000 * 0.000055 = 2.75 → ceil to 3
    // 2 images × 22 = 44
    expect(out.costCents).toBe(3 + 44);
  });

  it("ignores unknown skill IDs in externalSkillCalls", () => {
    const out = computeRunCost({
      externalSkillCalls: ["extractSoul", "labelBrandAsset"],
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(out.costCents).toBe(0);
  });
});

describe("checkBudgetThresholds", () => {
  it("returns no warning when budget is 0 (disabled)", async () => {
    const prisma = { agentAction: { aggregate: vi.fn() } } as never;
    const out = await checkBudgetThresholds({
      agentInstanceId: "ai_1",
      budgetCents: 0,
      orgId: "org_1",
      prisma,
    });
    expect(out.emitted).toBeNull();
    expect(out.pct).toBe(0);
  });

  it("returns null when monthly cost is below 80%", async () => {
    const aggregate = vi.fn().mockResolvedValue({ _sum: { costCents: 100 } });
    const prisma = { agentAction: { aggregate } } as never;
    const out = await checkBudgetThresholds({
      agentInstanceId: "ai_1",
      budgetCents: 1000,
      orgId: "org_1",
      prisma,
    });
    expect(out.emitted).toBeNull();
    expect(out.pct).toBe(10);
  });

  it("emits WARN_80 when monthly cost crosses 80% (but under 100%)", async () => {
    const aggregate = vi.fn().mockResolvedValue({ _sum: { costCents: 850 } });
    const prisma = { agentAction: { aggregate } } as never;
    const out = await checkBudgetThresholds({
      agentInstanceId: "ai_1",
      budgetCents: 1000,
      orgId: "org_1",
      prisma,
    });
    expect(out.emitted).toBe("WARN_80");
  });

  it("emits WARN_100 when monthly cost meets or exceeds 100%", async () => {
    const aggregate = vi.fn().mockResolvedValue({ _sum: { costCents: 1200 } });
    const prisma = { agentAction: { aggregate } } as never;
    const out = await checkBudgetThresholds({
      agentInstanceId: "ai_1",
      budgetCents: 1000,
      orgId: "org_1",
      prisma,
    });
    expect(out.emitted).toBe("WARN_100");
  });
});
