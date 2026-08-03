import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requireCustomerAgent } from "#/lib/agent-route-auth";

const COMPANY_ID = "co_agent_auth_test";
const OTHER_COMPANY_ID = "co_agent_auth_other";
const ORIGINAL_FETCH = globalThis.fetch;

const guardedApp = new Hono<{ Bindings: Env }>();
guardedApp.use("/agents/correspondent/*", requireCustomerAgent);
guardedApp.use("/agents/planner/*", requireCustomerAgent);
guardedApp.all("/agents/:agent/:companyId", (c) => c.text("admitted"));

const requestAgent = (agent: "correspondent" | "planner", companyId: string, token?: string) => {
  const query = token === undefined ? "" : `?cf_session=${token}`;
  return guardedApp.fetch(
    new Request(`https://agents.test/agents/${agent}/${companyId}${query}`),
    env,
  );
};

const membership = (role: "CUSTOMER" | "OWNER" | "STAFF", companyId = COMPANY_ID) => ({
  currentOrg: { id: companyId, role },
  user: { id: `user-${role.toLowerCase()}` },
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("agent route auth", () => {
  it("rejects a request without a session", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const response = await requestAgent("correspondent", COMPANY_ID);

    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-customer session", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(membership("STAFF"))));

    const response = await requestAgent("correspondent", COMPANY_ID, "staff-token");

    expect(response.status).toBe(403);
  });

  it("rejects a customer from another company", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(membership("CUSTOMER"))));

    const response = await requestAgent("planner", OTHER_COMPANY_ID, "wrong-company-token");

    expect(response.status).toBe(403);
  });

  it.each(["correspondent", "planner"] as const)(
    "admits a matching customer to the %s route",
    async (agent) => {
      globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(membership("CUSTOMER"))));

      const response = await requestAgent(agent, COMPANY_ID, `${agent}-customer-token`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("admitted");
    },
  );
});
