import { routeAgentRequest } from "agents";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { CorrespondentAgent } from "@/agents/correspondent";
import { PlannerAgent } from "@/agents/planner";
import { WorkerAgent } from "@/agents/worker";
import { validateSession } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { assetsRoutes } from "@/routes/assets";
import { backofficeRoutes } from "@/routes/backoffice";
import { internalRoutes } from "@/routes/internal";
import { meRoutes } from "@/routes/me";
import { meAssetsRoutes } from "@/routes/me-assets";
import { teamsRoutes } from "@/routes/teams";
import { webhooksRoutes } from "@/routes/webhooks";
import { runProactiveSweep } from "@/scheduled";
import { WorkerJobWorkflow } from "@/workflows/worker-job";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    origin: (origin, c) => {
      const env = c.env as Env;
      const allowed = env.CLIENT_ORIGINS.split(",").map((value) => value.trim());
      return allowed.includes(origin) ? origin : null;
    },
  }),
);

// Safety net for unhandled throws (e.g. the team routes re-throw unexpected
// errors): log + consistent JSON 500 instead of a raw stack. Routes still
// return their own status codes for expected errors; this catches the tail.
app.onError((error, c) => {
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
app.route("/webhooks", webhooksRoutes);

// Agent paths bypass Hono and go to routeAgentRequest, so the Hono CORS
// middleware doesn't cover them. Build the same CORS headers and apply them
// to every response on those paths.
const buildAgentCorsHeaders = (request: Request, env: Env): Headers => {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = env.CLIENT_ORIGINS.split(",").map((value) => value.trim());
  const headers = new Headers();
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS, POST");
  headers.set("Vary", "Origin");
  if (allowed.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
};

// WebSocket upgrades (101) carry a webSocket handle the runtime owns — wrapping
// them in a new Response strips it. Browsers don't apply CORS to WS handshakes
// anyway, so pass those through untouched.
const withAgentCors = (response: Response, agentCors: Headers): Response => {
  if (response.status === 101 || response.webSocket) {
    return response;
  }
  const headers = new Headers(response.headers);
  for (const [name, value] of agentCors) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

// Agent WebSocket/HTTP traffic bypasses Hono: it is gated by the session check,
// then handed to the agents SDK router, which connects the request to the
// CorrespondentAgent DO. Everything else (healthz, CORS preflight) goes to Hono.
export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (new URL(request.url).pathname.startsWith("/agents/")) {
      const agentCors = buildAgentCorsHeaders(request, env);
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: agentCors, status: 204 });
      }
      const session = await validateSession(request, env);
      if (!session) {
        return new Response("Unauthorized", { headers: agentCors, status: 401 });
      }
      // Customer chat surface — non-CUSTOMER roles authenticate but don't
      // connect here. Backoffice routes (P4) will accept OWNER/STAFF.
      if (session.role !== "CUSTOMER") {
        return new Response("Forbidden", { headers: agentCors, status: 403 });
      }
      // Tenant isolation: the DO is keyed by the <companyId> path segment
      // (/agents/<name>/<companyId>), so never trust the path — a CUSTOMER must
      // only reach their OWN company's agent. REST /api/me/* already routes by
      // session.companyId; this closes the same hole on the agent path.
      const pathCompanyId = new URL(request.url).pathname.split("/")[3];
      if (pathCompanyId !== session.companyId) {
        return new Response("Forbidden", { headers: agentCors, status: 403 });
      }
      const routed =
        (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
      return withAgentCors(routed, agentCors);
    }
    return app.fetch(request, env, ctx);
  },
  // Cron trigger (wrangler.jsonc `triggers.crons`) → weekly proactive sweep:
  // the Correspondent suggests next work to active companies with a full brief.
  async scheduled(_controller, env): Promise<void> {
    await runProactiveSweep(env);
  },
} satisfies ExportedHandler<Env>;

export { CorrespondentAgent, PlannerAgent, WorkerAgent, WorkerJobWorkflow };
