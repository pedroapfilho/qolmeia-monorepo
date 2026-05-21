import { describe, expect, it, vi } from "vitest";

import { labelBrandAssetSkill } from "./label-brand-asset";

describe("labelBrandAssetSkill", () => {
  it("has the expected metadata for the registry", () => {
    expect(labelBrandAssetSkill.id).toBe("labelBrandAsset");
    expect(labelBrandAssetSkill.displayName).toBe("Label Brand Asset");
    expect(labelBrandAssetSkill.requiresApprovalDefault).toBe(false);
    expect(labelBrandAssetSkill.requiredConnectorTypes).toEqual([]);
  });

  it("validates hex palette + style + typography via Zod", () => {
    const ok = labelBrandAssetSkill.inputSchema.parse({
      assetId: "asset_1",
      palette: ["#FFEEDD", "#112233"],
      styleDescriptors: ["minimalista", "moderno"],
      typography: "sans",
    });
    expect(ok.palette).toHaveLength(2);

    expect(() =>
      labelBrandAssetSkill.inputSchema.parse({
        assetId: "asset_1",
        palette: ["not-a-hex"],
        styleDescriptors: ["x"],
        typography: "sans",
      }),
    ).toThrow();
  });

  it("execute() updates brandAsset.metadata with palette/style/typography", async () => {
    const update = vi.fn().mockResolvedValue({});
    const fakePrisma = { brandAsset: { update } } as never;

    const result = await labelBrandAssetSkill.execute(
      {
        assetId: "asset_1",
        palette: ["#112233", "#445566"],
        styleDescriptors: ["minimalista"],
        typography: "sans",
      },
      {
        agentInstanceId: "ai_1",
        dispatcher: { enqueueAndAwait: vi.fn() } as never,
        orgId: "org_1",
        parentRunArgs: {} as never,
        parentRunId: "run_test",
        prisma: fakePrisma,
      },
    );

    expect(update).toHaveBeenCalledWith({
      data: {
        metadata: {
          palette: ["#112233", "#445566"],
          styleDescriptors: ["minimalista"],
          typography: "sans",
        },
      },
      where: { id: "asset_1" },
    });
    expect(result).toEqual({ ok: true });
  });
});
