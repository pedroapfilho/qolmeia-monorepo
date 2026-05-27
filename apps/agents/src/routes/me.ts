import { Hono } from "hono";

import { listActivity } from "@/activity/log";
import { listActiveTemplates } from "@/db/template";
import { validateSession, type ValidatedSession } from "@/lib/auth";
import { parseBrief } from "@/lib/company-brief";
import { logError, logWarn } from "@/lib/logger";
import { buildSignedAssetUrl, uploadAsset } from "@/lib/r2";

// Authenticated-user introspection endpoints — what the client needs to
// route between the Planner and the Correspondent. The auth service still
// owns identity; this Worker route owns *company* state (onboarding/active)
// and the live template catalog.
//
// GET /api/me relays the full MeResponse from the auth service so the Next
// apps target apps/agents uniformly. The response is cached in KV for
// `RELAY_CACHE_TTL_SECONDS` keyed on the bearer token (or a hash of the
// cookie) so multiple page renders in quick succession don't drive Better
// Auth's per-IP rate limit (100/15min on /api/v1/me).

const RELAY_CACHE_TTL_SECONDS = 60;

type Vars = { session: ValidatedSession };

const meRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

const sha256Hex = async (input: string): Promise<string> => {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(hash);
  let out = "";
  for (const byte of view) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
};

const buildRelayCacheKey = async (
  token: string | null,
  cookie: string | null,
): Promise<string | null> => {
  if (token) {
    return `me-relay:tok:${token}`;
  }
  if (cookie) {
    return `me-relay:cookie:${await sha256Hex(cookie)}`;
  }
  return null;
};

// Public relay — registered before the gating middleware so it handles its
// own auth (a pass-through, not a parsed-and-rebuilt response).
meRoutes.get("/", async (c) => {
  const tokenParam = new URL(c.req.url).searchParams.get("cf_session");
  const cookieHeader = c.req.header("Cookie");
  if (!tokenParam && !cookieHeader) {
    return c.text("Unauthorized", 401);
  }

  const cacheKey = await buildRelayCacheKey(tokenParam, cookieHeader ?? null);
  if (cacheKey && c.env.SESSIONS) {
    try {
      const cached = await c.env.SESSIONS.get(cacheKey);
      if (cached) {
        return new Response(cached, {
          headers: { "Content-Type": "application/json", "X-Cache": "hit" },
          status: 200,
        });
      }
    } catch (error) {
      logWarn("me.relay.cache.read.err", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (tokenParam) {
    headers.Authorization = `Bearer ${tokenParam}`;
  } else if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }
  let response: Response;
  try {
    response = await fetch(`${c.env.AUTH_SERVICE_URL}/api/v1/me`, { headers });
  } catch (error) {
    logError("me.relay.err", {
      error: error instanceof Error ? error.message : String(error),
    });
    return c.text("Auth service unreachable", 502);
  }

  const body = await response.text();
  if (response.ok && cacheKey && c.env.SESSIONS) {
    try {
      await c.env.SESSIONS.put(cacheKey, body, { expirationTtl: RELAY_CACHE_TTL_SECONDS });
    } catch (error) {
      logWarn("me.relay.cache.write.err", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return new Response(body, {
    headers: { "Content-Type": "application/json", "X-Cache": "miss" },
    status: response.status,
  });
});

// Everything below is gated by the same session validator that /agents uses.
meRoutes.use("*", async (c, next) => {
  const session = await validateSession(c.req.raw, c.env);
  if (!session) {
    return c.text("Unauthorized", 401);
  }
  c.set("session", session);
  await next();
});

meRoutes.get("/company", async (c) => {
  const { companyId } = c.get("session");
  const row = await c.env.DB.prepare("SELECT id, status, brief, slug FROM company WHERE id = ?")
    .bind(companyId)
    .first<{ brief: string | null; id: string; slug: string; status: string }>();
  if (!row) {
    return c.json({ error: "company not found" }, 404);
  }
  return c.json({
    company: {
      brief: parseBrief(row.brief),
      id: row.id,
      slug: row.slug,
      status: row.status,
    },
  });
});

meRoutes.get("/templates", async (c) => {
  const templates = await listActiveTemplates(c.env.DB);
  return c.json({
    templates: templates.map((t) => ({
      description: t.description,
      displayName: t.displayName,
      id: t.id,
      workerKind: t.workerKind,
    })),
  });
});

type AssetRow = {
  bytes: number;
  created_at: number;
  id: string;
  metadata: string | null;
  mime: string;
};

const safeJson = (value: string | null): unknown => {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

meRoutes.get("/assets", async (c) => {
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
      metadata: safeJson(row.metadata),
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

meRoutes.get("/activity", async (c) => {
  const { companyId } = c.get("session");
  const limit = parsePositiveInt(c.req.query("limit"), 50, 200);
  const entries = await listActivity(c.env.DB, { companyId, limit });
  return c.json({
    items: entries.map((entry) => ({
      createdAt: new Date(entry.createdAt).toISOString(),
      id: entry.id,
      summary: entry.summary,
      type: entry.type,
    })),
    nextCursor: null,
  });
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

const sha256OfBytes = async (bytes: Uint8Array): Promise<string> => {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

meRoutes.post("/uploads", async (c) => {
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
  // the bubble has to keep rendering long after the upload. The gallery list
  // above can keep the default 15-min TTL — it re-signs per RSC render.
  const url = await buildSignedAssetUrl(
    { ASSETS_SIGNING_KEY: c.env.ASSETS_SIGNING_KEY },
    c.env.WORKER_PUBLIC_URL,
    assetId,
    7 * 24 * 60 * 60 * 1000,
  );

  return c.json({ assetId, mime: file.type, size: bytes.length, url });
});

export { meRoutes };
