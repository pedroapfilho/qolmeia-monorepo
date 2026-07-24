import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PROACTIVE_INTERVAL_MS, proactiveGate, recordProactiveSuggestion } from "#/lib/proactive";
import { runProactiveSweep } from "#/scheduled";

const COMPANY_ID = "co_proactive_test";

const seedCompany = async (id: string, status: string, brief: string | null) => {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO company (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, ?, ?, 'America/Sao_Paulo', 'pt-BR', ?, ?, 0, 0)`,
  )
    .bind(id, id, id, status, brief)
    .run();
};

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM activity_log WHERE company_id LIKE 'co_proactive%'").run();
  await env.DB.prepare("DELETE FROM company WHERE id LIKE 'co_proactive%'").run();
});

afterEach(async () => {
  await env.DB.prepare("DELETE FROM activity_log WHERE company_id LIKE 'co_proactive%'").run();
  await env.DB.prepare("DELETE FROM company WHERE id LIKE 'co_proactive%'").run();
});

describe("proactiveGate", () => {
  const now = 1_000_000_000_000;

  it("skips when the brief is incomplete", () => {
    const gate = proactiveGate({ isComplete: false, lastSuggestedAt: null, now });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe("brief incomplete");
  });

  it("skips when suggested within the weekly window", () => {
    const gate = proactiveGate({
      isComplete: true,
      lastSuggestedAt: now - (PROACTIVE_INTERVAL_MS - 1000),
      now,
    });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe("suggested recently");
  });

  it("allows when complete and never suggested", () => {
    expect(proactiveGate({ isComplete: true, lastSuggestedAt: null, now }).ok).toBe(true);
  });

  it("allows again once the weekly window has passed", () => {
    const gate = proactiveGate({
      isComplete: true,
      lastSuggestedAt: now - (PROACTIVE_INTERVAL_MS + 1000),
      now,
    });
    expect(gate.ok).toBe(true);
  });
});

describe("recordProactiveSuggestion", () => {
  it("writes a WORKER_PROACTIVE_SUGGESTION row the dedup query can read back", async () => {
    await seedCompany(COMPANY_ID, "active", null);
    await recordProactiveSuggestion(env, COMPANY_ID);
    const row = await env.DB.prepare(
      `SELECT type, ref_id FROM activity_log
         WHERE company_id = ? AND type = 'WORKER_PROACTIVE_SUGGESTION' LIMIT 1`,
    )
      .bind(COMPANY_ID)
      .first<{ ref_id: string; type: string }>();
    expect(row?.type).toBe("WORKER_PROACTIVE_SUGGESTION");
    expect(row?.ref_id).toBe(`corr-${COMPANY_ID}`);
  });
});

describe("runProactiveSweep", () => {
  it("wakes no DOs when no active company has a complete brief", async () => {
    await seedCompany("co_proactive_a", "active", null);
    await seedCompany(
      "co_proactive_b",
      "onboarding",
      JSON.stringify({
        audience: "x",
        brand: { palette: "p", references: "r", voice: "v" },
        channels: ["instagram"],
        industry: "i",
        primaryGoal: "g",
      }),
    );
    const result = await runProactiveSweep(env);
    expect(result).toEqual({ errored: 0, skipped: 0, suggested: 0 });
  });
});
