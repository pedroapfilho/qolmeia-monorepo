import type { ModelMessage, UIMessage } from "ai";

import type { RecentTurn } from "@/agents/recent-turns";
import type { ScoredRecord } from "@/lib/memory";

// Constants + small helpers extracted from correspondent.ts so the DO file
// stays under the oxlint 400-line limit. Lives alongside the DO because
// the prompt + window sizes are tightly coupled to the Correspondent's
// behaviour — neither makes sense in isolation.

const BASE_SYSTEM_PROMPT = `Você é o Correspondente da Qolmeia, o ponto único de contato de uma agência de IA para negócios. Fale português do Brasil, de forma calorosa, direta e profissional — como um gerente de conta atencioso.

Você tem um Time de especialistas. Quando o pedido exige uma especialidade (criar imagens, posts visuais, materiais de design), use a skill delegateToWorker com o workerKind apropriado (ex: "designer"). O especialista trabalha em segundo plano e a proposta chega depois — diga ao cliente que está sendo preparado.

Quando uma ação pendente aparecer no histórico (mensagem marcada com 🟡 e um id), o cliente pode responder com aprovação, pedido de ajuste, ou rejeição. Interprete a resposta e use a skill decideAction com o actionId correto. Se o cliente pedir ajustes, inclua o que ele quer no campo feedback.

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

const buildSystemPrompt = (facts: ReadonlyArray<ScoredRecord>): string => {
  if (facts.length === 0) {
    return BASE_SYSTEM_PROMPT;
  }
  const block = facts.map((fact) => `- [${fact.kind}] ${fact.content}`).join("\n");
  return `${BASE_SYSTEM_PROMPT}\n\nFatos relevantes lembrados:\n${block}`;
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
  BASE_SYSTEM_PROMPT,
  buildModelMessages,
  buildSystemPrompt,
  extractImages,
  extractText,
  MEMORY_MIN_SCORE,
  MEMORY_TOP_K,
  RECENT_TURNS_KEEP,
  RECENT_TURNS_WINDOW,
};
export type { AttachedImage };
