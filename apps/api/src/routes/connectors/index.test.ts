import { describe, expect, it, vi } from "vitest";

import type { ConnectorAdapter, NormalizedMessage } from "../../connectors/types";

import { buildConnectorRoutes } from "./index";

const buildLogger = () => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
});

const buildAdapter = (overrides: Partial<ConnectorAdapter> = {}): ConnectorAdapter => ({
  capabilities: { inbound: true, outbound: true },
  parseInboundPayload: vi.fn(),
  sendOutbound: vi.fn(),
  type: "TELEGRAM",
  validateConfig: vi.fn().mockReturnValue({ valid: true }),
  ...overrides,
});

const sampleNormalized: NormalizedMessage = {
  attachments: [],
  authorDisplayName: "Maria",
  externalId: "msg_1",
  externalThreadId: "thread_1",
  rawTimestamp: 1_716_220_800_000,
  text: "olá",
};

const buildApp = (
  opts: {
    adapter?: ConnectorAdapter;
    connector?: { config: unknown; id: string; type: string } | null;
    handleInbound?: ReturnType<typeof vi.fn>;
  } = {},
) => {
  const logger = buildLogger();
  const handleInbound = opts.handleInbound ?? vi.fn().mockResolvedValue(undefined);
  const adapter = opts.adapter ?? buildAdapter();
  const dispatcher = { enqueueAndAwait: vi.fn() } as never;
  const prisma = {
    connectorInstance: {
      findUnique: vi.fn().mockResolvedValue(opts.connector ?? null),
    },
  } as never;
  const app = buildConnectorRoutes({
    dispatcher,
    getAdapter: () => adapter,
    handleInbound: handleInbound as never,
    logger: logger as never,
    prisma,
  });
  return { adapter, app, handleInbound, logger, prisma };
};

describe("GET /connectors/:type/:id/webhook", () => {
  it("returns 200 OK for channels without a verifyChallenge hook (e.g. Telegram)", async () => {
    const { app } = buildApp({
      connector: { config: {}, id: "ci_1", type: "TELEGRAM" },
    });
    const res = await app.request("/telegram/ci_1/webhook");
    expect(res.status).toBe(200);
  });

  it("calls adapter.verifyChallenge when present and echoes the challenge on success", async () => {
    const verifyChallenge = vi.fn().mockResolvedValue({ challenge: "abc", valid: true });
    const adapter = buildAdapter({ type: "WHATSAPP", verifyChallenge });
    const { app } = buildApp({
      adapter,
      connector: { config: { verifyToken: "v" }, id: "ci_w", type: "WHATSAPP" },
    });
    const res = await app.request(
      "/whatsapp/ci_w/webhook?hub.mode=subscribe&hub.verify_token=v&hub.challenge=abc",
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("abc");
    expect(verifyChallenge).toHaveBeenCalled();
  });

  it("returns 403 when adapter.verifyChallenge reports invalid", async () => {
    const verifyChallenge = vi.fn().mockResolvedValue({ valid: false });
    const adapter = buildAdapter({ type: "WHATSAPP", verifyChallenge });
    const { app, logger } = buildApp({
      adapter,
      connector: { config: {}, id: "ci_w", type: "WHATSAPP" },
    });
    const res = await app.request("/whatsapp/ci_w/webhook?hub.mode=subscribe");
    expect(res.status).toBe(403);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("returns 404 when the type slug is unknown", async () => {
    const { app } = buildApp();
    const res = await app.request("/martian/ci_1/webhook");
    expect(res.status).toBe(404);
  });

  it("returns 404 when the ConnectorInstance is unknown", async () => {
    const { app } = buildApp({ connector: null });
    const res = await app.request("/telegram/ci_missing/webhook");
    expect(res.status).toBe(404);
  });

  it("returns 404 when the ConnectorInstance type does not match the URL", async () => {
    const { app } = buildApp({
      connector: { config: {}, id: "ci_1", type: "WHATSAPP" },
    });
    const res = await app.request("/telegram/ci_1/webhook");
    expect(res.status).toBe(404);
  });
});

describe("POST /connectors/:type/:id/webhook", () => {
  it("normalises the payload and dispatches via the pipeline", async () => {
    const parseInboundPayload = vi.fn().mockResolvedValue(sampleNormalized);
    const adapter = buildAdapter({ parseInboundPayload });
    const handleInbound = vi.fn().mockResolvedValue(undefined);
    const { app } = buildApp({
      adapter,
      connector: { config: { botToken: "BOT", secretToken: "s" }, id: "ci_1", type: "TELEGRAM" },
      handleInbound,
    });

    const res = await app.request("/telegram/ci_1/webhook", {
      body: JSON.stringify({ update_id: 1 }),
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "s",
      },
      method: "POST",
    });

    expect(res.status).toBe(200);
    expect(parseInboundPayload).toHaveBeenCalledOnce();
    expect(handleInbound).toHaveBeenCalledOnce();
    const call = handleInbound.mock.calls[0]![1] as {
      connectorInstance: { id: string };
      normalizedMessage: NormalizedMessage;
    };
    expect(call.connectorInstance.id).toBe("ci_1");
    expect(call.normalizedMessage.externalId).toBe("msg_1");
  });

  it("returns 401 when verifySignature fails", async () => {
    const verifySignature = vi.fn().mockResolvedValue(false);
    const adapter = buildAdapter({ verifySignature });
    const handleInbound = vi.fn();
    const { app, logger } = buildApp({
      adapter,
      connector: { config: { secretToken: "s" }, id: "ci_1", type: "TELEGRAM" },
      handleInbound,
    });

    const res = await app.request("/telegram/ci_1/webhook", {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(401);
    expect(handleInbound).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("returns 200 OK and skips dispatch when the adapter cannot parse the payload (e.g. delivery receipts)", async () => {
    const parseInboundPayload = vi.fn().mockRejectedValue(new Error("no parseable message"));
    const adapter = buildAdapter({ parseInboundPayload });
    const handleInbound = vi.fn();
    const { app, logger } = buildApp({
      adapter,
      connector: { config: {}, id: "ci_1", type: "TELEGRAM" },
      handleInbound,
    });

    const res = await app.request("/telegram/ci_1/webhook", {
      body: JSON.stringify({ update_id: 1 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(handleInbound).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const adapter = buildAdapter();
    const { app, logger } = buildApp({
      adapter,
      connector: { config: {}, id: "ci_1", type: "TELEGRAM" },
    });
    const res = await app.request("/telegram/ci_1/webhook", {
      body: "not json",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(400);
    expect(logger.error).toHaveBeenCalled();
  });

  it("returns 404 for unknown type slugs", async () => {
    const { app } = buildApp();
    const res = await app.request("/martian/ci_1/webhook", {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the ConnectorInstance type does not match the URL", async () => {
    const { app } = buildApp({
      connector: { config: {}, id: "ci_1", type: "WHATSAPP" },
    });
    const res = await app.request("/telegram/ci_1/webhook", {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("still returns 200 OK when the pipeline throws (errors logged, not surfaced to the provider)", async () => {
    const parseInboundPayload = vi.fn().mockResolvedValue(sampleNormalized);
    const adapter = buildAdapter({ parseInboundPayload });
    const handleInbound = vi.fn().mockRejectedValue(new Error("boom"));
    const { app, logger } = buildApp({
      adapter,
      connector: { config: {}, id: "ci_1", type: "TELEGRAM" },
      handleInbound,
    });

    const res = await app.request("/telegram/ci_1/webhook", {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(logger.error).toHaveBeenCalled();
  });
});
