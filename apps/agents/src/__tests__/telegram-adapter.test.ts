import { afterEach, describe, expect, it, vi } from "vitest";

import { telegramAdapter } from "#/connectors/telegram/adapter";

const ORIGINAL_FETCH = globalThis.fetch;

const buildUpdate = (overrides?: Record<string, unknown>): string =>
  JSON.stringify({
    message: {
      chat: { id: 12_345, type: "private" },
      date: 1_716_000_000,
      from: { first_name: "Pedro", last_name: "F", username: "pedrof" },
      message_id: 42,
      text: "olá",
      ...overrides,
    },
    update_id: 9001,
  });

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("telegramAdapter.verify", () => {
  it("accepts the configured secret_token header", async () => {
    const ok = await telegramAdapter.verify(
      {
        body: "",
        headers: new Headers({ "X-Telegram-Bot-Api-Secret-Token": "abc123" }),
      },
      { bot_token: "irrelevant", secret_token: "abc123" },
    );
    expect(ok).toBe(true);
  });

  it("rejects a missing or mismatched header", async () => {
    expect(
      await telegramAdapter.verify(
        { body: "", headers: new Headers() },
        { secret_token: "abc123" },
      ),
    ).toBe(false);
    expect(
      await telegramAdapter.verify(
        { body: "", headers: new Headers({ "X-Telegram-Bot-Api-Secret-Token": "wrong" }) },
        { secret_token: "abc123" },
      ),
    ).toBe(false);
  });

  it("rejects when no secret_token is configured (operator must set one)", async () => {
    expect(
      await telegramAdapter.verify(
        { body: "", headers: new Headers({ "X-Telegram-Bot-Api-Secret-Token": "anything" }) },
        {},
      ),
    ).toBe(false);
  });
});

describe("telegramAdapter.parseInbound", () => {
  it("turns a Telegram Update into a NormalizedMessage", async () => {
    const parsed = await telegramAdapter.parseInbound(buildUpdate(), {});
    expect(parsed).not.toBeNull();
    expect(parsed?.text).toBe("olá");
    expect(parsed?.externalThreadId).toBe("12345");
    expect(parsed?.externalId).toBe("12345:42");
    expect(parsed?.authorDisplayName).toBe("Pedro F");
    expect(parsed?.attachments).toEqual([]);
  });

  it("attaches voice messages as audio attachments", async () => {
    const parsed = await telegramAdapter.parseInbound(
      buildUpdate({
        text: undefined,
        voice: { file_id: "voice-123", mime_type: "audio/ogg" },
      }),
      {},
    );
    expect(parsed?.attachments[0]).toEqual({
      externalId: "voice-123",
      kind: "audio",
      mime: "audio/ogg",
    });
  });

  it("returns null for non-message updates (callback_query, etc.)", async () => {
    const parsed = await telegramAdapter.parseInbound(
      JSON.stringify({ callback_query: { id: "x" }, update_id: 1 }),
      {},
    );
    expect(parsed).toBeNull();
  });

  it("returns null for malformed JSON", async () => {
    expect(await telegramAdapter.parseInbound("not json", {})).toBeNull();
  });
});

describe("telegramAdapter.sendOutbound", () => {
  it("POSTs to the Telegram sendMessage endpoint with the bot token", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(Response.json({ ok: true, result: { message_id: 99 } })),
    );
    globalThis.fetch = fetchSpy as typeof globalThis.fetch;

    const result = await telegramAdapter.sendOutbound({
      config: { bot_token: "BOT:TOKEN" },
      externalThreadId: "12345",
      text: "oi de volta",
    });

    expect(result.externalMessageId).toBe("12345:99");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/botBOT:TOKEN/sendMessage");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.chat_id).toBe("12345");
    expect(body.text).toBe("oi de volta");
  });

  it("throws when bot_token is missing", async () => {
    await expect(
      telegramAdapter.sendOutbound({
        config: {},
        externalThreadId: "12345",
        text: "x",
      }),
    ).rejects.toThrow(/bot_token/v);
  });

  it("throws on non-OK HTTP", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("rate limited", { status: 429 })),
    ) as typeof globalThis.fetch;
    await expect(
      telegramAdapter.sendOutbound({
        config: { bot_token: "T" },
        externalThreadId: "12345",
        text: "x",
      }),
    ).rejects.toThrow(/429/v);
  });
});
