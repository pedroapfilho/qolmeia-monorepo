import crypto from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { ConnectorAdapter, NormalizedMessage } from "../../connectors/types";

import { buildWhatsAppRoutes } from "./whatsapp";

type LoggerSpies = {
  error: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
};

type ConnectorRow = {
  config: unknown;
  id: string;
  orgId: string;
  type: "WHATSAPP" | "TELEGRAM" | "FRESHA" | "GOOGLE_MY_BUSINESS" | "INSTAGRAM";
};

const buildLogger = (): LoggerSpies => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
});

const buildPrisma = (connector: ConnectorRow | null) => ({
  connectorInstance: {
    findUnique: vi.fn().mockResolvedValue(connector),
  },
});

const buildAdapter = (overrides: Partial<ConnectorAdapter> = {}): ConnectorAdapter => ({
  capabilities: { inbound: true, outbound: false },
  parseInboundPayload: vi.fn(),
  sendOutbound: vi.fn(),
  type: "WHATSAPP",
  validateConfig: vi.fn().mockReturnValue({ valid: true }),
  ...overrides,
});

const buildApp = (opts: {
  adapter?: ConnectorAdapter;
  connector?: ConnectorRow | null;
  logger?: LoggerSpies;
}) => {
  const logger = opts.logger ?? buildLogger();
  const prisma = buildPrisma(opts.connector ?? null);
  const adapter = opts.adapter ?? buildAdapter();
  const app = buildWhatsAppRoutes({
    getAdapter: () => adapter,
    logger: logger as never,
    prisma: prisma as never,
  });
  return { adapter, app, logger, prisma };
};

const baseConnector: ConnectorRow = {
  config: { accessToken: "EAAGm0...", phoneNumberId: "pn_1", verifyToken: "verify_secret" },
  id: "ci_whatsapp_1",
  orgId: "org_1",
  type: "WHATSAPP",
};

const samplePayload = {
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            contacts: [{ profile: { name: "Maria" }, wa_id: "5511999999999" }],
            messages: [
              {
                from: "5511999999999",
                id: "wamid.abc123",
                text: { body: "oi" },
                timestamp: "1716220800",
                type: "text",
              },
            ],
          },
        },
      ],
      id: "entry_1",
    },
  ],
  object: "whatsapp_business_account",
};

const sampleNormalized: NormalizedMessage = {
  attachments: [],
  authorDisplayName: "Maria",
  externalId: "wamid.abc123",
  externalThreadId: "5511999999999",
  rawTimestamp: 1_716_220_800_000,
  text: "oi",
};

