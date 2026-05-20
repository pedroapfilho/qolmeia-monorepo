import { z } from "zod";

import { defineSkill } from "./types";

const searchKnowledgeInput = z.object({
  limit: z.number().int().min(1).max(20).default(5),
  query: z.string().min(1).max(500),
});

type SearchKnowledgeInput = z.infer<typeof searchKnowledgeInput>;

type DocSummary = {
  id: string;
  summary: string;
  tags: ReadonlyArray<string>;
  title: string;
};

type SearchKnowledgeOutput = {
  matches: ReadonlyArray<DocSummary>;
  ok: true;
};

const searchKnowledgeSkill = defineSkill<SearchKnowledgeInput, SearchKnowledgeOutput>({
  description:
    "Pesquise documentos de conhecimento da empresa (perfis de marca, políticas, FAQs, exemplos). Use quando precisar de informação detalhada que não está no perfil resumido. Retorna até 'limit' documentos com título, resumo e tags — use readKnowledgeDoc para ler o conteúdo completo de um documento específico.",
  displayName: "Search Knowledge",
  execute: async ({ limit, query }, ctx) => {
    // Simple keyword match: title OR summary contains the query (case-insensitive).
    // Future: full-text or embeddings via pgvector.
    const docs = await ctx.prisma.knowledgeDoc.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, summary: true, tags: true, title: true },
      take: limit,
      where: {
        OR: [
          { summary: { contains: query, mode: "insensitive" } },
          { tags: { has: query.toLowerCase() } },
          { title: { contains: query, mode: "insensitive" } },
        ],
        orgId: ctx.orgId,
      },
    });
    return { matches: docs, ok: true };
  },
  id: "searchKnowledge",
  inputSchema: searchKnowledgeInput,
  requiredConnectorTypes: [],
  requiresApprovalDefault: false,
});

export { searchKnowledgeSkill };
export type { SearchKnowledgeInput, SearchKnowledgeOutput };
