import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { env, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { CorrespondentAgent } from "#/agents/correspondent";
import { listMessages } from "#/db/schema";

const TEST_COMPANY_ID = "p1-demo-company";
// Conversation id is now derived inside the DO as `web-{this.name}`.
const TEST_CONVERSATION_ID = `web-${TEST_COMPANY_ID}`;

// A scripted two-token reply — the one mocked seam. Everything else (DO, D1)
// runs for real in workerd.
const SCRIPTED_CHUNKS: Array<LanguageModelV3StreamPart> = [
  { type: "stream-start", warnings: [] },
  { id: "0", type: "text-start" },
  { delta: "Olá! ", id: "0", type: "text-delta" },
  { delta: "Como posso ajudar?", id: "0", type: "text-delta" },
  { id: "0", type: "text-end" },
  {
    finishReason: { raw: "stop", unified: "stop" },
    type: "finish",
    usage: {
      inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 4, total: 4 },
      outputTokens: { reasoning: 0, text: 5, total: 5 },
    },
  },
];

// Injected by reassigning `resolveModel` on the live DO instance.
const scriptedModel = () =>
  new MockLanguageModelV3({
    doStream: () =>
      Promise.resolve({ stream: simulateReadableStream({ chunks: SCRIPTED_CHUNKS }) }),
  });

beforeEach(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO company
       (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'Demo', 'demo', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
  )
    .bind(TEST_COMPANY_ID)
    .run();
});

describe("CorrespondentAgent", () => {
  it("runs the chat loop and persists both turns to D1", async () => {
    const stub = env.CORRESPONDENT.get(env.CORRESPONDENT.idFromName(TEST_COMPANY_ID));

    let finishedResolve: (() => void) | undefined;
    const finished = new Promise<void>((resolve) => {
      finishedResolve = resolve;
    });

    await runInDurableObject(stub, async (instance: InstanceType<typeof CorrespondentAgent>) => {
      instance.resolveModel = scriptedModel;
      instance.messages = [{ id: "user-1", parts: [{ text: "oi", type: "text" }], role: "user" }];
      // onChatMessage awaits the assistant D1 write before invoking this
      // callback, so resolving here means both turns are persisted.
      const response = await instance.onChatMessage(() => finishedResolve?.());
      await response?.text();
      await finished;
    });

    const messages = await listMessages(env.DB, TEST_CONVERSATION_ID);
    const byRole = Object.fromEntries(messages.map((message) => [message.role, message.content]));
    expect(byRole.user).toBe("oi");
    expect(byRole.agent).toBe("Olá! Como posso ajudar?");
  });
});
