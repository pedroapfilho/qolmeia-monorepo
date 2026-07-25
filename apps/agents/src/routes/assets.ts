import { Hono } from "hono";

import { getDb } from "#/db/client";
import { fetchAsset, verifyAssetToken } from "#/lib/r2";

const assetsRoutes = new Hono<{ Bindings: Env }>();

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
  if (token === undefined || token === "") {
    return c.text("Missing token", 401);
  }

  const valid = await verifyAssetToken(c.env.ASSETS_SIGNING_KEY, id, token);
  if (!valid) {
    return c.text("Invalid or expired token", 401);
  }

  const row = await getDb(c.env).asset.findUnique({
    select: { mime: true, r2Key: true },
    where: { id },
  });
  if (!row) {
    return c.text("Not found", 404);
  }

  const object = await fetchAsset({ ASSETS: c.env.ASSETS }, row.r2Key);
  if (!object) {
    return c.text("Not found", 404);
  }

  return new Response(object.body, {
    headers: buildAssetHeaders(row.mime),
  });
});

export { assetsRoutes };
