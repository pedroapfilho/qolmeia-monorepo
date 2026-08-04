import type { Prisma } from "@repo/db/worker";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "#/db/client";
import { assetName, persistAsset } from "#/lib/asset-store";
import type { ValidatedSession } from "#/lib/auth";
import { parsePositiveInt } from "#/lib/pagination";
import { buildSignedAssetUrl } from "#/lib/r2";

type Vars = { session: ValidatedSession };

// Mounted inside meRoutes, which owns the session guard and the customer write
// gate for the whole /api/me prefix.
const meAssetsRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

meAssetsRoutes.get("/assets", async (c) => {
  const { companyId } = c.get("session");
  const limit = parsePositiveInt(c.req.query("limit"), 100, 200);
  const results = await getDb(c.env).asset.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    where: { companyId, visibility: "customer" },
  });

  const items = await Promise.all(
    results.map(async (row) => ({
      createdAt: row.createdAt.toISOString(),
      id: row.id,
      kind: row.kind,
      metadata: row.metadata,
      mimeType: row.mime,
      name: assetName(row.metadata, row.id, row.kind),
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

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_MIME = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const persistImageAsset = async (
  env: Env,
  opts: {
    companyId: string;
    extraMeta: Prisma.InputJsonObject;
    file: File;
    kind: "brand_asset" | "user_upload";
  },
): Promise<{ assetId: string; bytes: number; mime: string }> => {
  const { companyId, extraMeta, file, kind } = opts;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { assetId } = await persistAsset(env, {
    bytes,
    companyId,
    kind,
    metadata: { originalName: file.name || null, ...extraMeta },
    mime: file.type,
    uploadMetadata: { uploader: "customer" },
    visibility: "customer",
  });
  return { assetId, bytes: bytes.length, mime: file.type };
};

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

  const url = await buildSignedAssetUrl(
    { ASSETS_SIGNING_KEY: c.env.ASSETS_SIGNING_KEY },
    c.env.WORKER_PUBLIC_URL,
    assetId,
    SEVEN_DAYS_MS,
  );

  return c.json({ assetId, mime, size: bytes, url });
});

meAssetsRoutes.get("/brand-assets", async (c) => {
  const { companyId } = c.get("session");
  const results = await getDb(c.env).asset.findMany({
    orderBy: { createdAt: "desc" },
    where: { companyId, kind: "brand_asset" },
  });

  const items = await Promise.all(
    results.map(async (row) => {
      // oxlint-disable-next-line no-unsafe-type-assertion -- metadata is a JSON column written by the brand-asset upload route in this app
      const metadata = (row.metadata ?? {}) as { category?: string; originalName?: string };
      return {
        category: metadata?.category ?? "other",
        createdAt: row.createdAt.toISOString(),
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
  const category =
    typeof rawCategory === "string" && BRAND_CATEGORIES.has(rawCategory) ? rawCategory : "other";

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

meAssetsRoutes.delete("/brand-assets/:id", async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");
  const db = getDb(c.env);
  const row = await db.asset.findFirst({
    select: { r2Key: true },
    where: { companyId: session.companyId, id, kind: "brand_asset" },
  });
  if (!row) {
    return c.json({ error: "not found" }, 404);
  }
  await db.asset.deleteMany({ where: { companyId: session.companyId, id } });
  await c.env.ASSETS.delete(row.r2Key);
  return c.json({ ok: true });
});

const deleteAssetsInputSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});

meAssetsRoutes.post("/assets/delete", async (c) => {
  const session = c.get("session");
  const parsed = deleteAssetsInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body" }, 400);
  }
  const { ids } = parsed.data;
  const db = getDb(c.env);
  const results = await db.asset.findMany({
    select: { id: true, r2Key: true },
    where: { companyId: session.companyId, id: { in: ids }, visibility: "customer" },
  });
  if (results.length === 0) {
    return c.json({ deleted: 0 });
  }
  const foundIds = results.map((row) => row.id);
  await db.asset.deleteMany({ where: { companyId: session.companyId, id: { in: foundIds } } });
  await Promise.allSettled(results.map((row) => c.env.ASSETS.delete(row.r2Key)));
  return c.json({ deleted: results.length });
});

export { meAssetsRoutes };
