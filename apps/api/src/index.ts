import "dotenv/config";

import { serve } from "@hono/node-server";
import { createRoute, z } from "@hono/zod-openapi";
import { prisma } from "@repo/db";
import { createMarkdownFromOpenApi } from "@scalar/openapi-to-markdown";
import { compress } from "hono/compress";
import { cors } from "hono/cors";

import { syncSkills } from "./agents/skills/registry";
import { syncTemplates } from "./agents/templates/registry";
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
import { connectorsTelegramRoutes } from "./routes/connectors/telegram";
import { connectorsWhatsAppRoutes } from "./routes/connectors/whatsapp";
import { buildV1Routes } from "./routes/v1";

const app = createOpenAPIApp();

app.use("*", requestId);
app.use("*", compress());
app.use("*", requestSizeLimit());
app.use("*", securityHeaders);
// CORS — Better Auth cookies require `credentials: include` from the browser,
// which forbids the wildcard `*` origin. When CORS_ORIGINS is "*" we keep the
// permissive setup for non-credentialed callers (Telegram webhook, internal
// probes); otherwise the configured origins get credentials echoed back so
// the backoffice + client apps can hit /api/auth/* with cookies.
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

// Skip logging for health checks
app.use("*", async (c, next) => {
  if (c.req.path === "/healthz") {
    return next();
  }

  const start = Date.now();
  await next();
  const ms = Date.now() - start;

  logger.info({
    duration: ms,
    method: c.req.method,
    status: c.res.status,
    url: c.req.url,
  });
});

app.use("/api/*", standardRateLimit);
app.use("/api/v1/*", apiRateLimit);
// Better Auth's basePath is "/api/auth"; mounting authRoutes at "/api" wires
// `POST /api/auth/sign-in/email`, `POST /api/auth/sign-up/email`,
// `POST /api/auth/sign-in/magic-link`, `GET /api/auth/get-session`, etc.
app.route("/api", authRoutes);
// Backoffice REST surface — every route here is gated by requireStaff,
// configured inside buildV1Routes() so the guard is mounted exactly once
// at the route group level (not via a separate `app.use(..., requireStaff)`).
app.route("/api/v1", buildV1Routes());
app.route("/connectors", connectorsTelegramRoutes);
app.route("/connectors", connectorsWhatsAppRoutes);

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
      description: "API is healthy",
    },
  },
  summary: "Liveness check",
  tags: ["System"],
});

app.openapi(healthRoute, (c) =>
  c.json(
    {
      service: "api",
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
      description: "API is ready to serve traffic",
    },
    503: {
      content: { "application/json": { schema: readyzResponseSchema } },
      description: "API is not ready (e.g. database unreachable)",
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
  info: { title: "Qolmeia API", version: "v1" },
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
  "🚀 Starting server...",
);

await syncSkills(prisma);
await syncTemplates(prisma);
logger.info("Skill and template registries synced.");

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
