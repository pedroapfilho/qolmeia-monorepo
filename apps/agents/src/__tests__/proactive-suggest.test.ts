import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CorrespondentAgent } from "@/agents/correspondent";
import { listMessages } from "@/db/schema";

// End-to-end cover for the proactive "suggest next work" turn: the scripted
// model is the only seam; the DO, D1 persistence, broadcast, and dedup run for
// real in workerd.

const COMPLETE_COMPANY = "proactive-suggest-complete";
const INCOMPLETE_COMPANY = "proactive-suggest-incomplete";
const REPLY = "Que tal 3 posts para o Instagram esta semana?";

const CHUNKS: Array<LanguageModelV3StreamPart> = [
  { type: "stream-start", warnings: [] },
  { id: "0", type: "text-start" },
  { delta: REPLY, id: "0", type: "text-delta" },
  { id: "0", type: "text-end" },
  {
    finishReason: { raw: "stop", unified: "stop" },
    type: "finish",
    usage: {
      inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 4, total: 4 },
      outputTokens: { reasoning: 0, text: 9, total: 9 },
    },
  },
];

const scriptedModel = () =>
  new MockLanguageModelV3({
    doStream: () => Promise.resolve({ stream: simulateReadableStream({ chunks: CHUNKS }) }),
  });

const COMPLETE_BRIEF = JSON.stringify({
  audience: "donos de cafeteria em SP",
  brand: { palette: "marrom + creme", references: "Starbucks", voice: "acolhedora" },
  channels: ["instagram", "whatsapp"],
  industry: "alimentação",
  primaryGoal: "aumentar vendas no fim de semana",
});

const seedCompany = async (id: string, brief: string | null) => {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO company (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, ?, ?, 'America/Sao_Paulo', 'pt-BR', 'active', ?, 0, 0)`,
  )
    .bind(id, id, id, brief)
    .run();
};

// FK-safe order: children (message → conversation, activity_log) before the
// company they reference. emitAgentMessage creates a conversation row, so it
// must be deleted before the company or the company DELETE/REPLACE fails its FK.
const cleanup = async (id: string) => {
  await env.DB.prepare("DELETE FROM message WHERE company_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM conversation WHERE company_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM activity_log WHERE company_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM company WHERE id = ?").bind(id).run();
};

beforeEach(async () => {
  await cleanup(COMPLETE_COMPANY);
  await cleanup(INCOMPLETE_COMPANY);
  await seedCompany(COMPLETE_COMPANY, COMPLETE_BRIEF);
  await seedCompany(INCOMPLETE_COMPANY, null);
});

afterEach(async () => {
  await cleanup(COMPLETE_COMPANY);
  await cleanup(INCOMPLETE_COMPANY);
});

describe("CorrespondentAgent.suggestNextWork", () => {
  it("suggests, persists the agent turn, logs the activity, then dedupes the next call", async () => {
    const stub = env.CORRESPONDENT.get(env.CORRESPONDENT.idFromName(COMPLETE_COMPANY));

    const first = await runInDurableObject(
      stub,
      (instance: InstanceType<typeof CorrespondentAgent>) => {
        instance.resolveModel = scriptedModel;
        return instance.suggestNextWork();
      },
    );
    expect(first).toEqual({ status: "suggested" });

    const messages = await listMessages(env.DB, `web-${COMPLETE_COMPANY}`);
    expect(messages.some((m) => m.role === "agent" && m.content === REPLY)).toBe(true);

    const activity = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM activity_log WHERE company_id = ? AND type = 'WORKER_PROACTIVE_SUGGESTION'",
    )
      .bind(COMPLETE_COMPANY)
      .first<{ n: number }>();
    expect(activity?.n).toBe(1);

    // Second call within the weekly window must skip (no duplicate outreach).
    const second = await runInDurableObject(
      stub,
      (instance: InstanceType<typeof CorrespondentAgent>) => {
        instance.resolveModel = scriptedModel;
        return instance.suggestNextWork();
      },
    );
    expect(second).toEqual({ reason: "suggested recently", status: "skipped" });
  });

  it("skips when the brief is incomplete", async () => {
    const stub = env.CORRESPONDENT.get(env.CORRESPONDENT.idFromName(INCOMPLETE_COMPANY));
    const outcome = await runInDurableObject(
      stub,
      (instance: InstanceType<typeof CorrespondentAgent>) => {
        instance.resolveModel = scriptedModel;
        return instance.suggestNextWork();
      },
    );
    expect(outcome).toEqual({ reason: "brief incomplete", status: "skipped" });
  });
});
