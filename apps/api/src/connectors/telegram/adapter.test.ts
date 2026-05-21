import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { telegramAdapter } from "./adapter";

const buildTextUpdate = () => ({
  message: {
    chat: { id: 42, type: "private" },
    date: 1_716_220_800,
    from: { first_name: "Maria", id: 1, username: "maria" },
    message_id: 7,
    text: "Olá",
  },
  update_id: 100,
});

const buildPhotoUpdate = () => ({
  message: {
    caption: "Look at this",
    chat: { id: 42, type: "private" },
    date: 1_716_220_801,
    from: { first_name: "João", id: 2, last_name: "Silva" },
    message_id: 8,
    photo: [
      { file_id: "small", file_size: 1024, file_unique_id: "s", height: 90, width: 90 },
      { file_id: "large", file_size: 80_000, file_unique_id: "l", height: 1024, width: 1024 },
    ],
  },
  update_id: 101,
});

const buildVoiceUpdate = () => ({
  message: {
    chat: { id: 42, type: "private" },
    date: 1_716_220_802,
    from: { first_name: "Ana", id: 3 },
    message_id: 9,
    voice: { file_id: "vid", file_size: 5000, file_unique_id: "vu", mime_type: "audio/ogg" },
  },
  update_id: 102,
});

describe("telegramAdapter.parseInboundPayload", () => {
  it("parses a text message", async () => {
    const result = await telegramAdapter.parseInboundPayload(buildTextUpdate(), {});
    expect(result.text).toBe("Olá");
    expect(result.externalThreadId).toBe("42");
    expect(result.externalId).toBe("42:7");
    expect(result.attachments).toHaveLength(0);
    expect(result.authorDisplayName).toBe("@maria");
    expect(result.rawTimestamp).toBe(1_716_220_800_000);
  });

  it("parses a photo message and picks the largest size", async () => {
    const result = await telegramAdapter.parseInboundPayload(buildPhotoUpdate(), {});
    expect(result.text).toBe("Look at this");
    expect(result.attachments).toEqual([
      { kind: "image", mimeType: "image/jpeg", sizeBytes: 80_000 },
    ]);
    expect(result.authorDisplayName).toBe("João Silva");
  });

  it("parses a voice message", async () => {
    const result = await telegramAdapter.parseInboundPayload(buildVoiceUpdate(), {});
    expect(result.text).toBeNull();
    expect(result.attachments).toEqual([{ kind: "audio", mimeType: "audio/ogg", sizeBytes: 5000 }]);
    expect(result.authorDisplayName).toBe("Ana");
  });

  it("falls back to edited_message when message is absent", async () => {
    const update = {
      edited_message: {
        chat: { id: 99, type: "private" },
        date: 1_716_220_900,
        message_id: 50,
        text: "edited",
      },
      update_id: 200,
    };
    const result = await telegramAdapter.parseInboundPayload(update, {});
    expect(result.text).toBe("edited");
    expect(result.externalThreadId).toBe("99");
    expect(result.authorDisplayName).toBeNull();
  });

  it("throws when update has no parseable message", async () => {
    await expect(telegramAdapter.parseInboundPayload({ update_id: 1 }, {})).rejects.toThrow(
      /no parseable message/v,
    );
  });

  it("throws when raw payload is not an object", async () => {
    await expect(telegramAdapter.parseInboundPayload(null, {})).rejects.toThrow(/not an object/v);
  });
});

