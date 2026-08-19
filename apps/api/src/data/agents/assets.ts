import type { AssetKind, AssetSummary, AssetVisibility } from "@repo/worker-api/contracts";
import type { AssetRecord } from "@repo/worker-api/internal";

import { jsonRecordSchema, nullableJsonRecord, type Database, type JsonRecord } from "./types";

const toRecord = (value: unknown): JsonRecord | null => nullableJsonRecord(value);

const assetName = (metadata: unknown, id: string, kind: string): string => {
  const record = toRecord(metadata);
  const name = typeof record?.name === "string" && record.name !== "" ? record.name : undefined;
  const originalName =
    typeof record?.originalName === "string" && record.originalName !== ""
      ? record.originalName
      : undefined;
  return name ?? originalName ?? `${kind} ${id.slice(0, 6)}`;
};

const mapAsset = (row: {
  bytes: number;
  createdAt: Date;
  id: string;
  kind: AssetKind;
  metadata: unknown;
  mime: string;
  r2Key: string;
  visibility: AssetVisibility;
}): AssetRecord => ({
  bytes: row.bytes,
  createdAt: row.createdAt.getTime(),
  id: row.id,
  kind: row.kind,
  metadata: toRecord(row.metadata),
  mime: row.mime,
  name: assetName(row.metadata, row.id, row.kind),
  r2Key: row.r2Key,
  visibility: row.visibility,
});

const persistAsset = async (
  db: Database,
  input: {
    bytes: number;
    companyId: string;
    id: string;
    kind: AssetKind;
    metadata: JsonRecord;
    mime: string;
    r2Key: string;
    sha256: string;
    visibility: AssetVisibility;
  },
): Promise<{ assetId: string }> => {
  const asset = await db.asset.upsert({
    create: { ...input, metadata: jsonRecordSchema.parse(input.metadata) },
    update: {},
    where: { companyId_sha256: { companyId: input.companyId, sha256: input.sha256 } },
  });
  return { assetId: asset.id };
};

const listAssets = async (
  db: Database,
  input: {
    companyId: string;
    kind?: AssetKind;
    limit?: number;
    visibility?: AssetVisibility;
  },
): Promise<ReadonlyArray<AssetSummary>> => {
  const rows = await db.asset.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(input.limit ?? 100, 200),
    where: { companyId: input.companyId, kind: input.kind, visibility: input.visibility },
  });
  return rows.map((row) => {
    const asset = mapAsset(row);
    return {
      bytes: asset.bytes,
      createdAt: asset.createdAt,
      id: asset.id,
      kind: asset.kind,
      mime: asset.mime,
      name: asset.name,
      visibility: asset.visibility,
    };
  });
};

const listCustomerAssets = async (
  db: Database,
  companyId: string,
  limit: number,
): Promise<ReadonlyArray<AssetRecord>> => {
  const rows = await db.asset.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    where: { companyId, visibility: "customer" },
  });
  return rows.map(mapAsset);
};

const listBrandAssets = async (
  db: Database,
  companyId: string,
): Promise<ReadonlyArray<AssetRecord>> => {
  const rows = await db.asset.findMany({
    orderBy: { createdAt: "desc" },
    where: { companyId, kind: "brand_asset" },
  });
  return rows.map(mapAsset);
};

const listAssetReferences = (db: Database, companyId: string, limit: number) =>
  db.asset.findMany({
    orderBy: { createdAt: "desc" },
    select: { mime: true, r2Key: true },
    take: limit,
    where: { companyId, kind: "brand_asset", mime: { not: "image/svg+xml" } },
  });

const getAssetAccess = (db: Database, assetId: string) =>
  db.asset.findUnique({ select: { mime: true, r2Key: true }, where: { id: assetId } });

const getTextAssetMetadata = async (db: Database, companyId: string, assetId: string) => {
  const row = await db.asset.findFirst({ where: { companyId, id: assetId } });
  return row
    ? {
        id: row.id,
        kind: row.kind,
        metadata: toRecord(row.metadata),
        mime: row.mime,
        r2Key: row.r2Key,
      }
    : null;
};

const deleteBrandAsset = async (db: Database, companyId: string, assetId: string) => {
  const row = await db.asset.findFirst({
    select: { r2Key: true },
    where: { companyId, id: assetId, kind: "brand_asset" },
  });
  if (!row) {
    return null;
  }
  await db.asset.deleteMany({ where: { companyId, id: assetId } });
  return row;
};

const deleteCustomerAssets = async (
  db: Database,
  companyId: string,
  ids: ReadonlyArray<string>,
) => {
  const rows = await db.asset.findMany({
    select: { id: true, r2Key: true },
    where: { companyId, id: { in: [...ids] }, visibility: "customer" },
  });
  if (rows.length > 0) {
    await db.asset.deleteMany({
      where: { companyId, id: { in: rows.map((row) => row.id) } },
    });
  }
  return rows;
};

export {
  deleteBrandAsset,
  deleteCustomerAssets,
  getAssetAccess,
  getTextAssetMetadata,
  listAssetReferences,
  listAssets,
  listBrandAssets,
  listCustomerAssets,
  persistAsset,
};
