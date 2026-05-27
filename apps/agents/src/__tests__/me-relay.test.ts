import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_FETCH = globalThis.fetch;

const fullMe = {
  currentOrg: { id: "co_1", name: "Org", role: "CUSTOMER", slug: "org" },
  orgs: [{ id: "co_1", name: "Org", role: "CUSTOMER", slug: "org" }],
  role: "CUSTOMER",
  user: { displayName: null, email: "u@x.com", emailVerified: true, id: "u_1", name: "U" },
};

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("GET /api/me (P7.0 relay)", () => {
  it("401 when no token or cookie is present", async () => {
    const res = await SELF.fetch("https://agents.test/api/me");
    expect(res.status).toBe(401);
  });

  it("relays the auth service's MeResponse body unchanged", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(Response.json(fullMe)),
    ) as typeof globalThis.fetch;
    const res = await SELF.fetch("https://agents.test/api/me?cf_session=tok");
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof fullMe;
    expect(body.user.email).toBe("u@x.com");
    expect(body.currentOrg?.role).toBe("CUSTOMER");
  });

  it("forwards the auth service's non-OK status (401 → 401)", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("Unauthorized", { status: 401 })),
    ) as typeof globalThis.fetch;
    const res = await SELF.fetch("https://agents.test/api/me?cf_session=expired");
    expect(res.status).toBe(401);
  });

  it("returns 502 when the auth service is unreachable", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error("ECONNREFUSED")),
    ) as typeof globalThis.fetch;
    const res = await SELF.fetch("https://agents.test/api/me?cf_session=tok");
    expect(res.status).toBe(502);
  });

  it("forwards the Authorization Bearer header from the cf_session param", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(Response.json(fullMe)));
    globalThis.fetch = fetchSpy as typeof globalThis.fetch;
    await SELF.fetch("https://agents.test/api/me?cf_session=THE_TOKEN");
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer THE_TOKEN");
  });

  it("serves the second call from KV cache (X-Cache: hit, no second fetch)", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(Response.json(fullMe)));
    globalThis.fetch = fetchSpy as typeof globalThis.fetch;

    const first = await SELF.fetch("https://agents.test/api/me?cf_session=CACHE_TOK");
    expect(first.status).toBe(200);
    expect(first.headers.get("X-Cache")).toBe("miss");

    const second = await SELF.fetch("https://agents.test/api/me?cf_session=CACHE_TOK");
    expect(second.status).toBe(200);
    expect(second.headers.get("X-Cache")).toBe("hit");
    const body = (await second.json()) as typeof fullMe;
    expect(body.user.email).toBe("u@x.com");

    // Cache hit must NOT re-invoke fetch — Better Auth's rate-limit hot path
    // is exactly what the KV cache exists to protect.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache non-OK responses (401 from auth service, second call refetches)", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response("Unauthorized", { status: 401 })));
    globalThis.fetch = fetchSpy as typeof globalThis.fetch;

    const first = await SELF.fetch("https://agents.test/api/me?cf_session=NO_CACHE");
    expect(first.status).toBe(401);
    const second = await SELF.fetch("https://agents.test/api/me?cf_session=NO_CACHE");
    expect(second.status).toBe(401);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
