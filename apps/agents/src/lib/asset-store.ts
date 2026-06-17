import { safeJson } from "@/db/mappers";
import { fetchAsset, uploadAsset } from "@/lib/r2";

// The company asset library — the shared store both customers (via /api/me/assets)
// and agents (via the list/read/save skills + worker-job capture) read and write.
// Text deliverables land as `knowledge_doc`; images are persisted elsewhere as
// `generated_image`. Dedup is by (company_id, sha256), same as image uploads.

type AssetKind = "audio" | "brand_asset" | "generated_image" | "knowledge_doc" | "user_upload";

type AssetSummary = {
  bytes: number;
  createdAt: number;
  id: string;
  kind: AssetKind;
  mime: string;
  name: string;
};

type AssetRow = {
  bytes: number;
  created_at: number;
  id: string;
  kind: string;
  metadata: string | null;
  mime: string;
};

const EXT_BY_MIME: Record<string, string> = {
  "application/json": "json",
  "text/csv": "csv",
  "text/markdown": "md",
  "text/plain": "txt",
};

const TEXT_MIME_PREFIXES = ["text/", "application/json"];

const isTextMime = (mime: string): boolean => TEXT_MIME_PREFIXES.some((p) => mime.startsWith(p));

const toAssetKind = (raw: string): AssetKind => {
  const valid: ReadonlyArray<AssetKind> = [
    "audio",
    "brand_asset",
    "generated_image",
    "knowledge_doc",
    "user_upload",
  ];
  return valid.find((k) => k === raw) ?? "knowledge_doc";
};

// Human label for an asset: prefer an explicit name, fall back to the original
// upload filename, then a kind-tagged stub so the library never shows a blank.
const assetName = (metadata: unknown, id: string, kind: string): string => {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  const candidate =
    (typeof meta.name === "string" && meta.name) ||
    (typeof meta.originalName === "string" && meta.originalName);
  return candidate || `${kind} ${id.slice(0, 6)}`;
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
};

// Persist a text deliverable (markdown by default) as a `knowledge_doc` asset.
// Idempotent on (company_id, sha256): identical content returns the existing id.
const persistTextAsset = async (
  env: Env,
  input: PersistTextInput,
): Promise<{ assetId: string }> => {
  const mime = input.mime ?? "text/markdown";
  const bytes = new TextEncoder().encode(input.text);
  const sha = await sha256Hex(bytes);
  const ext = EXT_BY_MIME[mime] ?? "txt";
  const r2Key = `org_${input.companyId}/${sha}.${ext}`;

  await uploadAsset(
    { ASSETS: env.ASSETS },
    { bytes, key: r2Key, metadata: { generatedBy: "agent" }, mime },
  );

  const candidateId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO asset
       (id, company_id, kind, r2_key, sha256, mime, bytes, metadata, created_at)
     VALUES (?, ?, 'knowledge_doc', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      candidateId,
      input.companyId,
      r2Key,
      sha,
      mime,
      bytes.length,
      JSON.stringify({ name: input.name, ...input.extraMeta }),
      Date.now(),
    )
    .run();
  const existing = await env.DB.prepare(
    "SELECT id FROM asset WHERE company_id = ? AND sha256 = ? LIMIT 1",
  )
    .bind(input.companyId, sha)
    .first<{ id: string }>();
  return { assetId: existing?.id ?? candidateId };
};

const listCompanyAssets = async (
  db: D1Database,
  companyId: string,
  options: { kind?: AssetKind; limit?: number } = {},
): Promise<Array<AssetSummary>> => {
  const limit = Math.min(options.limit ?? 100, 200);
  const cursor = options.kind
    ? db
        .prepare(
          `SELECT id, kind, mime, bytes, metadata, created_at FROM asset
            WHERE company_id = ? AND kind = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .bind(companyId, options.kind, limit)
    : db
        .prepare(
          `SELECT id, kind, mime, bytes, metadata, created_at FROM asset
            WHERE company_id = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .bind(companyId, limit);
  const { results } = await cursor.all<AssetRow>();
  return results.map((row) => ({
    bytes: row.bytes,
    createdAt: row.created_at,
    id: row.id,
    kind: toAssetKind(row.kind),
    mime: row.mime,
    name: assetName(safeJson<unknown>(row.metadata, null), row.id, row.kind),
  }));
};

// Read a text asset's content for agent context. Tenant-scoped: the asset must
// belong to `companyId`. Non-text assets return null (the agent should link the
// signed URL instead of trying to read binary into the prompt).
const readAssetText = async (
  env: Env,
  companyId: string,
  assetId: string,
): Promise<{ content: string; mime: string; name: string } | null> => {
  const row = await env.DB.prepare(
    "SELECT id, kind, mime, metadata, r2_key FROM asset WHERE id = ? AND company_id = ?",
  )
    .bind(assetId, companyId)
    .first<{ id: string; kind: string; metadata: string | null; mime: string; r2_key: string }>();
  if (!row || !isTextMime(row.mime)) {
    return null;
  }
  const object = await fetchAsset({ ASSETS: env.ASSETS }, row.r2_key);
  if (!object) {
    return null;
  }
  return {
    content: await object.text(),
    mime: row.mime,
    name: assetName(safeJson<unknown>(row.metadata, null), row.id, row.kind),
  };
};

export { assetName, isTextMime, listCompanyAssets, persistTextAsset, readAssetText };
export type { AssetKind, AssetSummary };