describe("telegramAdapter.sendOutbound", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const validConfig = { botToken: "BOT:TOKEN", secretToken: "secret" };

  it("sends text via sendMessage and returns the message_id", async () => {
    fetchMock.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true, result: { message_id: 555 } }),
      ok: true,
      status: 200,
    });

    const result = await telegramAdapter.sendOutbound({
      connectorConfig: validConfig,
      payload: { text: "hello" },
      threadId: "42",
    });

    expect(result.externalMessageId).toBe("555");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/botBOT:TOKEN/sendMessage");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as { chat_id: string; text: string };
    expect(body).toEqual({ chat_id: "42", text: "hello" });
  });

  it("sends a file via sendDocument and returns its message_id", async () => {
    fetchMock.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true, result: { message_id: 777 } }),
      ok: true,
      status: 200,
    });

    const result = await telegramAdapter.sendOutbound({
      connectorConfig: validConfig,
      payload: {
        files: [{ bytes: new Uint8Array([1, 2, 3]), filename: "a.png", mimeType: "image/png" }],
      },
      threadId: "42",
    });

    expect(result.externalMessageId).toBe("777");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/botBOT:TOKEN/sendDocument");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("rejects an invalid connector config", async () => {
    await expect(
      telegramAdapter.sendOutbound({
        connectorConfig: { botToken: "" },
        payload: { text: "hi" },
        threadId: "42",
      }),
    ).rejects.toThrow(/invalid connector config/v);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an empty payload", async () => {
    await expect(
      telegramAdapter.sendOutbound({
        connectorConfig: validConfig,
        payload: {},
        threadId: "42",
      }),
    ).rejects.toThrow(/requires text or at least one file/v);
  });

  it("throws when the Telegram API responds with HTTP failure", async () => {
    fetchMock.mockResolvedValueOnce({
      json: () => Promise.resolve({}),
      ok: false,
      status: 502,
    });
    await expect(
      telegramAdapter.sendOutbound({
        connectorConfig: validConfig,
        payload: { text: "hi" },
        threadId: "42",
      }),
    ).rejects.toThrow(/HTTP 502/v);
  });
});

describe("telegramAdapter.validateConfig", () => {
  it("accepts a config with botToken + secretToken", () => {
    const result = telegramAdapter.validateConfig({
      botToken: "BOT:TOKEN",
      secretToken: "secret",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects when botToken is missing", () => {
    const result = telegramAdapter.validateConfig({ secretToken: "secret" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("config.botToken is required");
    }
  });

  it("rejects when secretToken is missing", () => {
    const result = telegramAdapter.validateConfig({ botToken: "BOT:TOKEN" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("config.secretToken is required");
    }
  });

  it("rejects when config is not an object", () => {
    const result = telegramAdapter.validateConfig("nope");
    expect(result.valid).toBe(false);
  });
});

describe("telegramAdapter metadata", () => {
  it("declares full inbound + outbound capabilities", () => {
    expect(telegramAdapter.capabilities).toEqual({ inbound: true, outbound: true });
    expect(telegramAdapter.type).toBe("TELEGRAM");
  });
});

describe("telegramAdapter.verifySignature", () => {
  const validConfig = { botToken: "BOT:TOKEN", secretToken: "secret" };

  it("accepts requests with a matching X-Telegram-Bot-Api-Secret-Token", async () => {
    const result = await telegramAdapter.verifySignature!({
      connectorConfig: validConfig,
      headers: new Headers({ "x-telegram-bot-api-secret-token": "secret" }),
      rawBody: "{}",
    });
    expect(result).toBe(true);
  });

  it("rejects requests when the secret token is missing", async () => {
    const result = await telegramAdapter.verifySignature!({
      connectorConfig: validConfig,
      headers: new Headers(),
      rawBody: "{}",
    });
    expect(result).toBe(false);
  });

  it("rejects requests when the secret token mismatches", async () => {
    const result = await telegramAdapter.verifySignature!({
      connectorConfig: validConfig,
      headers: new Headers({ "x-telegram-bot-api-secret-token": "wrong" }),
      rawBody: "{}",
    });
    expect(result).toBe(false);
  });

  it("rejects requests when the connector config is invalid", async () => {
    const result = await telegramAdapter.verifySignature!({
      connectorConfig: {},
      headers: new Headers({ "x-telegram-bot-api-secret-token": "secret" }),
      rawBody: "{}",
    });
    expect(result).toBe(false);
  });
});
