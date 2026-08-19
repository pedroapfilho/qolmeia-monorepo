import type { AssetKind, AssetSummary, AssetVisibility } from "@repo/worker-api/contracts";

import type { Database } from "#/db/client";
import { getDb } from "#/db/client";
import { fetchAsset, uploadAsset } from "#/lib/r2";
import { toRecord } from "#/lib/records";

type ExtByMimeContract = Record<string, string>;

const EXT_BY_MIME = {
  "application/json": "json",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "text/csv": "csv",
  "text/markdown": "md",
  "text/plain": "txt",
} satisfies ExtByMimeContract;

const extensionByMime = new Map<string, string>(Object.entries(EXT_BY_MIME));

const TEXT_MIME_PREFIXES = ["text/", "application/json"];

const assetName = (metadata: Prisma.JsonValue, id: string, kind: string): string => {
  const meta = toRecord(metadata);
  const name = typeof meta.name === "string" && meta.name !== "" ? meta.name : undefined;
  const originalName =
    typeof meta.originalName === "string" && meta.originalName !== ""
      ? meta.originalName
      : undefined;
  return name ?? originalName ?? `${kind} ${id.slice(0, 6)}`;
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

type PersistAssetInput = {
  bytes: Uint8Array;
  companyId: string;
  fallbackExt?: string;
  kind: AssetKind;
  metadata: Record<string, unknown>;
  mime: string;
  uploadMetadata: Record<string, string>;
  visibility: AssetVisibility;
};

const persistAsset = async (env: Env, input: PersistAssetInput): Promise<{ assetId: string }> => {
  const { bytes, companyId, kind, metadata, mime, visibility } = input;
  const sha = await sha256Hex(bytes);
  const ext = extensionByMime.get(mime) ?? input.fallbackExt ?? "bin";
  const folder = kind === "brand_asset" ? `${visibility}/brand` : visibility;
  const r2Key = `org_${companyId}/${folder}/${sha}.${ext}`;

  await uploadAsset(
    { ASSETS: env.ASSETS },
    { bytes, key: r2Key, metadata: input.uploadMetadata, mime },
  );

  const asset = await getDb(env)("assets.persist", {
    bytes: bytes.length,
    companyId,
    id: crypto.randomUUID(),
    kind,
    metadata,
    mime,
    r2Key,
    sha256: sha,
    visibility,
  });
  return asset;
};

const listCompanyAssets = async (
  db: Database,
  companyId: string,
  options: { kind?: AssetKind; limit?: number; visibility?: AssetVisibility } = {},
): Promise<Array<AssetSummary>> => {
  const rows = await db("assets.list", { companyId, ...options });
  return [...rows];
};

const readAssetText = async (
  env: Env,
  companyId: string,
  assetId: string,
): Promise<{ content: string; mime: string; name: string } | null> => {
  const row = await getDb(env)("assets.textMetadata", { assetId, companyId });
  if (!row || !TEXT_MIME_PREFIXES.some((prefix) => row.mime.startsWith(prefix))) {
    return null;
  }
  const object = await fetchAsset({ ASSETS: env.ASSETS }, row.r2Key);
  if (!object) {
    return null;
  }
  return {
    content: await object.text(),
    mime: row.mime,
    name: assetName(row.metadata, row.id, row.kind),
  };
};

export { assetName, listCompanyAssets, persistAsset, readAssetText };
export type { AssetSummary } from "@repo/worker-api/contracts";
export type { AssetKind, AssetVisibility } from "@repo/worker-api/contracts";
