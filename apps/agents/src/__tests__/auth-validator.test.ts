import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { validateSession } from "@/lib/auth";

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

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("validateSession", () => {
  it("resolves a CUSTOMER session from /api/v1/me", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const result = await validateSession(buildRequest("tok"), env);
    expect(result).toEqual({ companyId: "co_1", role: "CUSTOMER", userId: "u_1" });
  });

  it("returns role STAFF when the membership says so (guard is the caller's job)", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const result = await validateSession(buildRequest("tok"), env);
    expect(result?.role).toBe("STAFF");
  });

  it("returns null when /api/v1/me responds 401", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("Unauthorized", { status: 401 })),
    );
    expect(await validateSession(buildRequest("tok"), env)).toBeNull();
  });

  it("returns null and logs when the auth service is unreachable", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));
    expect(await validateSession(buildRequest("tok"), env)).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/me request failed"),
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

describe("agent path role guard", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
  });

  it("rejects a STAFF session with 403", async () => {
    const res = await SELF.fetch(
      "https://agents.test/agents/correspondent/co_1?cf_session=tok",
    );
    expect(res.status).toBe(403);
  });
});
