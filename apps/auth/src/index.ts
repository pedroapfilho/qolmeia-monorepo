import { serve } from "@hono/node-server";
import { createRoute, z } from "@hono/zod-openapi";
import { prisma } from "@repo/db";
import { createMarkdownFromOpenApi } from "@scalar/openapi-to-markdown";
import { compress } from "hono/compress";
import { cors } from "hono/cors";

import { env } from "./lib/env";
import { logger } from "./lib/logger";
import { createOpenAPIApp } from "./lib/openapi";
import { errorHandler, notFound } from "./middleware/error-handler";
import {
  apiRateLimit,
  requestId,
  requestSizeLimit,
  securityHeaders,
  standardRateLimit,
} from "./middleware/security";
import { authRoutes } from "./routes/auth";
import { buildV1Routes } from "./routes/v1";

const app = createOpenAPIApp();

app.use("*", requestId);
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

app.use("*", async (c, next) => {
  if (c.req.path === "/healthz") {
    return next();
  }

  const start = Date.now();
  try {
    return await next();
  } finally {
    logger.info({
      duration: Date.now() - start,
      method: c.req.method,
      status: c.res.status,
      url: c.req.url,
    });
  }
});

app.use("/api/*", standardRateLimit);
app.use("/api/v1/*", apiRateLimit);
// Better Auth's basePath is "/api/auth"; mounting authRoutes at "/api" wires
// the full sign-in/sign-up/get-session surface.
app.route("/api", authRoutes);
// /api/v1 — slim post-cutover surface: /me + /orgs (the org-create relay).
app.route("/api/v1", buildV1Routes());

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
    await prisma.$queryRaw`SELECT 1`;

    return c.json(
      {
        checks: { database: "healthy" as const },
        status: "ready" as const,
        timestamp: new Date().toISOString(),
      },
      200,
    );
  } catch (error) {
    logger.error({ error }, "Readiness check failed");
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

logger.info(
  {
    env: env.NODE_ENV,
    hostname,
    port,
  },
  "🚀 Starting auth service...",
);

serve({
  fetch: app.fetch,
  hostname,
  port,
});

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
});
