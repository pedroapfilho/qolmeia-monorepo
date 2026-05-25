import { routeAgentRequest } from "agents";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { CorrespondentAgent } from "@/agents/correspondent";
import { validateSession } from "@/lib/auth";

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

// Agent WebSocket/HTTP traffic bypasses Hono: it is gated by the session check,
// then handed to the agents SDK router, which connects the request to the
// CorrespondentAgent DO. Everything else (healthz, CORS preflight) goes to Hono.
export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (new URL(request.url).pathname.startsWith("/agents/")) {
      const session = await validateSession(request, env);
      if (!session) {
        return new Response("Unauthorized", { status: 401 });
      }
      const routed = await routeAgentRequest(request, env);
      return routed ?? new Response("Not found", { status: 404 });
    }
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

export { CorrespondentAgent };
