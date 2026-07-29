import { z } from "zod";

import type { SkillContext, UnknownSkill } from "#/skills/registry";

const fetchUrlInputSchema = z.object({
  url: z.url().describe("A URL completa da página a ler (ex: https://exemplo.com.br)."),
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
    "Lê o conteúdo de uma página da web (texto em markdown) a partir da sua URL. Use para analisar o site do cliente, de um concorrente, ou uma referência específica.",
  async execute(
    input: unknown,
    ctx: SkillContext,
  ): Promise<{ markdown: string; title: string; url: string }> {
    const { url } = fetchUrlInputSchema.parse(input);
    const apiKey = ctx.env.FIRECRAWL_API_KEY;
    const hasApiKey = apiKey !== undefined && apiKey !== "";
    const baseUrl = ctx.env.FIRECRAWL_BASE_URL ?? FIRECRAWL_CLOUD;
    if (baseUrl === FIRECRAWL_CLOUD && !hasApiKey) {
      throw new Error(
        "Firecrawl não configurado: defina FIRECRAWL_API_KEY (cloud) ou FIRECRAWL_BASE_URL (instância self-hosted).",
      );
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (hasApiKey) {
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

    const body = await res.json<FirecrawlResponse>();
    const data = body.data;
    const markdown = data?.markdown;
    if (body.success !== true || data === undefined || markdown === undefined || markdown === "") {
      throw new Error(`Firecrawl não retornou conteúdo: ${body.error ?? "resposta vazia"}`);
    }
    return {
      markdown: markdown.slice(0, CONTENT_MAX),
      title: data.metadata?.title ?? url,
      url: data.metadata?.sourceURL ?? url,
    };
  },
  id: "fetchUrl",
  inputSchema: fetchUrlInputSchema,
};

export { fetchUrlSkill };
