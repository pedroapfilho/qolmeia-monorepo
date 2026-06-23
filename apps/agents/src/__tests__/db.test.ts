import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { getCompany, insertMessage, listMessages, upsertConversation } from "#/db/schema";

const COMPANY_ID = "test-co";
const CONVERSATION_ID = "test-conv";

beforeEach(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO company
       (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'Test Co', 'test-co', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
});

describe("getCompany", () => {
  it("returns a seeded company", async () => {
    const company = await getCompany(env.DB, COMPANY_ID);
    expect(company?.name).toBe("Test Co");
    expect(company?.status).toBe("active");
  });

  it("returns null for an unknown id", async () => {
    expect(await getCompany(env.DB, "missing")).toBeNull();
  });
});

describe("upsertConversation", () => {
  it("is idempotent on (company_id, external_thread_id)", async () => {
    const first = await upsertConversation(env.DB, {
      companyId: COMPANY_ID,
      externalThreadId: "web",
      id: CONVERSATION_ID,
    });
    const second = await upsertConversation(env.DB, {
      companyId: COMPANY_ID,
      externalThreadId: "web",
      id: "a-different-id",
    });
    expect(second.id).toBe(first.id);

    const { results } = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM conversation WHERE company_id = ?",
    )
      .bind(COMPANY_ID)
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(1);
  });
});

describe("insertMessage + listMessages", () => {
  beforeEach(async () => {
    await upsertConversation(env.DB, {
      companyId: COMPANY_ID,
      externalThreadId: "web",
      id: CONVERSATION_ID,
    });
  });

  it("persists and lists messages for a conversation", async () => {
    await insertMessage(env.DB, {
      companyId: COMPANY_ID,
      content: "oi",
      conversationId: CONVERSATION_ID,
      id: "m1",
      role: "user",
    });
    await insertMessage(env.DB, {
      agentInstanceId: "correspondent",
      companyId: COMPANY_ID,
      content: "olá!",
      conversationId: CONVERSATION_ID,
      id: "m2",
      role: "agent",
    });

    const messages = await listMessages(env.DB, CONVERSATION_ID);
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.content)).toEqual(
      expect.arrayContaining(["oi", "olá!"]),
    );
  });

  it("is idempotent on the message id", async () => {
    // Own conversation so the assertion is independent of other tests' rows.
    const dupConversationId = "dup-conv";
    await upsertConversation(env.DB, {
      companyId: COMPANY_ID,
      externalThreadId: "dup-thread",
      id: dupConversationId,
    });

    await insertMessage(env.DB, {
      companyId: COMPANY_ID,
      content: "first",
      conversationId: dupConversationId,
      id: "dup",
      role: "user",
    });
    await insertMessage(env.DB, {
      companyId: COMPANY_ID,
      content: "second write, same id",
      conversationId: dupConversationId,
      id: "dup",
      role: "user",
    });

    const messages = await listMessages(env.DB, dupConversationId);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("first");
  });
});
