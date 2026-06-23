import type { MiddlewareHandler } from "hono";

import { validateSession } from "#/lib/auth";

// Gates a Flue agent's HTTP route: only an authenticated CUSTOMER may reach
// /agents/<name>/<companyId>, and only their OWN company's agent (the :id path
// segment must match the session's company). Mirrors the gate the legacy
// routeAgentRequest path enforced in the old src/index.ts. Used as each
// conversational agent's `route` export.
const requireCustomerAgent: MiddlewareHandler = async (c, next) => {
  const session = await validateSession(c.req.raw, c.env as Env);
  if (!session) {
    return c.text("Unauthorized", 401);
  }
  if (session.role !== "CUSTOMER") {
    return c.text("Forbidden", 403);
  }
  // Tenant isolation: never trust the path — /agents/<name>/<companyId>.
  const pathCompanyId = new URL(c.req.url).pathname.split("/")[3];
  if (pathCompanyId !== session.companyId) {
    return c.text("Forbidden", 403);
  }
  return next();
};

export { requireCustomerAgent };
