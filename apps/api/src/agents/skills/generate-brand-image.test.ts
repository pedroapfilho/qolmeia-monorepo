import { describe, expect, it, vi } from "vitest";

import { generateBrandImageSkill } from "./generate-brand-image";

vi.mock("../../knowledge/brand-context", () => ({
  enrichPromptWithBrand: vi.fn((prompt: string, aspect: string) => `ENRICHED[${aspect}]:${prompt}`),
  getBrandContext: vi.fn(),
}));
vi.mock("../../lib/image-gen", () => ({
  generateBrandImageBytes: vi.fn(),
}));
vi.mock("../../knowledge/brand-asset", () => ({
  ingestGeneratedAsset: vi.fn(),
}));

describe("generateBrandImageSkill", () => {
  it("has the expected metadata", () => {
    expect(generateBrandImageSkill.id).toBe("generateBrandImage");
    expect(generateBrandImageSkill.displayName).toBe("Generate Brand Image");
    expect(generateBrandImageSkill.requiresApprovalDefault).toBe(false);
    expect(generateBrandImageSkill.requiredConnectorTypes).toEqual([]);
  });

  it("validates input via Zod (aspectRatio enum + prompt length)", () => {
    const parsed = generateBrandImageSkill.inputSchema.parse({
      aspectRatio: "16:9",
      prompt: "Banner de Black Friday",
    });
    expect(parsed.aspectRatio).toBe("16:9");

    const defaulted = generateBrandImageSkill.inputSchema.parse({ prompt: "x" });
    expect(defaulted.aspectRatio).toBe("1:1");

    expect(() => generateBrandImageSkill.inputSchema.parse({ prompt: "x".repeat(2001) })).toThrow();
  });

  it("execute() flows: getBrandContext → enrichPromptWithBrand → generateBrandImageBytes → ingestGeneratedAsset", async () => {
    const { enrichPromptWithBrand, getBrandContext } =
      await import("../../knowledge/brand-context");
    const { generateBrandImageBytes } = await import("../../lib/image-gen");
    const { ingestGeneratedAsset } = await import("../../knowledge/brand-asset");

    vi.mocked(getBrandContext).mockResolvedValueOnce({
      palette: ["#FF0000"],
      styles: ["moderno"],
      typography: "sans",
    });
    vi.mocked(generateBrandImageBytes).mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    vi.mocked(ingestGeneratedAsset).mockResolvedValueOnce({ assetId: "gen_1" });

    const fakePrisma = { id: "fake-prisma" } as never;
    const result = await generateBrandImageSkill.execute(
      { aspectRatio: "1:1", prompt: "Banner de promo" },
      {
        agentInstanceId: "ai_1",
        dispatcher: { enqueueAndAwait: vi.fn() } as never,
        orgId: "org_1",
        parentRunArgs: {} as never,
        parentRunId: "run_test",
        prisma: fakePrisma,
      },
    );

    expect(getBrandContext).toHaveBeenCalledWith("org_1", fakePrisma);
    expect(enrichPromptWithBrand).toHaveBeenCalledWith("Banner de promo", "1:1", {
      palette: ["#FF0000"],
      styles: ["moderno"],
      typography: "sans",
    });
    expect(generateBrandImageBytes).toHaveBeenCalledWith({
      aspectRatio: "1:1",
      prompt: "ENRICHED[1:1]:Banner de promo",
    });
    expect(ingestGeneratedAsset).toHaveBeenCalledOnce();
    expect(result).toEqual({ assetId: "gen_1", ok: true });
  });

  it("execute() returns { ok: false, error } when image generation fails", async () => {
    const { getBrandContext } = await import("../../knowledge/brand-context");
    const { generateBrandImageBytes } = await import("../../lib/image-gen");

    vi.mocked(getBrandContext).mockResolvedValueOnce({ palette: [], styles: [] });
    vi.mocked(generateBrandImageBytes).mockRejectedValueOnce(new Error("gateway 500"));

    const result = await generateBrandImageSkill.execute(
      { aspectRatio: "1:1", prompt: "x" },
      {
        agentInstanceId: "ai_1",
        dispatcher: { enqueueAndAwait: vi.fn() } as never,
        orgId: "org_1",
        parentRunArgs: {} as never,
        parentRunId: "run_test",
        prisma: {} as never,
      },
    );

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("gateway 500");
  });
});
