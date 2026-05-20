import { createHash } from "node:crypto";

import type { PrismaClient } from "@repo/db";

import { assetKey as defaultAssetKey, uploadAsset as defaultUpload } from "../lib/storage";

type IngestPrisma = Pick<PrismaClient, "brandAsset">;

type IngestStorage = {
  assetKey: typeof defaultAssetKey;
  uploadAsset: typeof defaultUpload;
};

const mimeToExt = (mimeType: string): string => {
  if (mimeType === "image/gif") {
    return "gif";
  }
  if (mimeType === "image/heic") {
    return "heic";
  }
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return "jpg";
  }
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "bin";
};

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const ingestBrandAsset = async (args: {
  bytes: Uint8Array;
  mimeType: string;
  orgId: string;
  prisma: IngestPrisma;
  storage?: IngestStorage;
}): Promise<{ assetId: string; deduped: boolean }> => {
  const storage: IngestStorage = args.storage ?? {
    assetKey: defaultAssetKey,
    uploadAsset: defaultUpload,
  };
  const sha256 = sha256Hex(args.bytes);

  const existing = await args.prisma.brandAsset.findUnique({
    where: { orgId_sha256: { orgId: args.orgId, sha256 } },
  });
  if (existing) {
    return { assetId: existing.id, deduped: true };
  }

  const ext = mimeToExt(args.mimeType);
  const key = storage.assetKey(args.orgId, sha256, ext);

  await storage.uploadAsset({ bytes: args.bytes, key, mimeType: args.mimeType });

  const row = await args.prisma.brandAsset.create({
    data: {
      metadata: {},
      mimeType: args.mimeType,
      orgId: args.orgId,
      r2Key: key,
      sha256,
      size: args.bytes.byteLength,
    },
  });

  return { assetId: row.id, deduped: false };
};

const ingestGeneratedAsset = async (args: {
  bytes: Uint8Array;
  mimeType: string;
  orgId: string;
  prisma: IngestPrisma;
  prompt: string;
  storage?: IngestStorage;
}): Promise<{ assetId: string }> => {
  const storage: IngestStorage = args.storage ?? {
    assetKey: defaultAssetKey,
    uploadAsset: defaultUpload,
  };
  const sha256 = sha256Hex(args.bytes);

  const existing = await args.prisma.brandAsset.findUnique({
    where: { orgId_sha256: { orgId: args.orgId, sha256 } },
  });
  if (existing) {
    return { assetId: existing.id };
  }

  const ext = mimeToExt(args.mimeType);
  const key = storage.assetKey(args.orgId, sha256, ext);

  await storage.uploadAsset({ bytes: args.bytes, key, mimeType: args.mimeType });

  const row = await args.prisma.brandAsset.create({
    data: {
      metadata: {
        generatedAt: new Date().toISOString(),
        prompt: args.prompt,
        source: "generated",
      },
      mimeType: args.mimeType,
      orgId: args.orgId,
      r2Key: key,
      sha256,
      size: args.bytes.byteLength,
    },
  });

  return { assetId: row.id };
};

export { ingestBrandAsset, ingestGeneratedAsset };
export type { IngestPrisma, IngestStorage };
