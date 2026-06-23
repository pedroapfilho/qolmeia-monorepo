import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchUrlSkill } from "#/skills/fetch-url";

const originalFetch = globalThis.fetch;

const ctx = (env: Record<string, string | undefined>) => ({
  agentInstanceId: "ai_test",
  companyId: "co_test",
  env: env as unknown as Env,
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchUrl skill", () => {
  it("returns trimmed markdown + title + url from a scrape", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        Response.json({
          data: {
            markdown: "# Localcine\n\nProdutora audiovisual.",
            metadata: { sourceURL: "https://localcine.com.br", title: "Localcine" },
          },
          success: true,
        }),
      ),
    );
    const out = (await fetchUrlSkill.execute(
      { url: "https://localcine.com.br" },
      ctx({ FIRECRAWL_API_KEY: "fc-x" }),
    )) as {
      markdown: string;
      title: string;
      url: string;
    };
    expect(out.title).toBe("Localcine");
    expect(out.markdown).toContain("Produtora audiovisual");
    expect(out.url).toBe("https://localcine.com.br");
  });

  it("errors clearly on cloud without an API key", async () => {
    await expect(fetchUrlSkill.execute({ url: "https://x.com" }, ctx({}))).rejects.toThrow(
      /FIRECRAWL/v,
    );
  });

  it("runs keyless against a self-hosted base URL", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(Response.json({ data: { markdown: "ok" }, success: true })),
    );
    globalThis.fetch = fetchMock;
    await fetchUrlSkill.execute(
      { url: "https://x.com" },
      ctx({ FIRECRAWL_BASE_URL: "http://localhost:3002" }),
    );
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe("http://localhost:3002/v2/scrape");
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });
});
