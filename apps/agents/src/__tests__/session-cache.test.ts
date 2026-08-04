import { describe, expect, it } from "vitest";

import { buildCacheKey } from "#/lib/session-cache";

describe("buildCacheKey", () => {
  it("hashes bearer/query tokens instead of embedding raw secrets", async () => {
    const key = await buildCacheKey({
      cookie: null,
      namespace: "session",
      orgId: null,
      token: "raw-token",
    });

    expect(key).toMatch(/^session:tok:[a-f0-9]{64}$/v);
    expect(key).not.toContain("raw-token");
  });

  it("hashes cookie headers", async () => {
    const key = await buildCacheKey({
      cookie: "better-auth.session_token=secret",
      namespace: "session",
      orgId: null,
      token: null,
    });

    expect(key).toMatch(/^session:cookie:[a-f0-9]{64}$/v);
    expect(key).not.toContain("secret");
  });

  it("scopes one token's entries per org", async () => {
    const [orgA, orgB, noOrg] = await Promise.all(
      [{ orgId: "org_a" }, { orgId: "org_b" }, { orgId: null }].map((scope) =>
        buildCacheKey({ cookie: null, namespace: "session", token: "same-token", ...scope }),
      ),
    );

    expect(new Set([orgA, orgB, noOrg]).size).toBe(3);
    expect(orgA).toMatch(/^session:tok:[a-f0-9]{64}$/v);
    expect(orgA).not.toContain("org_a");
  });

  it("keeps an org/credential pair that shares a delimiter in its own entry", async () => {
    const [split, shifted] = await Promise.all(
      [
        { orgId: "a", token: "b:c" },
        { orgId: "a:b", token: "c" },
      ].map((scope) => buildCacheKey({ cookie: null, namespace: "session", ...scope })),
    );

    expect(split).not.toBe(shifted);
  });

  it("scopes cookie entries per org too", async () => {
    const [orgA, orgB] = await Promise.all(
      ["org_a", "org_b"].map((orgId) =>
        buildCacheKey({ cookie: "session=abc", namespace: "session", orgId, token: null }),
      ),
    );

    expect(orgA).not.toBe(orgB);
  });
});
