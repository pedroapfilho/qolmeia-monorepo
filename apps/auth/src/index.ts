import { serve } from "@hono/node-server";
import { createRoute, z } from "@hono/zod-openapi";
import { db } from "@repo/db";
import { createIdentify } from "@repo/observability/auth";
import { honoEvlog, initApiLogger } from "@repo/observability/hono";
import { createMarkdownFromOpenApi } from "@scalar/openapi-to-markdown";
import { sql } from "drizzle-orm";
import { compress } from "hono/compress";
import { cors } from "hono/cors";

import { auth } from "./lib/auth";
import { env } from "./lib/env";
import { log } from "./lib/logger";
import { createOpenAPIApp } from "./lib/openapi";
import { errorHandler, notFound } from "./middleware/error-handler";
import {
  apiRateLimit,
  requestId,
  requestSizeLimit,
  securityHeaders,
  standardRateLimit,
} from "./middleware/security";
import { buildApiRoutes } from "./routes/api";
import { authRoutes } from "./routes/auth";

initApiLogger({ service: "auth" });

const app = createOpenAPIApp();

const identify = createIdentify(auth);

app.use("*", requestId);
app.use("*", honoEvlog());
app.use("*", async (c, next) => {
  await identify(c.get("log"), c.req.raw.headers, c.req.path);
  return next();
});
app.use("*", compress());
app.use("*", requestSizeLimit());
app.use("*", securityHeaders);

const corsOrigins = env.CORS_ORIGINS.split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

app.use(
  "*",
  cors({
    allowHeaders: ["Content-Type", "X-Request-Id", "Cookie", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: corsOrigins.length > 0 && corsOrigins[0] !== "*",
    exposeHeaders: ["Set-Cookie", "X-Request-Id"],
    origin: corsOrigins.length > 0 ? corsOrigins : "*",
  }),
);

app.use("/api/*", standardRateLimit);
// Stricter per-IP limit on our own endpoints (not Better Auth's /api/auth/*).
app.use("/api/me", apiRateLimit);
app.use("/api/orgs", apiRateLimit);
// Better Auth's basePath is "/api/auth"; mounting authRoutes at "/api" wires
// the full sign-in/sign-up/get-session surface.
app.route("/api", authRoutes);
// Our slim API surface: /me + /orgs (the org-create relay).
app.route("/api", buildApiRoutes());

const healthRoute = createRoute({
  description: "Liveness probe — does not touch the database.",
  method: "get",
  path: "/healthz",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            service: z.string(),
            status: z.literal("healthy"),
            timestamp: z.iso.datetime(),
            version: z.string(),
          }),
        },
      },
      description: "Auth service is healthy",
    },
  },
  summary: "Liveness check",
  tags: ["System"],
});

app.openapi(healthRoute, (c) =>
  c.json(
    {
      service: "auth",
      status: "healthy" as const,
      timestamp: new Date().toISOString(),
      version: "1.0.0",
    },
    200,
  ),
);

const readyzResponseSchema = z.object({
  checks: z.object({ database: z.enum(["healthy", "unhealthy"]) }),
  status: z.enum(["ready", "not ready"]),
  timestamp: z.iso.datetime(),
});

const readyzRoute = createRoute({
  description: "Readiness probe — verifies the database is reachable.",
  method: "get",
  path: "/readyz",
  responses: {
    200: {
      content: { "application/json": { schema: readyzResponseSchema } },
      description: "Auth service is ready to serve traffic",
    },
    503: {
      content: { "application/json": { schema: readyzResponseSchema } },
      description: "Auth service is not ready (e.g. database unreachable)",
    },
  },
  summary: "Readiness check",
  tags: ["System"],
});

app.openapi(readyzRoute, async (c) => {
  try {
    await db.execute(sql`SELECT 1`);

    return c.json(
      {
        checks: { database: "healthy" as const },
        status: "ready" as const,
        timestamp: new Date().toISOString(),
      },
      200,
    );
  } catch (error) {
    c.get("log").error("Readiness check failed", { error });
    return c.json(
      {
        checks: { database: "unhealthy" as const },
        status: "not ready" as const,
        timestamp: new Date().toISOString(),
      },
      503,
    );
  }
});

const openApiContent = app.getOpenAPI31Document({
  info: { title: "Qolmeia Auth", version: "v1" },
  openapi: "3.1.0",
});

const llmsMarkdown = await createMarkdownFromOpenApi(JSON.stringify(openApiContent));

app.get("/llms.txt", (c) => c.text(llmsMarkdown));

app.notFound(notFound);

app.onError(errorHandler);

const port = Number(env.PORT);
const hostname = env.HOST;

log.info({
  env: env.NODE_ENV,
  hostname,
  message: "🚀 Starting auth service...",
  port,
});

serve({
  fetch: app.fetch,
  hostname,
  port,
});

process.on("SIGTERM", () => {
  log.info("server", "SIGTERM received, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  log.info("server", "SIGINT received, shutting down gracefully...");
  process.exit(0);
});
