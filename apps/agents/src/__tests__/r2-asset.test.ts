import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  buildSignedAssetUrl,
  fetchAsset,
  signAssetToken,
  uploadAsset,
  verifyAssetToken,
} from "#/lib/r2";

describe("R2 asset upload + fetch", () => {
  it("round-trips bytes through Miniflare R2", async () => {
    const bytes = new TextEncoder().encode("hello R2");
    await uploadAsset(
      { ASSETS: env.ASSETS },
      {
        bytes,
        key: "test/hello.txt",
        mime: "text/plain",
      },
    );
    const obj = await fetchAsset({ ASSETS: env.ASSETS }, "test/hello.txt");
    expect(obj).not.toBeNull();
    expect(await obj?.text()).toBe("hello R2");
  });
});

describe("signed asset URL", () => {
  it("verifies a fresh token for the same asset id", async () => {
    const token = await signAssetToken(env.ASSETS_SIGNING_KEY, "asset-1", 60_000);
    const ok = await verifyAssetToken(env.ASSETS_SIGNING_KEY, "asset-1", token);
    expect(ok).toBe(true);
  });

  it("rejects a token issued for a different asset id", async () => {
    const token = await signAssetToken(env.ASSETS_SIGNING_KEY, "asset-1", 60_000);
    const ok = await verifyAssetToken(env.ASSETS_SIGNING_KEY, "asset-other", token);
    expect(ok).toBe(false);
  });

  it("rejects an expired token", async () => {
    const token = await signAssetToken(env.ASSETS_SIGNING_KEY, "asset-1", -1000);
    const ok = await verifyAssetToken(env.ASSETS_SIGNING_KEY, "asset-1", token);
    expect(ok).toBe(false);
  });

  it("rejects a token signed by a different secret", async () => {
    const token = await signAssetToken("other-secret-key-32-bytes-or-more", "asset-1", 60_000);
    const ok = await verifyAssetToken(env.ASSETS_SIGNING_KEY, "asset-1", token);
    expect(ok).toBe(false);
  });

  it("buildSignedAssetUrl produces a URL the verifier accepts", async () => {
    const url = await buildSignedAssetUrl(
      { ASSETS_SIGNING_KEY: env.ASSETS_SIGNING_KEY },
      "http://worker.test",
      "asset-xyz",
    );
    expect(url.startsWith("http://worker.test/assets/asset-xyz?token=")).toBe(true);
    const token = new URL(url).searchParams.get("token");
    expect(token).not.toBeNull();
    if (token) {
      const ok = await verifyAssetToken(env.ASSETS_SIGNING_KEY, "asset-xyz", token);
      expect(ok).toBe(true);
    }
  });
});

const seedServedAsset = async (id: string, mime: string, key: string) => {
  await uploadAsset(
    { ASSETS: env.ASSETS },
    { bytes: new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), key, mime },
  );
  await env.DB.prepare(
    `INSERT OR IGNORE INTO company (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES ('co_svg', 'S', 's', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
  ).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO asset (id, company_id, kind, r2_key, sha256, mime, bytes, metadata, created_at)
     VALUES (?, 'co_svg', 'brand_asset', ?, ?, ?, 10, NULL, 0)`,
  )
    .bind(id, key, `sha-${id}`, mime)
    .run();
};

describe("asset serving headers", () => {
  it("serves an uploaded SVG with a sandbox CSP + nosniff", async () => {
    await seedServedAsset("svg-asset-1", "image/svg+xml", "org_co_svg/logo.svg");
    const url = await buildSignedAssetUrl(
      { ASSETS_SIGNING_KEY: env.ASSETS_SIGNING_KEY },
      "https://agents.test",
      "svg-asset-1",
    );
    const res = await SELF.fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("does not add the sandbox CSP to a raster image", async () => {
    await seedServedAsset("png-asset-1", "image/png", "org_co_svg/logo.png");
    const url = await buildSignedAssetUrl(
      { ASSETS_SIGNING_KEY: env.ASSETS_SIGNING_KEY },
      "https://agents.test",
      "png-asset-1",
    );
    const res = await SELF.fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
