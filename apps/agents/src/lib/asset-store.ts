import type { Database } from "#/db/client";
import { getDb } from "#/db/client";
import { toEnum } from "#/db/mappers";
import { fetchAsset, uploadAsset } from "#/lib/r2";
import { toRecord } from "#/lib/records";

type AssetKind = "audio" | "brand_asset" | "generated_image" | "knowledge_doc" | "user_upload";

type AssetVisibility = "agent" | "customer";

type AssetSummary = {
  bytes: number;
  createdAt: number;
  id: string;
  kind: AssetKind;
  mime: string;
  name: string;
  visibility: AssetVisibility;
};

const toVisibility = toEnum<AssetVisibility>(["agent", "customer"], "customer");

const EXT_BY_MIME: Record<string, string> = {
  "application/json": "json",
  "image/svg+xml": "svg",
  "text/csv": "csv",
  "text/markdown": "md",
  "text/plain": "txt",
};

const TEXT_MIME_PREFIXES = ["text/", "application/json"];

const toAssetKind = toEnum<AssetKind>(
  ["audio", "brand_asset", "generated_image", "knowledge_doc", "user_upload"],
  "knowledge_doc",
);

const assetName = (metadata: unknown, id: string, kind: string): string => {
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

type PersistTextInput = {
  companyId: string;
  extraMeta?: Record<string, unknown>;
  mime?: string;
  name: string;
  text: string;
  visibility?: AssetVisibility;
};

const persistTextAsset = async (
  env: Env,
  input: PersistTextInput,
): Promise<{ assetId: string }> => {
  const mime = input.mime ?? "text/markdown";
  const visibility = input.visibility ?? "customer";
  const bytes = new TextEncoder().encode(input.text);
  const sha = await sha256Hex(bytes);
  const ext = EXT_BY_MIME[mime] ?? "txt";
  const r2Key = `org_${input.companyId}/${visibility}/${sha}.${ext}`;

  await uploadAsset(
    { ASSETS: env.ASSETS },
    { bytes, key: r2Key, metadata: { generatedBy: "agent" }, mime },
  );

  const db = getDb(env);
  const asset = await db.asset.upsert({
    create: {
      bytes: bytes.length,
      companyId: input.companyId,
      id: crypto.randomUUID(),
      kind: "knowledge_doc",
      metadata: { name: input.name, ...input.extraMeta },
      mime,
      r2Key,
      sha256: sha,
      visibility,
    },
    update: {},
    where: { companyId_sha256: { companyId: input.companyId, sha256: sha } },
  });
  return { assetId: asset.id };
};

const listCompanyAssets = async (
  db: Database,
  companyId: string,
  options: { kind?: AssetKind; limit?: number; visibility?: AssetVisibility } = {},
): Promise<Array<AssetSummary>> => {
  const rows = await db.asset.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(options.limit ?? 100, 200),
    where: { companyId, kind: options.kind, visibility: options.visibility },
  });
  return rows.map((row) => ({
    bytes: row.bytes,
    createdAt: row.createdAt.getTime(),
    id: row.id,
    kind: toAssetKind(row.kind),
    mime: row.mime,
    name: assetName(row.metadata, row.id, row.kind),
    visibility: toVisibility(row.visibility),
  }));
};

const readAssetText = async (
  env: Env,
  companyId: string,
  assetId: string,
): Promise<{ content: string; mime: string; name: string } | null> => {
  const row = await getDb(env).asset.findFirst({ where: { companyId, id: assetId } });
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

export { assetName, listCompanyAssets, persistTextAsset, readAssetText };
export type { AssetKind, AssetSummary, AssetVisibility };
