// /api/me/assets + /api/me/uploads — the customer-facing asset surface.
//
// Split out of routes/me.ts because the upload path is materially different
// from the rest of /api/me: it parses multipart, validates MIME + size,
// hashes bytes, dedups against the `asset` table, mutates R2 + D1, and
// mints a long-lived signed URL. Co-locating with the gallery list keeps
// "what the customer can put in / pull out" in one file, and leaves
// routes/me.ts scoped to introspection (session relay, company, templates,
// activity).

import { Hono } from "hono";

import { safeJson } from "@/db/mappers";
import type { ValidatedSession } from "@/lib/auth";
import { validateSession } from "@/lib/auth";
import { buildSignedAssetUrl, uploadAsset } from "@/lib/r2";

type Vars = { session: ValidatedSession };

const meAssetsRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

meAssetsRoutes.use("*", async (c, next) => {
  const session = await validateSession(c.req.raw, c.env);
  if (!session) {
    return c.text("Unauthorized", 401);
  }
  c.set("session", session);
  return next();
});

type AssetRow = {
  bytes: number;
  created_at: number;
  id: string;
  metadata: string | null;
  mime: string;
};

const parsePositiveInt = (raw: string | undefined, fallback: number, max: number): number => {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
};

// GET /api/me/assets — asset gallery. URLs re-sign per request (default
// 15-min TTL) since this list re-renders on every RSC pass.
meAssetsRoutes.get("/assets", async (c) => {
  const { companyId } = c.get("session");
  const limit = parsePositiveInt(c.req.query("limit"), 100, 200);
  const { results } = await c.env.DB.prepare(
    `SELECT id, mime, bytes, metadata, created_at
       FROM asset
       WHERE company_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
  )
    .bind(companyId, limit)
    .all<AssetRow>();

  const items = await Promise.all(
    results.map(async (row) => ({
      createdAt: new Date(row.created_at).toISOString(),
      id: row.id,
      metadata: safeJson<unknown>(row.metadata, null),
      mimeType: row.mime,
      size: row.bytes,
      url: await buildSignedAssetUrl(
        { ASSETS_SIGNING_KEY: c.env.ASSETS_SIGNING_KEY },
        c.env.WORKER_PUBLIC_URL,
        row.id,
      ),
    })),
  );

  return c.json({ items, nextCursor: null });
});

// User-uploaded chat attachments. Lives behind the same R2/asset pipeline as
// generated images (kind='user_upload') so they show up in the Assets tab
// alongside the Designer's output.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_MIME = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const EXT_BY_MIME: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const sha256OfBytes = async (bytes: Uint8Array): Promise<string> => {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

// Shared R2 + D1 ingest for an image upload. Dedups on (company_id, sha256):
// re-uploading identical bytes returns the existing asset id. The caller picks
// the `kind` and any extra metadata (e.g. a brand-asset category).
const persistImageAsset = async (
  env: Env,
  opts: {
    companyId: string;
    extraMeta: Record<string, unknown>;
    file: File;
    kind: "brand_asset" | "user_upload";
  },
): Promise<{ assetId: string; bytes: number; mime: string }> => {
  const { companyId, extraMeta, file, kind } = opts;
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const sha = await sha256OfBytes(bytes);
  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const r2Key = `org_${companyId}/${sha}.${ext}`;

  await uploadAsset(
    { ASSETS: env.ASSETS },
    { bytes, key: r2Key, metadata: { uploader: "customer" }, mime: file.type },
  );

  const candidateId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO asset
       (id, company_id, kind, r2_key, sha256, mime, bytes, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      candidateId,
      companyId,
      kind,
      r2Key,
      sha,
      file.type,
      bytes.length,
      JSON.stringify({ originalName: file.name || null, ...extraMeta }),
      Date.now(),
    )
    .run();
  const existing = await env.DB.prepare(
    "SELECT id FROM asset WHERE company_id = ? AND sha256 = ? LIMIT 1",
  )
    .bind(companyId, sha)
    .first<{ id: string }>();
  return { assetId: existing?.id ?? candidateId, bytes: bytes.length, mime: file.type };
};

// Shared by both upload routes: returns the File, or a ready-to-send error tuple.
const readUploadedImage = (
  form: FormData,
): { error: string; status: 400 | 413 | 415 } | { file: File } => {
  const file = form.get("file");
  if (!(file instanceof File)) {
    return { error: "Missing 'file' field", status: 400 };
  }
  if (!ALLOWED_UPLOAD_MIME.has(file.type)) {
    return { error: `Unsupported mime '${file.type}'`, status: 415 };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: `File too large (max ${MAX_UPLOAD_BYTES} bytes)`, status: 413 };
  }
  return { file };
};

const BRAND_CATEGORIES = new Set(["logo", "post", "reference", "other"]);

// POST /api/me/uploads — accepts a multipart form with a `file` field.
// Returns the signed asset URL plus its asset id so the client can drop
// the URL into a FileUIPart on the next chat turn.
meAssetsRoutes.post("/uploads", async (c) => {
  const { companyId } = c.get("session");

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "Invalid multipart body" }, 400);
  }

  const validated = readUploadedImage(form);
  if ("error" in validated) {
    return c.json({ error: validated.error }, validated.status);
  }

  const { assetId, bytes, mime } = await persistImageAsset(c.env, {
    companyId,
    extraMeta: {},
    file: validated.file,
    kind: "user_upload",
  });

  // 7-day TTL because this URL is baked into a chat-history FileUIPart and
  // the bubble has to keep rendering long after the upload. The gallery
  // list above re-signs per RSC render with the shorter default TTL.
  const url = await buildSignedAssetUrl(
    { ASSETS_SIGNING_KEY: c.env.ASSETS_SIGNING_KEY },
    c.env.WORKER_PUBLIC_URL,
    assetId,
    SEVEN_DAYS_MS,
  );

  return c.json({ assetId, mime, size: bytes, url });
});

type BrandAssetRow = AssetRow & { kind: string };

// Brand identity uploads (logo/posts/references) shown on the /empresa card.
meAssetsRoutes.get("/brand-assets", async (c) => {
  const { companyId } = c.get("session");
  const { results } = await c.env.DB.prepare(
    `SELECT id, mime, bytes, metadata, created_at
       FROM asset
       WHERE company_id = ? AND kind = 'brand_asset'
       ORDER BY created_at DESC`,
  )
    .bind(companyId)
    .all<BrandAssetRow>();

  const items = await Promise.all(
    results.map(async (row) => {
      const metadata = safeJson<{ category?: string; originalName?: string }>(row.metadata, {});
      return {
        category: metadata?.category ?? "other",
        createdAt: new Date(row.created_at).toISOString(),
        id: row.id,
        mimeType: row.mime,
        name: metadata?.originalName ?? null,
        size: row.bytes,
        url: await buildSignedAssetUrl(
          { ASSETS_SIGNING_KEY: c.env.ASSETS_SIGNING_KEY },
          c.env.WORKER_PUBLIC_URL,
          row.id,
        ),
      };
    }),
  );

  return c.json({ items });
});

meAssetsRoutes.post("/brand-assets", async (c) => {
  const session = c.get("session");
  if (session.role !== "CUSTOMER") {
    return c.json({ error: "forbidden" }, 403);
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "Invalid multipart body" }, 400);
  }

  const validated = readUploadedImage(form);
  if ("error" in validated) {
    return c.json({ error: validated.error }, validated.status);
  }
  const rawCategory = form.get("category");
  const category = typeof rawCategory === "string" && BRAND_CATEGORIES.has(rawCategory)
    ? rawCategory
    : "other";

  const { assetId, bytes, mime } = await persistImageAsset(c.env, {
    companyId: session.companyId,
    extraMeta: { category },
    file: validated.file,
    kind: "brand_asset",
  });
  const url = await buildSignedAssetUrl(
    { ASSETS_SIGNING_KEY: c.env.ASSETS_SIGNING_KEY },
    c.env.WORKER_PUBLIC_URL,
    assetId,
    SEVEN_DAYS_MS,
  );

  return c.json({ assetId, category, mime, size: bytes, url });
});

// r2_key is company-prefixed and (company_id, sha256) is UNIQUE, so the row is
// the sole reference to its blob — safe to delete the D1 row and R2 object together.
meAssetsRoutes.delete("/brand-assets/:id", async (c) => {
  const session = c.get("session");
  if (session.role !== "CUSTOMER") {
    return c.json({ error: "forbidden" }, 403);
  }
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT r2_key FROM asset WHERE id = ? AND company_id = ? AND kind = 'brand_asset'",
  )
    .bind(id, session.companyId)
    .first<{ r2_key: string }>();
  if (!row) {
    return c.json({ error: "not found" }, 404);
  }
  await c.env.DB.prepare("DELETE FROM asset WHERE id = ? AND company_id = ?")
    .bind(id, session.companyId)
    .run();
  await c.env.ASSETS.delete(row.r2_key);
  return c.json({ ok: true });
});

export { meAssetsRoutes };
