import { describe, expect, it, vi } from "vitest";

import { buildAdapter } from "./adapter";

const buildPrismaMock = () => ({
  message: {
    create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        content: data.content as string,
        createdAt: new Date("2026-05-21T00:00:00.000Z"),
        id: "msg_generated",
        metadata: data.metadata ?? {},
      }),
    ),
  },
});

const buildBusMock = () => ({
  publish: vi.fn(),
});

describe("webChatAdapter.parseInboundPayload", () => {
  it("parses a text message and mints an externalId", async () => {
    const adapter = buildAdapter({ uuid: () => "uuid-xyz" });
    const result = await adapter.parseInboundPayload({ conversationId: "conv_1", text: "olá" }, {});

    expect(result.text).toBe("olá");
    expect(result.externalThreadId).toBe("conv_1");
    expect(result.externalId).toBe("uuid-xyz");
    expect(result.attachments).toEqual([]);
    expect(result.authorDisplayName).toBeNull();
    expect(typeof result.rawTimestamp).toBe("number");
  });

  it("includes attachments and authorDisplayName when provided", async () => {
    const adapter = buildAdapter({ uuid: () => "uuid-2" });
    const result = await adapter.parseInboundPayload(
      {
        attachments: [{ kind: "image", mimeType: "image/png", sizeBytes: 100 }],
        authorDisplayName: "Maria",
        conversationId: "conv_a",
        text: null,
      },
      {},
    );

    expect(result.attachments).toEqual([{ kind: "image", mimeType: "image/png", sizeBytes: 100 }]);
    expect(result.authorDisplayName).toBe("Maria");
    expect(result.text).toBeNull();
  });

  it("rejects payloads missing a conversationId", async () => {
    const adapter = buildAdapter();
    await expect(adapter.parseInboundPayload({ text: "hi" }, {})).rejects.toThrow(/valid inbound/v);
  });

  it("rejects non-object payloads", async () => {
    const adapter = buildAdapter();
    await expect(adapter.parseInboundPayload(null, {})).rejects.toThrow(/valid inbound/v);
  });
});

describe("webChatAdapter.sendOutbound", () => {
  it("persists a text Message row and publishes a message event", async () => {
    const prisma = buildPrismaMock();
    const bus = buildBusMock();
    const adapter = buildAdapter({ bus, prisma: prisma as never });

    const result = await adapter.sendOutbound({
      connectorConfig: {},
      payload: { text: "oi tudo bem?" },
      threadId: "conv_42",
    });

    expect(result.externalMessageId).toBe("msg_generated");
    expect(prisma.message.create).toHaveBeenCalledOnce();
    const createArgs = prisma.message.create.mock.calls[0]![0];
    expect(createArgs.data).toMatchObject({
      content: "oi tudo bem?",
      contentType: "TEXT",
      conversationId: "conv_42",
      sender: "AGENT",
    });
    expect(bus.publish).toHaveBeenCalledOnce();
    const event = bus.publish.mock.calls[0]![0];
    expect(event).toMatchObject({
      conversationId: "conv_42",
      type: "message",
    });
    expect(event.message).toMatchObject({
      content: "oi tudo bem?",
      contentType: "TEXT",
      sender: "AGENT",
    });
  });

  it("persists IMAGE rows for files and publishes one event per file", async () => {
    const prisma = buildPrismaMock();
    const bus = buildBusMock();
    const adapter = buildAdapter({ bus, prisma: prisma as never });

    await adapter.sendOutbound({
      connectorConfig: {},
      payload: {
        files: [{ bytes: new Uint8Array([1, 2, 3]), filename: "asset.png", mimeType: "image/png" }],
        text: "veja",
      },
      threadId: "conv_99",
    });

    expect(prisma.message.create).toHaveBeenCalledTimes(2);
    const imageCall = prisma.message.create.mock.calls[1]![0];
    expect(imageCall.data).toMatchObject({
      contentType: "IMAGE",
      conversationId: "conv_99",
      sender: "AGENT",
    });
    expect(imageCall.data.metadata).toMatchObject({
      filename: "asset.png",
      mimeType: "image/png",
    });
    expect(bus.publish).toHaveBeenCalledTimes(2);
  });

  it("throws when neither text nor files are provided", async () => {
    const prisma = buildPrismaMock();
    const adapter = buildAdapter({ prisma: prisma as never });

    await expect(
      adapter.sendOutbound({
        connectorConfig: {},
        payload: {},
        threadId: "conv_x",
      }),
    ).rejects.toThrow(/requires text or at least one file/v);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
});

describe("webChatAdapter.validateConfig", () => {
  it("always returns valid (WEB_CHAT has no config to validate)", () => {
    const adapter = buildAdapter();
    expect(adapter.validateConfig({})).toEqual({ valid: true });
    expect(adapter.validateConfig(null)).toEqual({ valid: true });
    expect(adapter.validateConfig({ random: "field" })).toEqual({ valid: true });
  });
});

describe("webChatAdapter metadata", () => {
  it("declares inbound + outbound capabilities and the WEB_CHAT type", () => {
    const adapter = buildAdapter();
    expect(adapter.type).toBe("WEB_CHAT");
    expect(adapter.capabilities).toEqual({ inbound: true, outbound: true });
  });
});
