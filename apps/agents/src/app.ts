import { Hono } from "hono";
import { cors } from "hono/cors";

import { logError } from "#/lib/logger";
import { assetsRoutes } from "#/routes/assets";
import { backofficeRoutes } from "#/routes/backoffice";
import { internalRoutes } from "#/routes/internal";
import { meRoutes } from "#/routes/me";
import { meAssetsRoutes } from "#/routes/me-assets";
import { teamsRoutes } from "#/routes/teams";
import { webhooksRoutes } from "#/routes/webhooks";

// The REST/webhook surface as a Hono app factory. Shared by the Flue worker
// entry (.flue/app.ts, which also mounts the agent routes via `flue()`) and the
// vitest/wrangler entry (src/index.ts). Each caller gets its own instance so
// mounting `flue()` on one doesn't affect the other.
const createRestApp = (): Hono<{ Bindings: Env }> => {
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
  app.route("/webhooks", webhooksRoutes);

  return app;
};

export { createRestApp };
