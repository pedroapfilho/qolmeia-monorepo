import { prisma as defaultPrisma } from "@repo/db";
import type { ConnectorType, PrismaClient } from "@repo/db";
import { Hono } from "hono";
import type { Logger } from "pino";

import type { AgentDispatcher } from "../../agents/dispatcher";
import { dispatcher as defaultDispatcher } from "../../agents/main-dispatcher";
import { getAdapter as defaultGetAdapter } from "../../connectors/registry";
import type { ConnectorAdapter } from "../../connectors/types";
import { handleInbound } from "../../inbox/pipeline";
import type { PipelineDeps } from "../../inbox/pipeline";
import { logger as defaultLogger } from "../../lib/logger";

type ConnectorRoutesPrisma = Pick<PrismaClient, "connectorInstance"> & PipelineDeps["prisma"];

type ConnectorRoutesDeps = {
  dispatcher?: AgentDispatcher;
  getAdapter?: (type: ConnectorType) => ConnectorAdapter;
  handleInbound?: typeof handleInbound;
  logger?: Logger;
  prisma?: ConnectorRoutesPrisma;
};

// Lowercase URL slug (e.g. "telegram") → ConnectorType enum value (TELEGRAM).
// Hono's path matcher is case-sensitive on the URL fragment but the DB enum
// is uppercase, so we normalise inside the handler.
const KNOWN_CONNECTOR_TYPES: Record<string, ConnectorType> = {
  fresha: "FRESHA",
  google_my_business: "GOOGLE_MY_BUSINESS",
  instagram: "INSTAGRAM",
  telegram: "TELEGRAM",
  web_chat: "WEB_CHAT",
  whatsapp: "WHATSAPP",
};

const buildConnectorRoutes = (deps: ConnectorRoutesDeps = {}): Hono => {
  const prisma = deps.prisma ?? (defaultPrisma as ConnectorRoutesPrisma);
  const logger = deps.logger ?? defaultLogger;
  const dispatcher = deps.dispatcher ?? defaultDispatcher;
  const resolveAdapter = deps.getAdapter ?? defaultGetAdapter;
  const handler = deps.handleInbound ?? handleInbound;

  const app = new Hono();

  // GET /connectors/:type/:connectorInstanceId/webhook
  //
  // Optional verification handshake (WhatsApp-style hub.verify_token, etc.).
  // Adapters that don't need it return 200 OK with an empty body.
  app.get("/:type/:connectorInstanceId/webhook", async (c) => {
    const typeParam = c.req.param("type").toLowerCase();
    const connectorInstanceId = c.req.param("connectorInstanceId");
    const enumType = KNOWN_CONNECTOR_TYPES[typeParam];
    if (!enumType) {
      return c.text("Not Found", 404);
    }

    const connector = await prisma.connectorInstance.findUnique({
      select: { config: true, id: true, type: true },
      where: { id: connectorInstanceId },
    });
    if (!connector || connector.type !== enumType) {
      return c.text("Not Found", 404);
    }

    const adapter = resolveAdapter(enumType);
    if (!adapter.verifyChallenge) {
      // No verification handshake required for this channel (e.g. Telegram).
      return c.text("OK", 200);
    }

    const url = new URL(c.req.url);
    const result = await adapter.verifyChallenge({
      connectorConfig: connector.config,
      query: url.searchParams,
    });
    if (!result.valid) {
      logger.warn({ connectorInstanceId, type: enumType }, "connector verifyChallenge rejected");
      return c.text("Forbidden", 403);
    }
    if (result.challenge !== undefined) {
      return c.text(result.challenge, 200);
    }
    return c.text("OK", 200);
  });

  // POST /connectors/:type/:connectorInstanceId/webhook
  app.post("/:type/:connectorInstanceId/webhook", async (c) => {
    const typeParam = c.req.param("type").toLowerCase();
    const connectorInstanceId = c.req.param("connectorInstanceId");
    const enumType = KNOWN_CONNECTOR_TYPES[typeParam];
    if (!enumType) {
      return c.text("Not Found", 404);
    }

    const connector = await prisma.connectorInstance.findUnique({
      where: { id: connectorInstanceId },
    });
    if (!connector || connector.type !== enumType) {
      return c.text("Not Found", 404);
    }

    const adapter = resolveAdapter(enumType);

    const rawBody = await c.req.text();

    // Signature verification — adapter-specific (Telegram secret token header,
    // WhatsApp HMAC SHA256, etc.). When the adapter omits the hook we
    // accept the request (open mode); adapters can implement an "always
    // false" verifier if they want to mandate signing.
    if (adapter.verifySignature) {
      const ok = await adapter.verifySignature({
        connectorConfig: connector.config,
        headers: c.req.raw.headers,
        rawBody,
      });
      if (!ok) {
        logger.warn({ connectorInstanceId, type: enumType }, "connector verifySignature failed");
        return c.text("Unauthorized", 401);
      }
    }

    let parsedJson: unknown;
    try {
      parsedJson = rawBody.length > 0 ? JSON.parse(rawBody) : {};
    } catch (error) {
      logger.error(
        { connectorInstanceId, error: String(error), type: enumType },
        "connector inbound rejected: invalid JSON body",
      );
      return c.text("Bad Request", 400);
    }

    let normalized;
    try {
      normalized = await adapter.parseInboundPayload(parsedJson, connector.config);
    } catch (error) {
      logger.warn(
        { connectorInstanceId, error: String(error), type: enumType },
        "connector inbound: adapter parse failed (ignored)",
      );
      // Many providers (Telegram, WhatsApp) send non-message updates we don't
      // care about (delivery receipts, status updates). Return 200 so they
      // don't keep retrying.
      return c.text("OK", 200);
    }

    try {
      await handler(
        { dispatcher, prisma },
        {
          connectorInstance: connector,
          normalizedMessage: normalized,
        },
      );
    } catch (error) {
      logger.error(
        { connectorInstanceId, error: String(error), type: enumType },
        "connector inbound dispatch failed",
      );
    }
    return c.text("OK", 200);
  });

  return app;
};

const connectorRoutes = buildConnectorRoutes();

export { buildConnectorRoutes, connectorRoutes };
export type { ConnectorRoutesDeps };
