import { gateway, generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

import type { PrismaClient } from "@repo/db";

import { ingestGeneratedAsset } from "../soul/brand-asset";
import { applySoulUpdate } from "../soul/apply";

import { generateBrandImageBytes } from "./image-gen";
import { env } from "./env";
import { fetchAsset } from "./storage";

void env.AI_GATEWAY_API_KEY;

const partialSoulSchema = z.object({
  brandVoice: z.string().nullable(),
  differentiator: z.string().nullable(),
  location: z.string().nullable(),
  targetAudience: z.string().nullable(),
  whatYouDo: z.string().nullable(),
});

type AgentInput = {
  audioBytes?: Uint8Array;
  audioMime?: string;
  imageBytes: Array<{ assetId: string; bytes: Uint8Array; mimeType: string }>;
  text?: string;
};

type AssetSummary = { assetId: string; deduped: boolean; mimeType: string };

type ExistingAssetSummary = { assetId: string; metadata: unknown; mimeType: string };

type AgentResult = {
  generatedAssetIds: Array<string>;
  text: string;
  toolCallSummary: { extractSoul: number; generateBrandImage: number; labelBrandAsset: number };
  usage: { inputTokens: number; outputTokens: number };
};

const extractSoulToolInput = z.object({
  brandVoice: z.string().nullable(),
  differentiator: z.string().nullable(),
  location: z.string().nullable(),
  targetAudience: z.string().nullable(),
  whatYouDo: z.string().nullable(),
});

const generateBrandImageToolInput = z.object({
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3"]).default("1:1"),
  prompt: z.string().min(1).max(2000),
});

const labelBrandAssetToolInput = z.object({
  assetId: z.string().min(1),
  palette: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/iv)).min(1).max(8),
  styleDescriptors: z.array(z.string().min(1)).min(1).max(6),
  typography: z.enum(["serif", "sans", "script", "handwritten", "decorative", "unknown"]),
});

const AGENT_SYSTEM_TEMPLATE = `Você é um assistente onboarding de negócio. O dono fala com você por texto, áudio ou imagem em português brasileiro.

Você tem 3 ferramentas:
1) extractSoul — chame quando a mensagem trouxer informação sobre o negócio (5 campos: whatYouDo, targetAudience, differentiator, brandVoice, location).
2) generateBrandImage — chame APENAS quando o dono pedir explicitamente uma imagem ou criação visual. Máximo 1 chamada por mensagem. Passe o prompt descritivo e o aspectRatio desejado.
3) labelBrandAsset — chame UMA VEZ por assetId listado em "Novos assets nesta mensagem". Olhe a imagem correspondente e extraia palette (até 8 hex), styleDescriptors (até 6, em pt-BR), e typography.

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
- Se gerou imagem, confirme com entusiasmo e descreva brevemente o que foi criado.
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
    generateBrandImage: tool({
      description:
        "Gere uma imagem para o dono baseada no perfil do negócio (soul + brand assets). Use APENAS quando o dono pedir explicitamente. AT MOST 1 call por mensagem.",
      execute: async ({ aspectRatio, prompt }: z.infer<typeof generateBrandImageToolInput>) => {
        try {
          const refRows = await prisma.brandAsset.findMany({
            orderBy: { createdAt: "desc" },
            select: { metadata: true, mimeType: true, r2Key: true },
            take: 3,
            where: { orgId },
          });
          const uploadedRefs = refRows.filter((r: { metadata: unknown }) => {
            const meta = r.metadata as { source?: string } | null;
            return meta?.source !== "generated";
          });
          const fetchResults = await Promise.allSettled(
            uploadedRefs.map((row) => fetchAsset(row.r2Key).then((bytes) => ({ bytes, mimeType: row.mimeType }))),
          );
          const referenceImages = fetchResults
            .filter((r): r is PromiseFulfilledResult<{ bytes: Uint8Array; mimeType: string }> => r.status === "fulfilled")
            .map((r) => r.value);
          const fullPrompt = `${prompt}\n\nAspect ratio: ${aspectRatio}.`;
          const bytes = await generateBrandImageBytes({
            aspectRatio,
            prompt: fullPrompt,
            referenceImages,
          });
          const { assetId } = await ingestGeneratedAsset({
            bytes,
            mimeType: "image/png",
            orgId,
            prisma,
            prompt,
          });
          return { assetId, ok: true as const };
        } catch (error) {
          return { error: String(error), ok: false as const };
        }
      },
      inputSchema: generateBrandImageToolInput,
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

  const summary = { extractSoul: 0, generateBrandImage: 0, labelBrandAsset: 0 };
  for (const call of result.toolCalls) {
    const name = (call as { toolName: string }).toolName;
    if (name === "extractSoul") {
      summary.extractSoul += 1;
    } else if (name === "generateBrandImage") {
      summary.generateBrandImage += 1;
    } else if (name === "labelBrandAsset") {
      summary.labelBrandAsset += 1;
    }
  }

  const generatedAssetIds: Array<string> = [];
  for (const entry of (result.toolResults ?? []) as Array<{ result?: { assetId?: string; ok?: boolean }; toolName: string }>) {
    if (entry.toolName === "generateBrandImage" && entry.result?.ok === true && entry.result.assetId) {
      generatedAssetIds.push(entry.result.assetId);
    }
  }

  return {
    generatedAssetIds,
    text: result.text,
    toolCallSummary: summary,
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    },
  };
};

export { partialSoulSchema, runAgent };
export type { AgentInput, AgentResult, AssetSummary, ExistingAssetSummary };
