# Tenant isolation on the agent path: never trust the path company id

The per-tenant agent Durable Objects (`CorrespondentAgent`, `PlannerAgent`, `WorkerAgent`) are addressed as `/agents/<name>/<companyId>`, and `routeAgentRequest` keys the DO instance by that path segment, not by the authenticated session. The session validator (`lib/auth.ts`) already resolves the caller's `companyId` from Better Auth, and every REST route under `/api/me/*` routes by `session.companyId`, so they are inherently tenant-safe. The agent path was the one surface that trusted the URL: it checked `role === "CUSTOMER"` but not that the path's `companyId` matched the session, allowing a logged-in customer to open another company's agent (cross-tenant IDOR).

**Decision:** the fetch-handler gate in `apps/agents/src/index.ts` rejects with `403` when the `<companyId>` path segment ≠ `session.companyId`. Treat the path company id as untrusted input everywhere a company id appears in a URL; authorize against the session, never the path.

We chose compare-and-reject over rewriting the request URL to `session.companyId` before routing. It is the minimal change, keeps the URL shape the Next rewrites depend on, and is covered by a regression test (`agent-tenant-isolation.test.ts`). A future hardening could derive the DO name from the session directly so a mismatch is structurally impossible.
