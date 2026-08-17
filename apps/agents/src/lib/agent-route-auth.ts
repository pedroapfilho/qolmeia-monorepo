import { sessionGuard } from "#/lib/auth";

/**
 * Agent paths are mounted as /agents/<name>/<companyId>, so segment 3 is the
 * tenant the caller is asking for. A short path yields undefined, which never
 * equals a session's companyId, so it denies.
 */
const requireCustomerAgent = sessionGuard({
  allow: new Set(["CUSTOMER"]),
  scope: (c, session) => new URL(c.req.url).pathname.split("/")[3] === session.companyId,
});

export { requireCustomerAgent };
