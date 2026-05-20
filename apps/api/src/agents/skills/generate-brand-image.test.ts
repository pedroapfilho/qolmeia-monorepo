import { describe, expect, it, vi } from "vitest";

import { generateBrandImageSkill } from "./generate-brand-image";

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

    // default aspectRatio
    const defaulted = generateBrandImageSkill.inputSchema.parse({ prompt: "x" });
    expect(defaulted.aspectRatio).toBe("1:1");

    // prompt too long
    expect(() => generateBrandImageSkill.inputSchema.parse({ prompt: "x".repeat(2001) })).toThrow();
  });

  it("execute() composes brand context, calls image-gen, ingests result", async () => {
    const { generateBrandImageBytes } = await import("../../lib/image-gen");
    const { ingestGeneratedAsset } = await import("../../knowledge/brand-asset");

    vi.mocked(generateBrandImageBytes).mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    vi.mocked(ingestGeneratedAsset).mockResolvedValueOnce({ assetId: "gen_1" });

    const findMany = vi.fn().mockResolvedValue([
      {
        metadata: {
          palette: ["#FF0000"],
          styleDescriptors: ["moderno"],
          typography: "sans",
        },
      },
      { metadata: { source: "generated" } }, // should be skipped
    ]);
    const fakePrisma = { brandAsset: { findMany } } as never;

    const result = await generateBrandImageSkill.execute(
      { aspectRatio: "1:1", prompt: "Banner de promo" },
      {
        agentInstanceId: "ai_1",
        dispatcher: { enqueueAndAwait: vi.fn() } as never,
        orgId: "org_1",
        parentRunArgs: {} as never,
        prisma: fakePrisma,
      },
    );

    expect(findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
      take: 3,
      where: { orgId: "org_1" },
    });
    expect(generateBrandImageBytes).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(generateBrandImageBytes).mock.calls[0]![0];
    expect(callArgs.aspectRatio).toBe("1:1");
    expect(callArgs.prompt).toContain("Banner de promo");
    expect(callArgs.prompt).toContain("Aspect ratio: 1:1.");
    expect(callArgs.prompt).toContain("#FF0000");
    expect(callArgs.prompt).toContain("moderno");
    expect(callArgs.prompt).toContain("sans");
    expect(ingestGeneratedAsset).toHaveBeenCalledOnce();
    expect(result).toEqual({ assetId: "gen_1", ok: true });
  });

  it("execute() returns { ok: false, error } when image generation fails", async () => {
    const { generateBrandImageBytes } = await import("../../lib/image-gen");

    vi.mocked(generateBrandImageBytes).mockRejectedValueOnce(new Error("gateway 500"));

    const findMany = vi.fn().mockResolvedValue([]);
    const fakePrisma = { brandAsset: { findMany } } as never;

    const result = await generateBrandImageSkill.execute(
      { aspectRatio: "1:1", prompt: "x" },
      {
        agentInstanceId: "ai_1",
        dispatcher: { enqueueAndAwait: vi.fn() } as never,
        orgId: "org_1",
        parentRunArgs: {} as never,
        prisma: fakePrisma,
      },
    );

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("gateway 500");
  });
});
