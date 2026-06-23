import { afterEach, describe, expect, it, vi } from "vitest";

import { webSearchSkill } from "#/skills/web-search";

const originalFetch = globalThis.fetch;

const ctx = (apiKey?: string) => ({
  agentInstanceId: "ai_test",
  companyId: "co_test",
  env: { EXA_API_KEY: apiKey } as unknown as Env,
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("webSearch skill", () => {
  it("maps Exa results to trimmed snippet + title + url", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        Response.json({
          results: [
            {
              publishedDate: "2026-01-01",
              text: "corpo do resultado",
              title: "Título",
              url: "https://exemplo.com",
            },
          ],
        }),
      ),
    );
    const out = (await webSearchSkill.execute(
      { query: "tendências de café especial" },
      ctx("k"),
    )) as {
      results: Array<{ snippet: string; title: string; url: string }>;
    };
    expect(out.results[0]).toMatchObject({
      snippet: "corpo do resultado",
      title: "Título",
      url: "https://exemplo.com",
    });
  });

  it("throws a clear error when EXA_API_KEY is unset", async () => {
    await expect(webSearchSkill.execute({ query: "x" }, ctx(undefined))).rejects.toThrow(
      /EXA_API_KEY/v,
    );
  });

  it("throws when Exa responds non-ok", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response("err", { status: 500 })));
    await expect(webSearchSkill.execute({ query: "x" }, ctx("k"))).rejects.toThrow(/Exa/v);
  });
});
