import { Hono } from "hono";

import { fetchAsset, verifyAssetToken } from "#/lib/r2";

// Serves R2 asset bytes behind a signed URL. The signed token is built by
// `buildSignedAssetUrl` (skills/generate-brand-image.ts uses it) and verified
// here per-request. Token is bound to the asset id + a TTL, so a leaked URL
// only serves one asset for a bounded window.
const assetsRoutes = new Hono<{ Bindings: Env }>();

type AssetRow = { mime: string; r2_key: string };

// SVGs are XSS-capable: opened directly (the gallery links assets in a new tab)
// an SVG runs embedded <script>. A `sandbox` CSP + `default-src 'none'` blocks
// script execution and external fetches on navigation, while <img> still
// renders it (img-loaded SVGs never run scripts anyway). nosniff on everything.
const buildAssetHeaders = (mime: string): Record<string, string> => {
  const headers: Record<string, string> = {
    "Cache-Control": "private, max-age=3600",
    "Content-Type": mime,
    "X-Content-Type-Options": "nosniff",
  };
  if (mime === "image/svg+xml") {
    headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  }
  return headers;
};

assetsRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const token = c.req.query("token");
  if (!token) {
    return c.text("Missing token", 401);
  }

  const valid = await verifyAssetToken(c.env.ASSETS_SIGNING_KEY, id, token);
  if (!valid) {
    return c.text("Invalid or expired token", 401);
  }

  const row = await c.env.DB.prepare("SELECT r2_key, mime FROM asset WHERE id = ?")
    .bind(id)
    .first<AssetRow>();
  if (!row) {
    return c.text("Not found", 404);
  }

  const object = await fetchAsset({ ASSETS: c.env.ASSETS }, row.r2_key);
  if (!object) {
    return c.text("Not found", 404);
  }

  return new Response(object.body, {
    headers: buildAssetHeaders(row.mime),
  });
});

export { assetsRoutes };
