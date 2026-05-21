import { describe, expect, it, vi } from "vitest";

import { buildContextSnapshot } from "./context-snapshot";

describe("buildContextSnapshot", () => {
  it("calls getBusinessContext with orgId + prisma and returns the assembled blob", async () => {
    const getBusinessContext = vi.fn().mockResolvedValue("CTX-MD");
    const prisma = { organization: {} } as never;

    const snap = await buildContextSnapshot({
      existingAssets: [{ assetId: "ea_1", metadata: { x: 1 }, mimeType: "image/png" }],
      getBusinessContext,
      mission: "do the thing",
      newAssets: [{ assetId: "na_1", deduped: false, mimeType: "image/png" }],
      orgId: "org_1",
      oversizeCount: 2,
      prisma,
    });

    expect(getBusinessContext).toHaveBeenCalledOnce();
    expect(getBusinessContext).toHaveBeenCalledWith("org_1", prisma);
    expect(snap).toEqual({
      businessContext: "CTX-MD",
      existingAssets: [{ assetId: "ea_1", metadata: { x: 1 }, mimeType: "image/png" }],
      mission: "do the thing",
      newAssets: [{ assetId: "na_1", deduped: false, mimeType: "image/png" }],
      oversizeCount: 2,
    });
  });

  it("returns an empty businessContext when the org has no soul/instructions", async () => {
    const getBusinessContext = vi.fn().mockResolvedValue("");

    const snap = await buildContextSnapshot({
      existingAssets: [],
      getBusinessContext,
      mission: "",
      newAssets: [],
      orgId: "org_empty",
      oversizeCount: 0,
    });

    expect(snap.businessContext).toBe("");
    expect(snap.mission).toBe("");
    expect(snap.existingAssets).toEqual([]);
  });
});
