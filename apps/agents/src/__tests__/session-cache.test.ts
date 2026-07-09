import { describe, expect, it } from "vitest";

import { buildCacheKey } from "#/lib/session-cache";

describe("buildCacheKey", () => {
  it("hashes bearer/query tokens instead of embedding raw secrets", async () => {
    const key = await buildCacheKey({ cookie: null, namespace: "session", token: "raw-token" });

    expect(key).toMatch(/^session:tok:[a-f0-9]{64}$/v);
    expect(key).not.toContain("raw-token");
  });

  it("hashes cookie headers", async () => {
    const key = await buildCacheKey({
      cookie: "better-auth.session_token=secret",
      namespace: "session",
      token: null,
    });

    expect(key).toMatch(/^session:cookie:[a-f0-9]{64}$/v);
    expect(key).not.toContain("secret");
  });
});
