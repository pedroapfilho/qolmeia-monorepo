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

  const file = form.get("file");
  if (!(file instanceof File)) {
    return c.json({ error: "Missing 'file' field" }, 400);
  }
  if (!ALLOWED_UPLOAD_MIME.has(file.type)) {
    return c.json({ error: `Unsupported mime '${file.type}'` }, 415);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: `File too large (max ${MAX_UPLOAD_BYTES} bytes)` }, 413);
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return c.json({ error: `File too large (max ${MAX_UPLOAD_BYTES} bytes)` }, 413);
  }

  const sha = await sha256OfBytes(bytes);
  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const r2Key = `org_${companyId}/${sha}.${ext}`;

  await uploadAsset(
    { ASSETS: c.env.ASSETS },
    {
      bytes,
      key: r2Key,
      metadata: { uploader: "customer" },
      mime: file.type,
    },
  );

  const candidateId = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO asset
       (id, company_id, kind, r2_key, sha256, mime, bytes, metadata, created_at)
     VALUES (?, ?, 'user_upload', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      candidateId,
      companyId,
      r2Key,
      sha,
      file.type,
      bytes.length,
      JSON.stringify({ originalName: file.name || null }),
      now,
    )
    .run();
  const existing = await c.env.DB.prepare(
    "SELECT id FROM asset WHERE company_id = ? AND sha256 = ? LIMIT 1",
  )
    .bind(companyId, sha)
    .first<{ id: string }>();
  const assetId = existing?.id ?? candidateId;

  // 7-day TTL because this URL is baked into a chat-history FileUIPart and
  // the bubble has to keep rendering long after the upload. The gallery
  // list above re-signs per RSC render with the shorter default TTL.
  const url = await buildSignedAssetUrl(
    { ASSETS_SIGNING_KEY: c.env.ASSETS_SIGNING_KEY },
    c.env.WORKER_PUBLIC_URL,
    assetId,
    SEVEN_DAYS_MS,
  );

  return c.json({ assetId, mime: file.type, size: bytes.length, url });
});

export { meAssetsRoutes };
