import { z } from "zod";

import type { SkillContext, UnknownSkill } from "#/skills/registry";

// Read a specific webpage as clean markdown via Firecrawl (https://firecrawl.dev).
// This is the "navigate to this site and read it" tool — pair it with webSearch
// (which finds URLs) so an agent can search then open the best results. Content
// is trimmed so the tool result stays bounded. Requires FIRECRAWL_API_KEY.

const fetchUrlInputSchema = z.object({
  url: z.string().url().describe("A URL completa da página a ler (ex: https://exemplo.com.br)."),
});

type FirecrawlResponse = {
  data?: { markdown?: string; metadata?: { sourceURL?: string; title?: string } };
  error?: string;
  success?: boolean;
};

const FIRECRAWL_CLOUD = "https://api.firecrawl.dev";
const CONTENT_MAX = 8000;

const fetchUrlSkill: UnknownSkill = {
  description:
    "Lê o conteúdo de uma página da web (texto em markdown) a partir da sua URL — use para analisar o site do cliente, de um concorrente, ou uma referência específica.",
  async execute(
    input: unknown,
    ctx: SkillContext,
  ): Promise<{ markdown: string; title: string; url: string }> {
    const { url } = fetchUrlInputSchema.parse(input);
    const apiKey = ctx.env.FIRECRAWL_API_KEY;
    const baseUrl = ctx.env.FIRECRAWL_BASE_URL ?? FIRECRAWL_CLOUD;
    // The cloud API requires a key; a self-hosted instance (custom base URL)
    // may run keyless. Only hard-fail for cloud-without-key.
    if (baseUrl === FIRECRAWL_CLOUD && !apiKey) {
      throw new Error(
        "Firecrawl não configurado — defina FIRECRAWL_API_KEY (cloud) ou FIRECRAWL_BASE_URL (instância self-hosted).",
      );
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }
    const res = await fetch(`${baseUrl}/v2/scrape`, {
      body: JSON.stringify({ formats: ["markdown"], onlyMainContent: true, url }),
      headers,
      method: "POST",
    });
    if (!res.ok) {
      throw new Error(`Firecrawl respondeu ${res.status}`);
    }

    const body = (await res.json()) as FirecrawlResponse;
    if (!body.success || !body.data?.markdown) {
      throw new Error(`Firecrawl não retornou conteúdo: ${body.error ?? "resposta vazia"}`);
    }
    return {
      markdown: body.data.markdown.slice(0, CONTENT_MAX),
      title: body.data.metadata?.title ?? url,
      url: body.data.metadata?.sourceURL ?? url,
    };
  },
  id: "fetchUrl",
  inputSchema: fetchUrlInputSchema,
};

export { fetchUrlSkill };
