// Rewrites signed asset URLs to data: URLs by reading bytes from R2.
//
// Why this exists: the AI SDK's built-in URL downloader (see
// `@ai-sdk/provider-utils → validateDownloadUrl`) refuses to fetch
// localhost / .local / private-IP hosts as an SSRF guard. In dev that
// means signed `/assets/<id>?token=…` URLs pointing at the local Worker
// can't reach the model. Rewriting to a `data:<mime>;base64,…` URL
// before the call sidesteps the validator. In prod it also saves a
// redundant HTTP roundtrip (Worker → its own /assets endpoint → R2)
// since we're already inside the Worker that owns the R2 binding.
//
// Scoping: the asset row is looked up by `(id, companyId)` so a customer
// can't paste an asset id belonging to a different tenant — even if they
// know the id, the row won't match. Unknown / cross-tenant / R2-miss
// images are dropped with a warning rather than throwing, so a single
// bad attachment doesn't fail the turn.

import type { AttachedImage } from "@/agents/correspondent-context";
import { logWarn } from "@/lib/logger";
import { fetchAsset } from "@/lib/r2";

type ResolverEnv = {
  ASSETS: Env["ASSETS"];
  DB: D1Database;
};

// Pulls the asset id segment out of `…/assets/<id>?token=…`. Accepts both
// absolute http(s) URLs and bare paths. Returns null when the shape doesn't
// match — callers should drop the attachment in that case.
const extractAssetIdFromUrl = (url: string): string | null => {
  let path: string;
  try {
    path = url.startsWith("http") ? new URL(url).pathname : (url.split("?")[0] ?? "");
  } catch {
    return null;
  }
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("assets");
  if (idx === -1 || idx !== segments.length - 2) {
    return null;
  }
  return segments.at(-1) ?? null;
};

const arrayBufferToDataUrl = (buf: ArrayBuffer, mime: string): string => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) {
    s += String.fromCodePoint(b);
  }
  return `data:${mime};base64,${btoa(s)}`;
};

const resolveImagesToDataUrls = async (
  env: ResolverEnv,
  companyId: string,
  images: ReadonlyArray<AttachedImage>,
): Promise<ReadonlyArray<AttachedImage>> => {
  if (images.length === 0) {
    return images;
  }
  const resolved = await Promise.all(
    images.map(async (image) => {
      if (image.url.startsWith("data:")) {
        return image;
      }
      const assetId = extractAssetIdFromUrl(image.url);
      if (!assetId) {
        logWarn("agent.attachment.skip", {
          companyId,
          reason: "url-not-asset",
          url: image.url,
        });
        return null;
      }
      const row = await env.DB.prepare(
        "SELECT r2_key, mime FROM asset WHERE id = ? AND company_id = ?",
      )
        .bind(assetId, companyId)
        .first<{ mime: string; r2_key: string }>();
      if (!row) {
        logWarn("agent.attachment.skip", {
          assetId,
          companyId,
          reason: "asset-not-found",
        });
        return null;
      }
      const object = await fetchAsset({ ASSETS: env.ASSETS }, row.r2_key);
      if (!object) {
        logWarn("agent.attachment.skip", { assetId, companyId, reason: "r2-miss" });
        return null;
      }
      const buf = await object.arrayBuffer();
      return { mediaType: row.mime, url: arrayBufferToDataUrl(buf, row.mime) };
    }),
  );
  return resolved.filter((value): value is AttachedImage => value !== null);
};

export { resolveImagesToDataUrls };
export type { ResolverEnv };
