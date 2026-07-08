import { registerProvider } from "@flue/runtime";
import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { logError } from "#/lib/logger";
import { assetsRoutes } from "#/routes/assets";
import { backofficeRoutes } from "#/routes/backoffice";
import { internalRoutes } from "#/routes/internal";
import { meRoutes } from "#/routes/me";
import { meAssetsRoutes } from "#/routes/me-assets";
import { teamsRoutes } from "#/routes/teams";

registerProvider("openrouter", {});

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

// Proxies with response compression (e.g. the Next dev rewrite) buffer SSE
// indefinitely when they gzip it; `no-transform` tells them to pass it through.
app.use("*", async (c, next) => {
  // oxlint-disable-next-line callback-return -- Hono after-middleware: headers are set post-next()
  await next();
  if (c.res.headers.get("content-type")?.startsWith("text/event-stream")) {
    c.res.headers.set("cache-control", "no-cache, no-transform");
  }
});

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
app.route("/", flue());

export default app;
