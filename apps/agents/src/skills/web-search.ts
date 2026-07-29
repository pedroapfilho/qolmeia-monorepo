import { z } from "zod";

import type { SkillContext, UnknownSkill } from "#/skills/registry";

const webSearchInputSchema = z.object({
  numResults: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Quantos resultados retornar. Default: 5."),
  query: z.string().min(1).describe("O que buscar na web, em uma frase clara em pt-BR."),
});

type ExaResult = {
  author?: string;
  publishedDate?: string;
  text?: string;
  title?: string;
  url: string;
};

type WebSearchResult = {
  results: ReadonlyArray<{
    publishedDate: string | null;
    snippet: string;
    title: string;
    url: string;
  }>;
};

const EXA_ENDPOINT = "https://api.exa.ai/search";
const SNIPPET_MAX = 800;

const webSearchSkill: UnknownSkill = {
  description:
    "Busca na web (notícias, tendências, concorrentes, fatos atuais) e retorna trechos com as fontes. Use para fundamentar conteúdo em informação verificável e recente.",
  async execute(input: unknown, ctx: SkillContext): Promise<WebSearchResult> {
    const { numResults, query } = webSearchInputSchema.parse(input);
    const apiKey = ctx.env.EXA_API_KEY;
    if (apiKey === undefined || apiKey === "") {
      throw new Error("EXA_API_KEY não configurada; busca na web indisponível.");
    }

    const res = await fetch(EXA_ENDPOINT, {
      body: JSON.stringify({
        contents: { text: { maxCharacters: SNIPPET_MAX } },
        numResults: numResults ?? 5,
        query,
        type: "auto",
      }),
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      method: "POST",
    });
    if (!res.ok) {
      throw new Error(`Exa respondeu ${res.status}`);
    }

    const data = await res.json<{ results?: ReadonlyArray<ExaResult> }>();
    return {
      results: (data.results ?? []).map((r) => ({
        publishedDate: r.publishedDate ?? null,
        snippet: (r.text ?? "").slice(0, SNIPPET_MAX),
        title: r.title ?? r.url,
        url: r.url,
      })),
    };
  },
  id: "webSearch",
  inputSchema: webSearchInputSchema,
};

export { webSearchSkill };
