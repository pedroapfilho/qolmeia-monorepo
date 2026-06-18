// Module-level evlog logger for startup/shutdown lines that run outside any
// request scope. Request-scoped code uses `c.get("log")` from honoEvlog().
export { log } from "@repo/observability/hono";
