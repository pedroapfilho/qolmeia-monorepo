import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { validateSession } from "#/lib/auth";

const originalFetch = globalThis.fetch;

const meCustomer = {
  currentOrg: { id: "co_1", role: "CUSTOMER" },
  user: { id: "u_1" },
};
const meStaff = {
  currentOrg: { id: "co_1", role: "STAFF" },
  user: { id: "u_2" },
};

const buildRequest = (token: string) =>
  new Request(`http://agents.test/agents/correspondent/co_1?cf_session=${token}`);

const outboundAuthHeader = (init: RequestInit | undefined): string | undefined =>
  (init?.headers as Record<string, string> | undefined)?.Authorization;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("validateSession", () => {
  it("resolves a CUSTOMER session from /api/me", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const result = await validateSession(buildRequest("tok"), env);
    expect(result).toEqual({ companyId: "co_1", role: "CUSTOMER", userId: "u_1" });
  });

  it("returns role STAFF when the membership says so (guard is the caller's job)", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const result = await validateSession(buildRequest("tok"), env);
    expect(result?.role).toBe("STAFF");
  });

  it("resolves a session from an inbound Authorization: Bearer header (no cf_session/Cookie)", async () => {
    const fetchSpy = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(Response.json(meCustomer)),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const req = new Request("http://agents.test/api/me", {
      headers: { Authorization: "Bearer header-tok" },
    });
    const result = await validateSession(req, env);
    expect(result).toEqual({ companyId: "co_1", role: "CUSTOMER", userId: "u_1" });
    expect(outboundAuthHeader(fetchSpy.mock.calls[0]?.[1])).toBe("Bearer header-tok");
  });

  it("prefers the inbound Authorization header over the cf_session query param", async () => {
    const fetchSpy = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(Response.json(meCustomer)),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const req = new Request("http://agents.test/api/me?cf_session=query-tok", {
      headers: { Authorization: "Bearer header-tok" },
    });
    await validateSession(req, env);
    expect(outboundAuthHeader(fetchSpy.mock.calls[0]?.[1])).toBe("Bearer header-tok");
  });

  it("returns null when /api/me responds 401", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response("Unauthorized", { status: 401 })));
    expect(await validateSession(buildRequest("tok"), env)).toBeNull();
  });

  it("returns null and logs when the auth service is unreachable", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));
    expect(await validateSession(buildRequest("tok"), env)).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/me request failed"),
      expect.objectContaining({ error: expect.any(Error) }),
    );
    consoleSpy.mockRestore();
  });

  it("returns null when no cf_session token and no cookie are present", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    const req = new Request("http://agents.test/agents/correspondent/co_1");
    expect(await validateSession(req, env)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
