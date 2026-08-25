import "#/lib/observability";

import { createAgentRouter } from "@flue/runtime/routing";
import { log } from "@repo/observability";
import { honoEvlog } from "@repo/observability/hono";
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

import { CorrespondentV2 } from "#/agents/correspondent";
import { PlannerV2 } from "#/agents/planner";
import { requireCustomerAgent } from "#/lib/agent-route-auth";
import type { SessionEnv } from "#/lib/auth";
import { assetsRoutes } from "#/routes/assets";
import { backofficeRoutes } from "#/routes/backoffice";
import { meRoutes } from "#/routes/me";
import { teamsRoutes } from "#/routes/teams";

const app = new Hono<SessionEnv>();

app.use("*", honoEvlog());

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
  if (error instanceof HTTPException) {
    return error.getResponse();
  }
  log.error({
    error: error instanceof Error ? error.message : String(error),
    message: "worker.unhandled",
    method: c.req.method,
    path: new URL(c.req.url).pathname,
  });
  return c.json({ error: "internal error" }, 500);
});

app.get("/healthz", (c) => c.json({ status: "ok" }));
app.route("/api/backoffice", backofficeRoutes);
app.route("/api/me", meRoutes);
app.route("/api/teams", teamsRoutes);
app.route("/assets", assetsRoutes);

app.use("/agents/correspondent/*", requireCustomerAgent);
app.use("/agents/planner/*", requireCustomerAgent);
app.route("/agents/correspondent", createAgentRouter(CorrespondentV2));
app.route("/agents/planner", createAgentRouter(PlannerV2));

export default app;
