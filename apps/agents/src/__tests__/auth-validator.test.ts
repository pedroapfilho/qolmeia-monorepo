import { env } from "cloudflare:workers";
import { HTTPException } from "hono/http-exception";
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

const buildOrgScopedRequest = (orgId: string) =>
  new Request("http://agents.test/api/me/company?cf_session=shared-tok", {
    headers: { "X-Org-Id": orgId },
  });

const outboundHeaders = (init: RequestInit | undefined): Record<string, string> =>
  (init?.headers as Record<string, string> | undefined) ?? {};

const outboundAuthHeader = (init: RequestInit | undefined): string | undefined =>
  outboundHeaders(init).Authorization;

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
    globalThis.fetch = fetchSpy;
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
    globalThis.fetch = fetchSpy;
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
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("me.fetch.failed"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("ECONNREFUSED"));
    consoleSpy.mockRestore();
  });

  it("returns null when no cf_session token and no cookie are present", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    const req = new Request("http://agents.test/agents/correspondent/co_1");
    expect(await validateSession(req, env)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("forwards X-Org-Id upstream and keeps one token's orgs in separate cache entries", async () => {
    const fetchSpy = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        Response.json({
          currentOrg: { id: outboundHeaders(init)["X-Org-Id"], role: "CUSTOMER" },
          user: { id: "u_1" },
        }),
      ),
    );
    globalThis.fetch = fetchSpy;

    const first = await validateSession(buildOrgScopedRequest("co_a"), env);
    const second = await validateSession(buildOrgScopedRequest("co_b"), env);
    const firstAgain = await validateSession(buildOrgScopedRequest("co_a"), env);

    expect(first?.companyId).toBe("co_a");
    expect(second?.companyId).toBe("co_b");
    expect(firstAgain?.companyId).toBe("co_a");
    expect(outboundHeaders(fetchSpy.mock.calls[0]?.[1])["X-Org-Id"]).toBe("co_a");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("reads the org from the org_id query param, which is all EventSource can send", async () => {
    globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        Response.json({
          currentOrg: { id: outboundHeaders(init)["X-Org-Id"], role: "CUSTOMER" },
          user: { id: "u_1" },
        }),
      ),
    );

    const session = await validateSession(
      new Request("http://agents.test/api/me/team/events?cf_session=sse-tok&org_id=co_sse"),
      env,
    );

    expect(session?.companyId).toBe("co_sse");
  });

  it("raises a 400 rather than a 401 when the account belongs to more than one org", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        Response.json({
          currentOrg: null,
          orgs: [
            { id: "co_a", name: "A", role: "CUSTOMER" },
            { id: "co_b", name: "B", role: "CUSTOMER" },
          ],
          user: { id: "u_1" },
        }),
      ),
    );

    const failure: unknown = await validateSession(buildRequest("ambiguous-tok"), env).catch(
      (error: unknown) => error,
    );

    if (!(failure instanceof HTTPException)) {
      throw new Error(`expected an HTTPException, got ${String(failure)}`);
    }
    const res = failure.getResponse();
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; orgs: ReadonlyArray<{ id: string }> }>();
    expect(body.error).toBe("org_required");
    expect(body.orgs.map((org) => org.id)).toEqual(["co_a", "co_b"]);
  });

  it("still returns null when the account belongs to no org at all", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(Response.json({ currentOrg: null, orgs: [], user: { id: "u_1" } })),
    );

    expect(await validateSession(buildRequest("no-org-tok"), env)).toBeNull();
  });
});
