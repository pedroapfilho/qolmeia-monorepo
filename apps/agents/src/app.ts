import { createAgentRouter } from "@flue/runtime/routing";
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

import { CorrespondentV2 } from "#/agents/correspondent";
import { PlannerV2 } from "#/agents/planner";
import { requireCustomerAgent } from "#/lib/agent-route-auth";
import { logError } from "#/lib/logger";
import { assetsRoutes } from "#/routes/assets";
import { backofficeRoutes } from "#/routes/backoffice";
import { internalRoutes } from "#/routes/internal";
import { meRoutes } from "#/routes/me";
import { meAssetsRoutes } from "#/routes/me-assets";
import { teamsRoutes } from "#/routes/teams";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    allowHeaders: ["Content-Type", "Authorization", "X-Org-Id"],
    credentials: true,
    origin: (origin, c: Context<{ Bindings: Env }>) => {
      const allowed = c.env.CLIENT_ORIGINS.split(",").map((value) => value.trim());
      return allowed.includes(origin) ? origin : null;
    },
  }),
);

app.use("*", async (c, next) => {
  // oxlint-disable-next-line callback-return -- Hono after-middleware: headers are set post-next()
  await next();
  if (c.res.headers.get("content-type")?.startsWith("text/event-stream") === true) {
    c.res.headers.set("cache-control", "no-cache, no-transform");
  }
});

app.onError((error, c) => {
  // A guard reports an actionable refusal (an unchosen org, say) as an
  // HTTPException; flattening it to 500 would hide the fix from the caller.
  if (error instanceof HTTPException) {
    return error.getResponse();
  }
  logError("worker.unhandled", {
    error: error instanceof Error ? error.message : String(error),
    method: c.req.method,
    path: new URL(c.req.url).pathname,
  });
  return c.json({ error: "internal error" }, 500);
});

app.get("/healthz", (c) => c.json({ status: "ok" }));
app.route("/api/backoffice", backofficeRoutes);
app.route("/api/internal", internalRoutes);
app.route("/api/me", meRoutes);
app.route("/api/me", meAssetsRoutes);
app.route("/api/teams", teamsRoutes);
app.route("/assets", assetsRoutes);

// Flue 2 mounts agents explicitly and dropped the agent-module `route` export,
// so the CUSTOMER guard is ordinary middleware. The `/agents/<name>/<companyId>`
// shape is preserved because requireCustomerAgent compares the third path
// segment against the session's company, and the client rewrites this prefix.
app.use("/agents/correspondent/*", requireCustomerAgent);
app.use("/agents/planner/*", requireCustomerAgent);
app.route("/agents/correspondent", createAgentRouter(CorrespondentV2));
app.route("/agents/planner", createAgentRouter(PlannerV2));

export default app;