describe("GET /connectors/whatsapp/:id/webhook (verification)", () => {
  it("returns 200 + challenge body when verify_token matches", async () => {
    const { app } = buildApp({ connector: baseConnector });
    const res = await app.request(
      "/whatsapp/ci_whatsapp_1/webhook?hub.mode=subscribe&hub.verify_token=verify_secret&hub.challenge=12345",
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("12345");
  });

  it("returns 403 when verify_token mismatches", async () => {
    const { app, logger } = buildApp({ connector: baseConnector });
    const res = await app.request(
      "/whatsapp/ci_whatsapp_1/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345",
    );
    expect(res.status).toBe(403);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("returns 400 when required query params are missing", async () => {
    const { app } = buildApp({ connector: baseConnector });
    const res = await app.request("/whatsapp/ci_whatsapp_1/webhook?hub.mode=subscribe");
    expect(res.status).toBe(400);
  });

  it("returns 404 when the ConnectorInstance is unknown", async () => {
    const { app } = buildApp({ connector: null });
    const res = await app.request(
      "/whatsapp/ci_missing/webhook?hub.mode=subscribe&hub.verify_token=verify_secret&hub.challenge=12345",
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when the ConnectorInstance is the wrong type", async () => {
    const { app } = buildApp({
      connector: { ...baseConnector, type: "TELEGRAM" },
    });
    const res = await app.request(
      "/whatsapp/ci_whatsapp_1/webhook?hub.mode=subscribe&hub.verify_token=verify_secret&hub.challenge=12345",
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /connectors/whatsapp/:id/webhook (inbound)", () => {
  it("parses the payload and logs the NormalizedMessage (no appSecret → lenient v0)", async () => {
    const parseInboundPayload = vi.fn().mockResolvedValue(sampleNormalized);
    const adapter = buildAdapter({ parseInboundPayload });
    const { app, logger } = buildApp({ adapter, connector: baseConnector });

    const res = await app.request("/whatsapp/ci_whatsapp_1/webhook", {
      body: JSON.stringify(samplePayload),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(res.status).toBe(200);
    expect(parseInboundPayload).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ connectorInstanceId: "ci_whatsapp_1" }),
      expect.stringMatching(/appSecret not configured/v),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorInstanceId: "ci_whatsapp_1",
        message: expect.objectContaining({ externalId: "wamid.abc123" }),
      }),
      expect.stringMatching(/parsed/v),
    );
  });

  it("returns 400 + logs an error when the adapter throws", async () => {
    const parseInboundPayload = vi.fn().mockRejectedValue(new Error("invalid payload shape"));
    const adapter = buildAdapter({ parseInboundPayload });
    const { app, logger } = buildApp({ adapter, connector: baseConnector });

    const res = await app.request("/whatsapp/ci_whatsapp_1/webhook", {
      body: JSON.stringify({ object: "page" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(res.status).toBe(400);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ connectorInstanceId: "ci_whatsapp_1" }),
      expect.stringMatching(/parse failed/v),
    );
  });

  it("returns 404 when the ConnectorInstance is unknown", async () => {
    const { app } = buildApp({ connector: null });
    const res = await app.request("/whatsapp/ci_missing/webhook", {
      body: JSON.stringify(samplePayload),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const { app, logger } = buildApp({ connector: baseConnector });
    const res = await app.request("/whatsapp/ci_whatsapp_1/webhook", {
      body: "not json",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(400);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ connectorInstanceId: "ci_whatsapp_1" }),
      expect.stringMatching(/invalid JSON/v),
    );
  });

  it("returns 401 when appSecret is configured and the signature is missing", async () => {
    const connector: ConnectorRow = {
      ...baseConnector,
      config: { ...(baseConnector.config as object), appSecret: "shhh" },
    };
    const adapter = buildAdapter({
      parseInboundPayload: vi.fn().mockResolvedValue(sampleNormalized),
    });
    const { app, logger } = buildApp({ adapter, connector });
    const res = await app.request("/whatsapp/ci_whatsapp_1/webhook", {
      body: JSON.stringify(samplePayload),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(401);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ connectorInstanceId: "ci_whatsapp_1" }),
      expect.stringMatching(/missing X-Hub-Signature-256/v),
    );
  });

  it("returns 401 when appSecret is configured and the signature mismatches", async () => {
    const connector: ConnectorRow = {
      ...baseConnector,
      config: { ...(baseConnector.config as object), appSecret: "shhh" },
    };
    const adapter = buildAdapter({
      parseInboundPayload: vi.fn().mockResolvedValue(sampleNormalized),
    });
    const { app, logger } = buildApp({ adapter, connector });
    const res = await app.request("/whatsapp/ci_whatsapp_1/webhook", {
      body: JSON.stringify(samplePayload),
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=deadbeef",
      },
      method: "POST",
    });
    expect(res.status).toBe(401);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ connectorInstanceId: "ci_whatsapp_1" }),
      expect.stringMatching(/signature mismatch/v),
    );
  });

  it("accepts the request when appSecret is configured and the signature matches", async () => {
    const appSecret = "shhh";
    const body = JSON.stringify(samplePayload);
    const signature = `sha256=${crypto.createHmac("sha256", appSecret).update(body).digest("hex")}`;
    const connector: ConnectorRow = {
      ...baseConnector,
      config: { ...(baseConnector.config as object), appSecret },
    };
    const adapter = buildAdapter({
      parseInboundPayload: vi.fn().mockResolvedValue(sampleNormalized),
    });
    const { app, logger } = buildApp({ adapter, connector });
    const res = await app.request("/whatsapp/ci_whatsapp_1/webhook", {
      body,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
      },
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(logger.info).toHaveBeenCalled();
  });
});
