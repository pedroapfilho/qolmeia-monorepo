import type { ModelMessage, UIMessage } from "ai";

import type { RecentTurn } from "@/agents/recent-turns";
import {
  BRIEF_FIELD_LABELS,
  type BriefCompleteness,
  briefCompleteness,
  type BriefFieldId,
  type CompanyBrief,
  parseBrief,
} from "@/lib/company-brief";
import type { ScoredRecord } from "@/lib/memory";

// Constants + small helpers extracted from correspondent.ts so the DO file
// stays under the oxlint 400-line limit. Lives alongside the DO because
// the prompt + window sizes are tightly coupled to the Correspondent's
// behaviour — neither makes sense in isolation.

const BASE_SYSTEM_PROMPT = `Você é o Correspondente da Qolmeia, o ponto único de contato de uma agência de IA para negócios. Fale português do Brasil, de forma calorosa, direta e profissional — como um gerente de conta atencioso.

Você tem um Time de especialistas. Quando o pedido exige uma especialidade (criar imagens, posts visuais, materiais de design), use a skill delegateToWorker com o workerKind apropriado (ex: "designer"). Diga ao cliente que o especialista vai cuidar disso e que você avisa quando o resultado estiver pronto — não prometa prazo específico. O cliente NUNCA precisa aprovar nada: aprovações são feitas internamente pela equipe da Qolmeia, e a entrega final aparece no chat automaticamente quando estiver pronta.

Ao mostrar imagens geradas, inclua a URL no formato markdown ![descrição curta](URL) para que apareça inline no chat.`;

const RECENT_TURNS_WINDOW = 12;
const MEMORY_TOP_K = 4;
const MEMORY_MIN_SCORE = 0.3;
const RECENT_TURNS_KEEP = 100;

const extractText = (message: UIMessage): string =>
  message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();

type AttachedImage = { mediaType: string; url: string };

const extractImages = (message: UIMessage): ReadonlyArray<AttachedImage> =>
  message.parts.flatMap((part) => {
    if (part.type !== "file") {
      return [];
    }
    const mediaType = part.mediaType ?? "";
    if (!mediaType.startsWith("image/")) {
      return [];
    }
    return [{ mediaType, url: part.url }];
  });

const BRIEF_FIELD_VALUE: Record<BriefFieldId, (brief: Partial<CompanyBrief>) => string> = {
  audience: (brief) => brief.audience ?? "",
  "brand.palette": (brief) => brief.brand?.palette ?? "",
  "brand.references": (brief) => brief.brand?.references ?? "",
  "brand.voice": (brief) => brief.brand?.voice ?? "",
  channels: (brief) => brief.channels?.join(", ") ?? "",
  industry: (brief) => brief.industry ?? "",
  primaryGoal: (brief) => brief.primaryGoal ?? "",
};

const briefFieldValue = (brief: Partial<CompanyBrief>, field: BriefFieldId): string =>
  BRIEF_FIELD_VALUE[field](brief);

// Brief block injected each turn: lists known fields (so the model never
// re-asks them) and, while incomplete, tells it to ask about ONE missing field.
const buildBriefBlock = (
  brief: Partial<CompanyBrief>,
  completeness: BriefCompleteness,
  brandAssetCount: number,
): string => {
  const known = completeness.filled
    .map((field) => `- ${BRIEF_FIELD_LABELS[field]}: ${briefFieldValue(brief, field)}`)
    .join("\n");
  const knownSection =
    known.length > 0
      ? `O que você já sabe sobre a empresa do cliente:\n${known}`
      : "Você ainda não sabe nada sobre a empresa do cliente.";
  const brandLine =
    brandAssetCount > 0
      ? `\nO cliente enviou ${brandAssetCount} referência(s) de marca (logo/posts/exemplos); o Designer as usa automaticamente ao gerar imagens.`
      : '\nO cliente ainda não enviou referências de marca — sugira que ele adicione o logo e exemplos em "Minha empresa" para deixar as entregas mais alinhadas.';

  if (completeness.isComplete) {
    return `## Brief da empresa\n${knownSection}${brandLine}\n\nO brief está completo — não pergunte mais sobre os dados básicos da empresa; use o que já sabe.`;
  }

  const missing = completeness.missing.map((field) => BRIEF_FIELD_LABELS[field]).join(", ");
  return `## Brief da empresa\n${knownSection}${brandLine}\n\nVocê ainda não conhece: ${missing}.\nEnquanto o brief não estiver completo, encaixe de forma natural UMA pergunta curta sobre UM desses itens ao final da sua resposta — sem bloquear nem adiar o pedido do cliente. Assim que aprender algo novo sobre a empresa, chame a skill extractBrief para registrar. Quando tudo estiver preenchido, pare de perguntar.`;
};

type BriefContext = {
  brandAssetCount: number;
  brief: Partial<CompanyBrief>;
  completeness: BriefCompleteness;
};

// Reads the brief + brand-asset count fresh from D1 so manual edits on /empresa
// and facts the agent learned in chat both feed the prompt immediately.
const loadBriefContext = async (env: Env, companyId: string): Promise<BriefContext> => {
  const row = await env.DB.prepare("SELECT brief FROM company WHERE id = ?")
    .bind(companyId)
    .first<{ brief: string | null }>();
  const brandRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM asset WHERE company_id = ? AND kind = 'brand_asset'",
  )
    .bind(companyId)
    .first<{ n: number }>();
  const brief = parseBrief(row?.brief);
  return {
    brandAssetCount: brandRow?.n ?? 0,
    brief,
    completeness: briefCompleteness(brief),
  };
};

const buildSystemPrompt = (
  facts: ReadonlyArray<ScoredRecord>,
  briefContext?: BriefContext,
): string => {
  let prompt = BASE_SYSTEM_PROMPT;
  if (briefContext) {
    prompt += `\n\n${buildBriefBlock(briefContext.brief, briefContext.completeness, briefContext.brandAssetCount)}`;
  }
  if (facts.length > 0) {
    const block = facts.map((fact) => `- [${fact.kind}] ${fact.content}`).join("\n");
    prompt += `\n\nFatos relevantes lembrados:\n${block}`;
  }
  return prompt;
};

// Build the ModelMessage[] the Correspondent sends to the model. The recent
// buffer is plain text; when the user attached images on this turn we swap
// the last user turn's content for a multi-part (text+image) payload so the
// vision-capable model can actually see them.
const buildModelMessages = (
  turns: ReadonlyArray<RecentTurn>,
  options: { userImages: ReadonlyArray<AttachedImage>; userText: string },
): Array<ModelMessage> => {
  const messages: Array<ModelMessage> = turns.map((turn) => ({
    content: turn.content,
    role: turn.role === "user" ? "user" : "assistant",
  }));
  if (options.userImages.length === 0 || messages.length === 0) {
    return messages;
  }
  const last = messages.at(-1);
  if (last?.role !== "user") {
    return messages;
  }
  messages[messages.length - 1] = {
    content: [
      { text: options.userText || "(sem texto)", type: "text" },
      ...options.userImages.map((img) => ({
        image: new URL(img.url),
        mediaType: img.mediaType,
        type: "image" as const,
      })),
    ],
    role: "user",
  };
  return messages;
};

export {
  buildModelMessages,
  buildSystemPrompt,
  extractImages,
  extractText,
  loadBriefContext,
  MEMORY_MIN_SCORE,
  MEMORY_TOP_K,
  RECENT_TURNS_KEEP,
  RECENT_TURNS_WINDOW,
};
export type { AttachedImage, BriefContext };
