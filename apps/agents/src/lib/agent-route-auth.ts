import type { MiddlewareHandler } from "hono";

import { validateSession } from "#/lib/auth";

const requireCustomerAgent: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const session = await validateSession(c.req.raw, c.env);
  if (!session) {
    return c.text("Unauthorized", 401);
  }
  if (session.role !== "CUSTOMER") {
    return c.text("Forbidden", 403);
  }
  const pathCompanyId = new URL(c.req.url).pathname.split("/")[3];
  if (pathCompanyId !== session.companyId) {
    return c.text("Forbidden", 403);
  }
  return next();
};

export { requireCustomerAgent };
