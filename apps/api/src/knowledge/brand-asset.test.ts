import { describe, expect, it, vi } from "vitest";

import { ingestBrandAsset, ingestGeneratedAsset, type IngestStorage } from "./brand-asset";

const makeStorage = (): IngestStorage => ({
  assetKey: vi.fn((orgId: string, sha256: string, ext: string) => `org_${orgId}/${sha256}.${ext}`),
  uploadAsset: vi.fn().mockResolvedValue(undefined),
});

const makePrisma = (existing: { id: string; r2Key: string; sha256: string } | null) => ({
  brandAsset: {
    create: vi
      .fn()
      .mockImplementation(({ data }: { data: { sha256: string } }) =>
        Promise.resolve({
          id: "asset_new",
          r2Key: `org_org_1/${data.sha256}.jpg`,
          sha256: data.sha256,
        }),
      ),
    findUnique: vi.fn().mockResolvedValue(existing),
  },
});

describe("ingestBrandAsset", () => {
  it("computes SHA-256, uploads to R2, and creates a row on first upload", async () => {
    const storage = makeStorage();
    const prisma = makePrisma(null);
    const bytes = new Uint8Array([1, 2, 3]);

    const result = await ingestBrandAsset({
      bytes,
      mimeType: "image/jpeg",
      orgId: "org_1",
      prisma: prisma as never,
      storage,
    });

    expect(result.deduped).toBe(false);
    expect(result.assetId).toBe("asset_new");
    expect(storage.uploadAsset).toHaveBeenCalledOnce();
    expect(prisma.brandAsset.create).toHaveBeenCalledOnce();

    // Verify SHA-256 of [1,2,3] = 039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81
    const createArgs = prisma.brandAsset.create.mock.calls[0]![0] as { data: { sha256: string } };
    expect(createArgs.data.sha256).toBe(
      "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    );
  });

  it("skips upload + create on dedup hit (same sha256 already in org)", async () => {
    const storage = makeStorage();
    const prisma = makePrisma({
      id: "asset_existing",
      r2Key: "org_org_1/abc.jpg",
      sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    });
    const bytes = new Uint8Array([1, 2, 3]);

    const result = await ingestBrandAsset({
      bytes,
      mimeType: "image/jpeg",
      orgId: "org_1",
      prisma: prisma as never,
      storage,
    });

    expect(result.deduped).toBe(true);
    expect(result.assetId).toBe("asset_existing");
    expect(storage.uploadAsset).not.toHaveBeenCalled();
    expect(prisma.brandAsset.create).not.toHaveBeenCalled();
  });

  it("derives extension from mimeType for the R2 key", async () => {
    const storage = makeStorage();
    const prisma = makePrisma(null);

    await ingestBrandAsset({
      bytes: new Uint8Array([9]),
      mimeType: "image/png",
      orgId: "org_1",
      prisma: prisma as never,
      storage,
    });

    expect(storage.assetKey).toHaveBeenCalledWith("org_1", expect.any(String), "png");
  });
});

describe("ingestGeneratedAsset", () => {
  it("sets metadata.source='generated' + prompt + generatedAt ISO string", async () => {
    const storage = makeStorage();
    const prisma = makePrisma(null);
    const bytes = new Uint8Array([42, 43]);

    const result = await ingestGeneratedAsset({
      bytes,
      mimeType: "image/png",
      orgId: "org_1",
      prisma: prisma as never,
      prompt: "Logo moderno minimalista",
      storage,
    });

    expect(result.assetId).toBe("asset_new");
    expect(prisma.brandAsset.create).toHaveBeenCalledOnce();
    const createArgs = prisma.brandAsset.create.mock.calls[0]![0] as {
      data: { metadata: { generatedAt: string; prompt: string; source: string } };
    };
    expect(createArgs.data.metadata.source).toBe("generated");
    expect(createArgs.data.metadata.prompt).toBe("Logo moderno minimalista");
    expect(createArgs.data.metadata.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/v);
  });

  it("dedup hit: returns existing assetId without upload + create", async () => {
    const storage = makeStorage();
    const prisma = makePrisma({
      id: "asset_existing",
      r2Key: "org_org_1/abc.png",
      sha256: "fbc1a9f858ea9e177916964bd88c3d37b91a1e84412765e29950777f265c4b75", // sha256 of [42,43]
    });

    const result = await ingestGeneratedAsset({
      bytes: new Uint8Array([42, 43]),
      mimeType: "image/png",
      orgId: "org_1",
      prisma: prisma as never,
      prompt: "x",
      storage,
    });

    expect(result.assetId).toBe("asset_existing");
    expect(storage.uploadAsset).not.toHaveBeenCalled();
    expect(prisma.brandAsset.create).not.toHaveBeenCalled();
  });
});
