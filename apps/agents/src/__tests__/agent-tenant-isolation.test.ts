import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

// The agent Durable Object is keyed by the <companyId> path segment, so the
// fetch-handler gate must reject a CUSTOMER reaching another company's agent.
// Without this check a logged-in CUSTOMER of company A could open
// /agents/correspondent/<companyB> and act as company B (cross-tenant IDOR).

const originalFetch = globalThis.fetch;
const meCustomerA = { currentOrg: { id: "co_tenant_A", role: "CUSTOMER" }, user: { id: "u_A" } };

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("agent path tenant isolation", () => {
  it("403s when a CUSTOMER targets another company's agent", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomerA)));
    const res = await SELF.fetch("https://agents.test/agents/correspondent/co_tenant_B?cf_session=tok");
    expect(res.status).toBe(403);
  });

  it("passes the tenant gate when the path company matches the session", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomerA)));
    const res = await SELF.fetch("https://agents.test/agents/correspondent/co_tenant_A?cf_session=tok");
    // Past the gate the request reaches routeAgentRequest (a plain GET yields a
    // non-403 response); the point is the gate itself does not block a match.
    expect(res.status).not.toBe(403);
  });
});
