import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { env, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { PlannerAgent } from "@/agents/planner";
import { listMessages } from "@/db/schema";

const COMPANY_ID = "opening-demo-company";

const CHUNKS: Array<LanguageModelV3StreamPart> = [
  { type: "stream-start", warnings: [] },
  { id: "0", type: "text-start" },
  { delta: "Oi! Sou o Planejador. ", id: "0", type: "text-delta" },
  { delta: "O que a sua empresa faz?", id: "0", type: "text-delta" },
  { id: "0", type: "text-end" },
  {
    finishReason: { raw: "stop", unified: "stop" },
    type: "finish",
    usage: {
      inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 4, total: 4 },
      outputTokens: { reasoning: 0, text: 6, total: 6 },
    },
  },
];

const scriptedModel = () =>
  new MockLanguageModelV3({
    doStream: () => Promise.resolve({ stream: simulateReadableStream({ chunks: CHUNKS }) }),
  });

const seedCompany = async (brief: string | null) => {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO company
       (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'Demo', 'opening-demo', 'America/Sao_Paulo', 'pt-BR', 'onboarding', ?, 0, 0)`,
  )
    .bind(COMPANY_ID, brief)
    .run();
};

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM message WHERE company_id = ?").bind(COMPANY_ID).run();
  // Reset the DO's own messages table and instance-level guards so each test
  // gets a clean transcript. The DO stays alive across runInDurableObject calls
  // within the same test file, so we must reset in-memory state explicitly.
  const stub = env.PLANNER.get(env.PLANNER.idFromName(COMPANY_ID));
  await runInDurableObject(stub, (planner: PlannerAgent) => {
    void planner.sql`DELETE FROM cf_ai_chat_agent_messages`;
    planner.messages = [];
    (planner as unknown as { openingInFlight: boolean }).openingInFlight = false;
  });
});

describe("PlannerAgent.startOpeningTurn", () => {
  it("opens the conversation when transcript and brief are empty", async () => {
    await seedCompany(null);
    const stub = env.PLANNER.get(env.PLANNER.idFromName(COMPANY_ID));

    const result = await runInDurableObject(stub, async (planner: PlannerAgent) => {
      planner.resolveModel = scriptedModel;
      return await planner.startOpeningTurn();
    });

    expect(result.status).toBe("opened");
    const messages = await listMessages(env.DB, `web-planner-${COMPANY_ID}`);
    expect(messages.filter((m) => m.role === "agent")).toHaveLength(1);
    expect(messages[0]?.content).toContain("empresa faz");
  });

  it("skips when the brief already has business info", async () => {
    await seedCompany(JSON.stringify({ industry: "alimentação", schemaVersion: 1 }));
    const stub = env.PLANNER.get(env.PLANNER.idFromName(COMPANY_ID));

    const result = await runInDurableObject(stub, async (planner: PlannerAgent) => {
      planner.resolveModel = scriptedModel;
      return await planner.startOpeningTurn();
    });

    expect(result.status).toBe("skipped");
    const messages = await listMessages(env.DB, `web-planner-${COMPANY_ID}`);
    expect(messages).toHaveLength(0);
  });

  it("skips when the transcript is non-empty (second call is a no-op)", async () => {
    await seedCompany(null);
    const stub = env.PLANNER.get(env.PLANNER.idFromName(COMPANY_ID));

    const second = await runInDurableObject(stub, async (planner: PlannerAgent) => {
      planner.resolveModel = scriptedModel;
      await planner.startOpeningTurn();
      return planner.startOpeningTurn();
    });

    expect(second.status).toBe("skipped");
    const messages = await listMessages(env.DB, `web-planner-${COMPANY_ID}`);
    expect(messages.filter((m) => m.role === "agent")).toHaveLength(1);
  });
});
