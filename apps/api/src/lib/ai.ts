import { gateway, generateObject } from "ai";
import { z } from "zod";

import { env } from "./env";

void env.AI_GATEWAY_API_KEY;

const partialSoulSchema = z.object({
  brandVoice: z.string().nullable(),
  differentiator: z.string().nullable(),
  location: z.string().nullable(),
  targetAudience: z.string().nullable(),
  whatYouDo: z.string().nullable(),
});

const interactionSchema = z.object({
  partial: partialSoulSchema,
  reply: z.string().min(1).max(500),
});

type PartialSoul = z.infer<typeof partialSoulSchema>;

type AudioInput = { bytes: Uint8Array; kind: "audio"; mediaType: string };
type TextInput = { kind: "text"; text: string };
type Input = AudioInput | TextInput;

type Usage = { inputTokens: number; outputTokens: number };

const SYSTEM_PROMPT_TEMPLATE = `Você é um assistente onboarding de negócio. O dono fala com você por texto ou áudio em português brasileiro.

Sua missão é dupla, em UMA resposta:
1) EXTRAIR (campo \`partial\`) qualquer informação sobre o negócio nas 5 áreas:
   - whatYouDo: o que vocês fazem e entregam
   - targetAudience: seu público-alvo
   - differentiator: o que diferencia vocês dos concorrentes
   - brandVoice: tom de voz / personalidade da marca
   - location: cidade / região de atuação
2) RESPONDER (campo \`reply\`) em pt-BR, 1-3 frases (máx 500 caracteres).

Perfil atual:
{{currentContext}}

Regras de \`partial\`:
- Atualize SOMENTE campos que a mensagem deixa explícitos.
- Preserve correções ("na verdade meu público é X" → targetAudience: X).
- Campos não mencionados ficam null.

Regras de \`reply\`:
- Se \`brandVoice\` está preenchido no perfil, adote esse tom na resposta. Se não, use um tom caloroso e profissional padrão.
- Se a mensagem trouxe informação nova: agradeça citando o que entendeu e peça naturalmente um campo que ainda falta.
- Se o perfil está completo e a pessoa só conversa: responda usando APENAS o que está no perfil. Se ela perguntar algo que não está no perfil, diga que ainda não sabe e ofereça registrar.
- Se a mensagem for fora do tema (piadas, notícias, código, conhecimento geral): redirecione com gentileza para o negócio.
- Nunca invente fatos sobre o negócio. Se não souber, pergunte.`;

const renderSystemPrompt = (currentContext: string): string =>
  SYSTEM_PROMPT_TEMPLATE.replace(
    "{{currentContext}}",
    currentContext.length > 0 ? currentContext : "(perfil vazio)",
  );

const toUserContent = (input: Input) => {
  if (input.kind === "audio") {
    return [{ data: input.bytes, mediaType: input.mediaType, type: "file" as const }];
  }
  return [{ text: input.text, type: "text" as const }];
};

const extractSoul = async (
  input: Input,
  currentContext: string,
): Promise<{ partial: PartialSoul; reply: string; usage: Usage }> => {
  const result = await generateObject({
    messages: [{ content: toUserContent(input), role: "user" }],
    model: gateway("google/gemini-2.5-flash"),
    schema: interactionSchema,
    system: renderSystemPrompt(currentContext),
    temperature: 0.2,
  });

  return {
    partial: result.object.partial,
    reply: result.object.reply,
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    },
  };
};

export { extractSoul, partialSoulSchema };
export type { AudioInput, Input, PartialSoul, TextInput, Usage };
