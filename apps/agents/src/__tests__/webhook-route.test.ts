import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { putConnectorSecrets } from "@/lib/connector-secrets";

const COMPANY_ID = "co_webhook_test";
const CONNECTOR_ID = "conn-tg-webhook-test";
const ORIGINAL_FETCH = globalThis.fetch;

const buildUpdate = (messageId: number, text: string): string =>
  JSON.stringify({
    message: {
      chat: { id: 999_111_222, type: "private" },
      date: 1_716_000_000,
      from: { first_name: "Test" },
      message_id: messageId,
      text,
    },
    update_id: messageId * 10,
  });

beforeEach(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO company
       (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'WH Test', 'wh-test', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO connector
       (id, company_id, type, display_name, config_ref, inbound, outbound, status, created_at)
     VALUES (?, ?, 'telegram', 'TG', ?, 1, 1, 'active', 0)`,
  )
    .bind(CONNECTOR_ID, COMPANY_ID, `kv:${CONNECTOR_ID}`)
    .run();
  await putConnectorSecrets(env, CONNECTOR_ID, {
    bot_token: "TEST:BOT_TOKEN",
    secret_token: "topsecret",
  });
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("POST /webhooks/:type/:connectorId", () => {
  it("404 for an unknown connector type", async () => {
    const res = await SELF.fetch("https://agents.test/webhooks/myspace/whatever", {
      body: "",
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("404 for an unknown connector id", async () => {
    const res = await SELF.fetch("https://agents.test/webhooks/telegram/does-not-exist", {
      body: "{}",
      headers: { "X-Telegram-Bot-Api-Secret-Token": "topsecret" },
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("401 when the secret token header doesn't match", async () => {
    const res = await SELF.fetch(`https://agents.test/webhooks/telegram/${CONNECTOR_ID}`, {
      body: buildUpdate(1, "olá"),
      headers: { "X-Telegram-Bot-Api-Secret-Token": "wrong" },
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("200 + persists conversation + records webhook_event on a valid first delivery", async () => {
    // Stub the Correspondent's outbound fetch so the waitUntil work doesn't error.
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(Response.json({ ok: true, result: { message_id: 1 } })),
    ) as typeof globalThis.fetch;

    const res = await SELF.fetch(`https://agents.test/webhooks/telegram/${CONNECTOR_ID}`, {
      body: buildUpdate(42, "olá"),
      headers: { "X-Telegram-Bot-Api-Secret-Token": "topsecret" },
      method: "POST",
    });
    expect(res.status).toBe(200);

    const ev = await env.DB.prepare(
      "SELECT * FROM webhook_event WHERE provider = ? AND external_id = ?",
    )
      .bind("telegram", "999111222:42")
      .first();
    expect(ev).not.toBeNull();

    const conv = await env.DB.prepare(
      "SELECT id FROM conversation WHERE company_id = ? AND external_thread_id = ?",
    )
      .bind(COMPANY_ID, "999111222")
      .first<{ id: string }>();
    expect(conv?.id).toContain("telegram-");
  });

  it("dedup: same update_id replayed returns 200 'Already processed' without re-dispatching", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(Response.json({ ok: true, result: { message_id: 1 } })),
    ) as typeof globalThis.fetch;

    const url = `https://agents.test/webhooks/telegram/${CONNECTOR_ID}`;
    const body = buildUpdate(100, "primeira vez");
    const headers = { "X-Telegram-Bot-Api-Secret-Token": "topsecret" };

    const first = await SELF.fetch(url, { body, headers, method: "POST" });
    expect(first.status).toBe(200);
    const second = await SELF.fetch(url, { body, headers, method: "POST" });
    expect(second.status).toBe(200);
    expect(await second.text()).toBe("Already processed");
  });

  it("200 + no DO dispatch for null parseInbound (non-message update)", async () => {
    const res = await SELF.fetch(`https://agents.test/webhooks/telegram/${CONNECTOR_ID}`, {
      body: JSON.stringify({ callback_query: { id: "x" }, update_id: 7 }),
      headers: { "X-Telegram-Bot-Api-Secret-Token": "topsecret" },
      method: "POST",
    });
    expect(res.status).toBe(200);
  });
});
