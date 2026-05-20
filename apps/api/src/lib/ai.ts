import { gateway, generateObject } from "ai";
import { z } from "zod";

import { env } from "./env";

// Ensure AI_GATEWAY_API_KEY is validated at startup before any call is made.
void env.AI_GATEWAY_API_KEY;

const partialSoulSchema = z.object({
  brandVoice: z.string().nullable(),
  differentiator: z.string().nullable(),
  location: z.string().nullable(),
  targetAudience: z.string().nullable(),
  whatYouDo: z.string().nullable(),
});

type PartialSoul = z.infer<typeof partialSoulSchema>;

type AudioInput = { bytes: Uint8Array; kind: "audio"; mediaType: string };
type TextInput = { kind: "text"; text: string };
type Input = AudioInput | TextInput;

type Usage = { inputTokens: number; outputTokens: number };

const SYSTEM_PROMPT_TEMPLATE = `Você extrai informações de negócio do dono.
Aqui está o perfil atual:
{{currentContext}}
A mensagem do usuário pode estar em áudio ou texto, em português brasileiro.

Campos a extrair:
- whatYouDo: o que vocês fazem e entregam
- targetAudience: seu público-alvo
- differentiator: o que diferencia vocês dos concorrentes
- brandVoice: tom de voz / personalidade da marca
- location: cidade / região de atuação

Atualize SOMENTE os campos que a mensagem deixa explícitos. Preserve correções (ex.: "na verdade meu público é X"). Não invente; deixe campos não mencionados como null.`;

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
): Promise<{ partial: PartialSoul; usage: Usage }> => {
  const result = await generateObject({
    messages: [{ content: toUserContent(input), role: "user" }],
    model: gateway("google/gemini-2.5-flash"),
    schema: partialSoulSchema,
    system: renderSystemPrompt(currentContext),
    temperature: 0.2,
  });

  return {
    partial: result.object,
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    },
  };
};

export { extractSoul, partialSoulSchema };
export type { AudioInput, Input, PartialSoul, TextInput, Usage };
