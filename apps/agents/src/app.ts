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

// Register OpenRouter as a model provider (model strings are `openrouter/<model>`;
// the wire protocol + baseUrl come from pi-ai's catalog). The API key isn't set
// here: on Cloudflare it can't be read at module load (bindings are per-request),
// so the harness supplies it per-call from env.OPENROUTER_API_KEY.
registerProvider("openrouter", {});

// Flue's HTTP entry, discovered as `app.ts` in the source root: the REST surface
// plus Flue's agent/workflow/run routes (`flue()`, mounted last so REST routes
// match first). Per-agent auth (session + CUSTOMER + tenant) lives in each
// agent's `route` export. This is the app `flue build` deploys and the one
// `index.ts` wraps for vitest/wrangler — one composition, no drift.
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

// Safety net for unhandled throws: log + consistent JSON 500 instead of a raw
// stack. Routes still return their own status codes for expected errors.
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
