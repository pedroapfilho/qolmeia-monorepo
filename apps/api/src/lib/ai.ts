import { gateway, generateObject, generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

import type { PrismaClient } from "@repo/db";

import { applySoulUpdate } from "../soul/apply";

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

type AgentInput = {
  audioBytes?: Uint8Array;
  audioMime?: string;
  imageBytes: Array<{ assetId: string; bytes: Uint8Array; mimeType: string }>;
  text?: string;
};

type AssetSummary = { assetId: string; deduped: boolean; mimeType: string };

type ExistingAssetSummary = { assetId: string; metadata: unknown; mimeType: string };

type AgentResult = {
  text: string;
  toolCallSummary: { extractSoul: number; labelBrandAsset: number };
  usage: { inputTokens: number; outputTokens: number };
};

const extractSoulToolInput = z.object({
  brandVoice: z.string().nullable(),
  differentiator: z.string().nullable(),
  location: z.string().nullable(),
  targetAudience: z.string().nullable(),
  whatYouDo: z.string().nullable(),
});

const labelBrandAssetToolInput = z.object({
  assetId: z.string().min(1),
  palette: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/iv)).min(1).max(8),
  styleDescriptors: z.array(z.string().min(1)).min(1).max(6),
  typography: z.enum(["serif", "sans", "script", "handwritten", "decorative", "unknown"]),
});

const AGENT_SYSTEM_TEMPLATE = `Você é um assistente onboarding de negócio. O dono fala com você por texto, áudio ou imagem em português brasileiro.

Você tem 2 ferramentas:
1) extractSoul — chame quando a mensagem trouxer informação sobre o negócio (5 campos: whatYouDo, targetAudience, differentiator, brandVoice, location).
2) labelBrandAsset — chame UMA VEZ por assetId listado em "Novos assets nesta mensagem". Olhe a imagem correspondente e extraia palette (até 8 hex), styleDescriptors (até 6, em pt-BR), e typography.

Perfil atual:
{{currentContext}}

Assets de marca já anotados:
{{existingAssetsBlock}}

Novos assets nesta mensagem (já salvos no R2, aguardando label):
{{newAssetsBlock}}

Imagens grandes ignoradas (> 20 MB): {{oversizeCount}}

Depois de chamar as ferramentas necessárias, escreva UMA resposta em pt-BR (1-3 frases, máx 500 caracteres) — não chame ferramentas dentro do texto da resposta:
- Se brandVoice está preenchido no perfil, adote esse tom.
- Acknowledge cada asset novo citando o que viu (cores, estilo).
- Se houver oversize, mencione: "Alguma imagem não coube; tenta menor?".
- Se a mensagem trouxer info do perfil, agradeça e peça naturalmente um campo soul que ainda falte.
- Se o perfil já está completo, responda usando APENAS o perfil + assets conhecidos.
- Se for fora do tema, redirecione com gentileza.
- Nunca invente fatos.`;

const renderAssetsBlock = (assets: ReadonlyArray<AssetSummary>): string => {
  if (assets.length === 0) {
    return "(nenhum)";
  }
  return assets
    .map((a) => `- assetId: ${a.assetId}, mimeType: ${a.mimeType}${a.deduped ? " (já estava no perfil — NÃO labelar)" : ""}`)
    .join("\n");
};

const renderExistingBlock = (assets: ReadonlyArray<ExistingAssetSummary>): string => {
  if (assets.length === 0) {
    return "(nenhum)";
  }
  return assets
    .map((a) => `- assetId: ${a.assetId}, mimeType: ${a.mimeType}, metadata: ${JSON.stringify(a.metadata)}`)
    .join("\n");
};

const renderAgentSystem = (args: {
  currentContext: string;
  existingAssets: ReadonlyArray<ExistingAssetSummary>;
  newAssets: ReadonlyArray<AssetSummary>;
  oversizeCount: number;
}): string =>
  AGENT_SYSTEM_TEMPLATE.replace(
    "{{currentContext}}",
    args.currentContext.length > 0 ? args.currentContext : "(perfil vazio)",
  )
    .replace("{{existingAssetsBlock}}", renderExistingBlock(args.existingAssets))
    .replace("{{newAssetsBlock}}", renderAssetsBlock(args.newAssets))
    .replace("{{oversizeCount}}", String(args.oversizeCount));

const buildAgentUserContent = (input: AgentInput) => {
  const parts: Array<
    | { data: Uint8Array; mediaType: string; type: "file" }
    | { text: string; type: "text" }
  > = [];
  if (input.audioBytes) {
    parts.push({ data: input.audioBytes, mediaType: input.audioMime ?? "audio/ogg", type: "file" });
  }
  for (const img of input.imageBytes) {
    parts.push({ data: img.bytes, mediaType: img.mimeType, type: "file" });
  }
  if (input.text && input.text.length > 0) {
    parts.push({ text: input.text, type: "text" });
  }
  if (parts.length === 0) {
    parts.push({ text: "(sem conteúdo)", type: "text" });
  }
  return parts;
};

const runAgent = async (args: {
  currentContext: string;
  existingAssets: ReadonlyArray<ExistingAssetSummary>;
  input: AgentInput;
  newAssets: ReadonlyArray<AssetSummary>;
  orgId: string;
  oversizeCount: number;
  prisma: PrismaClient;
}): Promise<AgentResult> => {
  const { orgId, prisma } = args;

  const tools = {
    extractSoul: tool({
      description:
        "Atualize os 5 campos do perfil do dono. Use SOMENTE quando a mensagem trouxer info ou correção. Campos não mencionados ficam null.",
      execute: async (partial) => {
        const out = await applySoulUpdate(orgId, partial, prisma);
        return { capturedFields: out.capturedFields };
      },
      inputSchema: extractSoulToolInput,
    }),
    labelBrandAsset: tool({
      description:
        "Anote metadados visuais de UM asset que o dono enviou. Use um assetId de 'Novos assets'. Chame uma vez por assetId.",
      execute: async (toolArgs) => {
        await prisma.brandAsset.update({
          data: {
            metadata: {
              palette: toolArgs.palette,
              styleDescriptors: toolArgs.styleDescriptors,
              typography: toolArgs.typography,
            },
          },
          where: { id: toolArgs.assetId },
        });
        return { ok: true };
      },
      inputSchema: labelBrandAssetToolInput,
    }),
  };

  const result = await generateText({
    messages: [{ content: buildAgentUserContent(args.input), role: "user" }],
    model: gateway("google/gemini-2.5-flash"),
    stopWhen: stepCountIs(5),
    system: renderAgentSystem({
      currentContext: args.currentContext,
      existingAssets: args.existingAssets,
      newAssets: args.newAssets,
      oversizeCount: args.oversizeCount,
    }),
    temperature: 0.2,
    tools,
  });

  const summary = { extractSoul: 0, labelBrandAsset: 0 };
  for (const call of result.toolCalls) {
    const name = call.toolName;
    if (name === "extractSoul") {
      summary.extractSoul += 1;
    } else if (name === "labelBrandAsset") {
      summary.labelBrandAsset += 1;
    }
  }

  return {
    text: result.text,
    toolCallSummary: summary,
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    },
  };
};

export { extractSoul, partialSoulSchema, runAgent };
export type { AgentInput, AgentResult, AssetSummary, AudioInput, ExistingAssetSummary, Input, PartialSoul, TextInput, Usage };
