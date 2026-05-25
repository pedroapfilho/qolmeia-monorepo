import { routeAgentRequest } from "agents";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { CorrespondentAgent } from "@/agents/correspondent";
import { PlannerAgent } from "@/agents/planner";
import { WorkerAgent } from "@/agents/worker";
import { validateSession } from "@/lib/auth";
import { assetsRoutes } from "@/routes/assets";
import { backofficeRoutes } from "@/routes/backoffice";
import { meRoutes } from "@/routes/me";
import { teamsRoutes } from "@/routes/teams";
import { WorkerJobWorkflow } from "@/workflows/worker-job";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    credentials: true,
    origin: (origin, c) => {
      const env = c.env as Env;
      const allowed = env.CLIENT_ORIGINS.split(",").map((value) => value.trim());
      return allowed.includes(origin) ? origin : null;
    },
  }),
);

app.get("/healthz", (c) => c.json({ status: "ok" }));
app.route("/api/backoffice", backofficeRoutes);
app.route("/api/me", meRoutes);
app.route("/api/teams", teamsRoutes);
app.route("/assets", assetsRoutes);

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
      const routed =
        (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
      return withAgentCors(routed, agentCors);
    }
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

export { CorrespondentAgent, PlannerAgent, WorkerAgent, WorkerJobWorkflow };
