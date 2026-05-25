import { Hono } from "hono";

import { fetchAsset, verifyAssetToken } from "@/lib/r2";

// Serves R2 asset bytes behind a signed URL. The signed token is built by
// `buildSignedAssetUrl` (skills/generate-brand-image.ts uses it) and verified
// here per-request. Token is bound to the asset id + a TTL, so a leaked URL
// only serves one asset for a bounded window.
const assetsRoutes = new Hono<{ Bindings: Env }>();

type AssetRow = { mime: string; r2_key: string };

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
    headers: {
      "Cache-Control": "private, max-age=3600",
      "Content-Type": row.mime,
    },
  });
});

export { assetsRoutes };
