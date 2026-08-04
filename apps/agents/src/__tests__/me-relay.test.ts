import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_FETCH = globalThis.fetch;

const fullMe = {
  currentOrg: { id: "co_1", name: "Org", role: "CUSTOMER", slug: "org" },
  orgs: [{ id: "co_1", name: "Org", role: "CUSTOMER", slug: "org" }],
  role: "CUSTOMER",
  user: { displayName: null, email: "u@x.com", emailVerified: true, id: "u_1", name: "U" },
};

const relayForOrg = (orgId: string) =>
  exports.default.fetch("https://agents.test/api/me?cf_session=ORG_TOK", {
    headers: { "X-Org-Id": orgId },
  });

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("GET /api/me (P7.0 relay)", () => {
  it("401 when no token or cookie is present", async () => {
    const res = await exports.default.fetch("https://agents.test/api/me");
    expect(res.status).toBe(401);
  });

  it("relays the auth service's MeResponse body unchanged", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(fullMe)));
    const res = await exports.default.fetch("https://agents.test/api/me?cf_session=tok");
    expect(res.status).toBe(200);
    const body = await res.json<typeof fullMe>();
    expect(body.user.email).toBe("u@x.com");
    expect(body.currentOrg?.role).toBe("CUSTOMER");
  });

  it("forwards the auth service's non-OK status (401 → 401)", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response("Unauthorized", { status: 401 })));
    const res = await exports.default.fetch("https://agents.test/api/me?cf_session=expired");
    expect(res.status).toBe(401);
  });

  it("returns 502 when the auth service is unreachable", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));
    const res = await exports.default.fetch("https://agents.test/api/me?cf_session=tok");
    expect(res.status).toBe(502);
  });

  it("forwards the Authorization Bearer header from the cf_session param", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(Response.json(fullMe)));
    globalThis.fetch = fetchSpy;
    await exports.default.fetch("https://agents.test/api/me?cf_session=THE_TOKEN");
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer THE_TOKEN");
  });

  it("serves the second call from KV cache (X-Cache: hit, no second fetch)", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(Response.json(fullMe)));
    globalThis.fetch = fetchSpy;

    const first = await exports.default.fetch("https://agents.test/api/me?cf_session=CACHE_TOK");
    expect(first.status).toBe(200);
    expect(first.headers.get("X-Cache")).toBe("miss");

    const second = await exports.default.fetch("https://agents.test/api/me?cf_session=CACHE_TOK");
    expect(second.status).toBe(200);
    expect(second.headers.get("X-Cache")).toBe("hit");
    const body = await second.json<typeof fullMe>();
    expect(body.user.email).toBe("u@x.com");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("forwards X-Org-Id and keeps one token's orgs in separate cache entries", async () => {
    const fetchSpy = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        Response.json({
          ...fullMe,
          currentOrg: {
            ...fullMe.currentOrg,
            id: (init?.headers as Record<string, string> | undefined)?.["X-Org-Id"] ?? "unset",
          },
        }),
      ),
    );
    globalThis.fetch = fetchSpy;

    const a = await relayForOrg("co_a");
    const b = await relayForOrg("co_b");
    const bodyA = await a.json<typeof fullMe>();
    const bodyB = await b.json<typeof fullMe>();

    expect(bodyA.currentOrg.id).toBe("co_a");
    expect(bodyB.currentOrg.id).toBe("co_b");
    expect(b.headers.get("X-Cache")).toBe("miss");
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const aAgain = await relayForOrg("co_a");
    const bodyAAgain = await aAgain.json<typeof fullMe>();
    expect(aAgain.headers.get("X-Cache")).toBe("hit");
    expect(bodyAAgain.currentOrg.id).toBe("co_a");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does NOT cache non-OK responses (401 from auth service, second call refetches)", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response("Unauthorized", { status: 401 })));
    globalThis.fetch = fetchSpy;

    const first = await exports.default.fetch("https://agents.test/api/me?cf_session=NO_CACHE");
    expect(first.status).toBe(401);
    const second = await exports.default.fetch("https://agents.test/api/me?cf_session=NO_CACHE");
    expect(second.status).toBe(401);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
