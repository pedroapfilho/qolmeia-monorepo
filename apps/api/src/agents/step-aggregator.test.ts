import { describe, expect, it } from "vitest";

import { aggregateSteps } from "./step-aggregator";

const KNOWN_IDS = ["extractSoul", "generateBrandImage", "labelBrandAsset", "delegateToSpecialist"];

describe("aggregateSteps", () => {
  it("returns zero counts when steps are empty", () => {
    const out = aggregateSteps([], KNOWN_IDS);
    expect(out.generatedAssetIds).toEqual([]);
    expect(out.toolCallSummary).toEqual({
      delegateToSpecialist: 0,
      extractSoul: 0,
      generateBrandImage: 0,
      labelBrandAsset: 0,
    });
  });

  it("counts tool-calls per known skill, ignoring unknown tool names", () => {
    const out = aggregateSteps(
      [
        {
          content: [
            { toolName: "extractSoul", type: "tool-call" },
            { toolName: "extractSoul", type: "tool-call" },
            { toolName: "unknownTool", type: "tool-call" },
            { toolName: "labelBrandAsset", type: "tool-call" },
          ],
        },
      ],
      KNOWN_IDS,
    );
    expect(out.toolCallSummary.extractSoul).toBe(2);
    expect(out.toolCallSummary.labelBrandAsset).toBe(1);
    expect(out.toolCallSummary.generateBrandImage).toBe(0);
  });

  it("counts across multiple steps (regression — addresses Phase 5c coverage gap)", () => {
    const out = aggregateSteps(
      [
        { content: [{ toolName: "extractSoul", type: "tool-call" }] },
        {
          content: [
            { toolName: "labelBrandAsset", type: "tool-call" },
            { toolName: "labelBrandAsset", type: "tool-call" },
          ],
        },
      ],
      KNOWN_IDS,
    );
    expect(out.toolCallSummary).toEqual({
      delegateToSpecialist: 0,
      extractSoul: 1,
      generateBrandImage: 0,
      labelBrandAsset: 2,
    });
  });

  it("pushes direct generateBrandImage assetIds", () => {
    const out = aggregateSteps(
      [
        {
          content: [
            { toolName: "generateBrandImage", type: "tool-call" },
            {
              output: { assetId: "asset_direct", ok: true },
              toolName: "generateBrandImage",
              type: "tool-result",
            },
          ],
        },
      ],
      KNOWN_IDS,
    );
    expect(out.generatedAssetIds).toEqual(["asset_direct"]);
  });

  it("spreads delegated generatedAssetIds from delegateToSpecialist", () => {
    const out = aggregateSteps(
      [
        {
          content: [
            { toolName: "delegateToSpecialist", type: "tool-call" },
            {
              output: { generatedAssetIds: ["a1", "a2"], ok: true },
              toolName: "delegateToSpecialist",
              type: "tool-result",
            },
          ],
        },
      ],
      KNOWN_IDS,
    );
    expect(out.generatedAssetIds).toEqual(["a1", "a2"]);
  });

  it("skips tool-results with ok:false", () => {
    const out = aggregateSteps(
      [
        {
          content: [
            {
              output: { assetId: "would-be-pushed", ok: false },
              toolName: "generateBrandImage",
              type: "tool-result",
            },
          ],
        },
      ],
      KNOWN_IDS,
    );
    expect(out.generatedAssetIds).toEqual([]);
  });
});
