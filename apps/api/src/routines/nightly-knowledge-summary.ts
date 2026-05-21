import type { RoutineDefinition } from "./types";

// Reads the maxDocs config override, defaulting to 5. Defensive: a malformed
// config (string, negative, NaN) falls back to the default instead of
// crashing the worker.
const resolveMaxDocs = (config: unknown): number => {
  if (typeof config !== "object" || config === null) {
    return 5;
  }
  const value = (config as { maxDocs?: unknown }).maxDocs;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 5;
  }
  return Math.floor(value);
};

const nightlyKnowledgeSummary: RoutineDefinition = {
  buildPrompt: async (config, ctx) => {
    const maxDocs = resolveMaxDocs(config);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const docs = await ctx.prisma.knowledgeDoc.findMany({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, summary: true, tags: true, title: true },
      take: maxDocs,
      where: { createdAt: { gte: since }, orgId: ctx.orgId },
    });

    if (docs.length === 0) {
      return [
        "Resuma para o dono o que aconteceu no negócio nas últimas 24h.",
        "",
        "Nenhum documento novo foi adicionado ao conhecimento neste período.",
        "Responda em pt-BR, 1-3 frases, tom acolhedor.",
      ].join("\n");
    }

    const lines = docs.map((doc, idx) => {
      const tagBlock = doc.tags.length > 0 ? ` [${doc.tags.join(", ")}]` : "";
      return `${idx + 1}. ${doc.title}${tagBlock}\n   ${doc.summary}`;
    });

    return [
      `Resuma para o dono os ${docs.length} documento(s) adicionados ao conhecimento do negócio nas últimas 24h:`,
      "",
      ...lines,
      "",
      "Escreva 1-3 frases em pt-BR, tom acolhedor, destacando o que mudou ou pode impactar a operação.",
    ].join("\n");
  },
  defaultAgentTemplate: "controller",
  defaultConfig: { maxDocs: 5 },
  // 03:00 every day in the org's timezone (default America/Sao_Paulo).
  defaultSchedule: "0 3 * * *",
  description:
    "Toda noite às 3h, resume os documentos adicionados ao conhecimento nas últimas 24h e envia um digest para o dono.",
  name: "nightly-knowledge-summary",
};

export { nightlyKnowledgeSummary };
