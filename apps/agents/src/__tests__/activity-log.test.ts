import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listActivity, logActivity } from "#/activity/log";

const COMPANY_ID = "co_activity_test";

beforeEach(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO company
       (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'Activity Test', 'activity-test', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logActivity + listActivity", () => {
  it("writes a row that listActivity returns", async () => {
    await logActivity(env, {
      companyId: COMPANY_ID,
      refId: "ticket-roundtrip-1",
      refType: "ticket",
      summary: "Coisa aconteceu",
      type: "TICKET_DONE",
    });
    const items = await listActivity(env.DB, { companyId: COMPANY_ID });
    expect(
      items.find((i) => i.summary === "Coisa aconteceu" && i.type === "TICKET_DONE"),
    ).toBeTruthy();
  });

  it("filters by since", async () => {
    await logActivity(env, {
      companyId: COMPANY_ID,
      refId: "action-old",
      refType: "action",
      summary: "antiga",
      type: "ACTION_EXECUTED",
    });
    // Sleep ensures cutoff is strictly after the first row's created_at
    // (Date.now() resolution can collide on fast machines).
    await new Promise<void>((r) => {
      setTimeout(r, 10);
    });
    const cutoff = Date.now();
    await new Promise<void>((r) => {
      setTimeout(r, 10);
    });
    await logActivity(env, {
      companyId: COMPANY_ID,
      payload: { actionId: "a-new", summary: "draft" },
      refId: "a-new",
      refType: "action",
      summary: "nova",
      type: "ACTION_PROPOSED",
    });
    const recent = await listActivity(env.DB, { companyId: COMPANY_ID, since: cutoff });
    expect(recent.find((i) => i.type === "ACTION_PROPOSED")).toBeTruthy();
    expect(recent.find((i) => i.type === "ACTION_EXECUTED")).toBeUndefined();
  });

  it("swallows write failures (best-effort) and logs to console", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const badEnv = {
      DB: {
        prepare: () => ({
          bind: () => ({
            run: () => Promise.reject(new Error("simulated D1 failure")),
          }),
        }),
      } as unknown as D1Database,
    };
    await expect(
      logActivity(badEnv, {
        companyId: COMPANY_ID,
        refId: "ticket-broken",
        refType: "ticket",
        summary: "won't actually write",
        type: "TICKET_DONE",
      }),
    ).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
  });
});
