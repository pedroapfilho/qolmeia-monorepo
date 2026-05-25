import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  buildSignedAssetUrl,
  fetchAsset,
  signAssetToken,
  uploadAsset,
  verifyAssetToken,
} from "@/lib/r2";

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
