import crypto from "node:crypto";

import { prisma as defaultPrisma } from "@repo/db";
import type { PrismaClient } from "@repo/db";
import { Hono } from "hono";
import type { Logger } from "pino";

import { getAdapter } from "../../connectors/registry";
import type { ConnectorAdapter } from "../../connectors/types";
import { logger as defaultLogger } from "../../lib/logger";

// Subset of the Prisma client the route depends on. Lets tests inject a
// minimal mock instead of standing up a real database.
type WhatsAppRoutePrisma = Pick<PrismaClient, "connectorInstance">;

type WhatsAppRouteDeps = {
  getAdapter?: (type: "WHATSAPP") => ConnectorAdapter;
  logger?: Logger;
  prisma?: WhatsAppRoutePrisma;
};

type WhatsAppConnectorConfig = {
  accessToken?: string;
  // Meta App Secret used to verify the X-Hub-Signature-256 header. Optional
  // for v0 — skipping signature verification when absent matches Meta's setup
  // flow where operators can register the webhook before pasting the secret.
  appSecret?: string;
  phoneNumberId?: string;
  verifyToken?: string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readConfig = (raw: unknown): WhatsAppConnectorConfig => {
  if (!isObject(raw)) {
    return {};
  }
  const config: WhatsAppConnectorConfig = {};
  if (typeof raw.accessToken === "string") {
    config.accessToken = raw.accessToken;
  }
  if (typeof raw.appSecret === "string") {
    config.appSecret = raw.appSecret;
  }
  if (typeof raw.phoneNumberId === "string") {
    config.phoneNumberId = raw.phoneNumberId;
  }
  if (typeof raw.verifyToken === "string") {
    config.verifyToken = raw.verifyToken;
  }
  return config;
};

// Constant-time signature comparison so we don't leak hash bytes via timing.
const verifyMetaSignature = ({
  appSecret,
  rawBody,
  signatureHeader,
}: {
  appSecret: string;
  rawBody: string;
  signatureHeader: string;
}): boolean => {
  // Meta sends "sha256=<hex>"; strip the prefix before comparing.
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) {
    return false;
  }
  const provided = signatureHeader.slice(prefix.length);
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  if (provided.length !== expected.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
};

const buildWhatsAppRoutes = (deps: WhatsAppRouteDeps = {}): Hono => {
  const prisma = deps.prisma ?? defaultPrisma;
  const logger = deps.logger ?? defaultLogger;
  const resolveAdapter = deps.getAdapter ?? getAdapter;

  const app = new Hono();

  // GET /connectors/whatsapp/:connectorInstanceId/webhook
  //
  // Meta's webhook verification handshake. The dashboard hits this URL with
  // hub.mode=subscribe + hub.verify_token + hub.challenge; we echo back the
  // challenge when the verify token matches the ConnectorInstance config.
  app.get("/whatsapp/:connectorInstanceId/webhook", async (c) => {
    const connectorInstanceId = c.req.param("connectorInstanceId");
    const mode = c.req.query("hub.mode");
    const verifyToken = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge");

    if (mode !== "subscribe" || !verifyToken || !challenge) {
      return c.text("Bad Request", 400);
    }

    const connector = await prisma.connectorInstance.findUnique({
      select: { config: true, id: true, type: true },
      where: { id: connectorInstanceId },
    });

    if (!connector || connector.type !== "WHATSAPP") {
      return c.text("Not Found", 404);
    }

    const config = readConfig(connector.config);
    if (!config.verifyToken || config.verifyToken !== verifyToken) {
      logger.warn({ connectorInstanceId }, "WhatsApp verify failed: verify_token mismatch");
      return c.text("Forbidden", 403);
    }

    return c.text(challenge, 200);
  });

  // POST /connectors/whatsapp/:connectorInstanceId/webhook
  //
  // Message receipt. For v0 we parse the payload and log the resulting
  // NormalizedMessage. The agent pipeline is NOT invoked yet — that's
  // Phase 6+ work to unify inbound dispatch through ConnectorAdapter.
  app.post("/whatsapp/:connectorInstanceId/webhook", async (c) => {
    const connectorInstanceId = c.req.param("connectorInstanceId");

    const connector = await prisma.connectorInstance.findUnique({
      select: { config: true, id: true, orgId: true, type: true },
      where: { id: connectorInstanceId },
    });

    if (!connector || connector.type !== "WHATSAPP") {
      return c.text("Not Found", 404);
    }

    const config = readConfig(connector.config);
    const rawBody = await c.req.text();
    const signatureHeader = c.req.header("x-hub-signature-256");

    if (config.appSecret) {
      if (!signatureHeader) {
        logger.warn(
          { connectorInstanceId },
          "WhatsApp inbound rejected: missing X-Hub-Signature-256",
        );
        return c.text("Unauthorized", 401);
      }
      const ok = verifyMetaSignature({
        appSecret: config.appSecret,
        rawBody,
        signatureHeader,
      });
      if (!ok) {
        logger.warn({ connectorInstanceId }, "WhatsApp inbound rejected: signature mismatch");
        return c.text("Unauthorized", 401);
      }
    } else {
      logger.warn(
        { connectorInstanceId },
        "WhatsApp inbound accepted without signature verification (appSecret not configured)",
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = rawBody.length > 0 ? JSON.parse(rawBody) : {};
    } catch (error) {
      logger.error(
        { connectorInstanceId, error: String(error) },
        "WhatsApp inbound rejected: invalid JSON body",
      );
      return c.text("Bad Request", 400);
    }

    const adapter = resolveAdapter("WHATSAPP");
    try {
      const normalized = await adapter.parseInboundPayload(parsedJson, config);
      // TODO(phase-6+): wire NormalizedMessage into inbox/pipeline once the
      // ChatSDK-vs-adapter unification lands. For now we only log so the
      // operator can confirm the webhook reaches us with parseable payloads.
      logger.info(
        {
          connectorInstanceId,
          message: {
            attachmentCount: normalized.attachments.length,
            authorDisplayName: normalized.authorDisplayName,
            externalId: normalized.externalId,
            externalThreadId: normalized.externalThreadId,
            hasText: normalized.text !== null,
            rawTimestamp: normalized.rawTimestamp,
          },
          orgId: connector.orgId,
        },
        "WhatsApp inbound parsed (not dispatched — Phase 6+)",
      );
      return c.text("OK", 200);
    } catch (error) {
      logger.error({ connectorInstanceId, error: String(error) }, "WhatsApp inbound parse failed");
      return c.text("Bad Request", 400);
    }
  });

  return app;
};

const connectorsWhatsAppRoutes = buildWhatsAppRoutes();

export type { WhatsAppConnectorConfig, WhatsAppRouteDeps };
export { buildWhatsAppRoutes, connectorsWhatsAppRoutes };
