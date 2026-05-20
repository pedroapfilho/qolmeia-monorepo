import { gateway, generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

import type { PrismaClient } from "@repo/db";

import { ingestGeneratedAsset } from "../soul/brand-asset";
import { applySoulUpdate } from "../soul/apply";

import { generateBrandImageBytes } from "./image-gen";
import { env } from "./env";
import { logger } from "./logger";

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
          // Read recent uploaded assets' metadata and fold their palette/style
          // into the text prompt. gpt-image-1 takes text only, so we describe
          // the brand instead of passing image bytes.
          const refRows = await prisma.brandAsset.findMany({
            orderBy: { createdAt: "desc" },
            select: { metadata: true },
            take: 3,
            where: { orgId },
          });
          const palette = new Set<string>();
          const styles = new Set<string>();
          let typography: string | undefined;
          for (const row of refRows) {
            const meta = row.metadata as {
              palette?: Array<string>;
              source?: string;
              styleDescriptors?: Array<string>;
              typography?: string;
            } | null;
            if (!meta || meta.source === "generated") {
              continue;
            }
            for (const hex of meta.palette ?? []) {
              palette.add(hex);
            }
            for (const s of meta.styleDescriptors ?? []) {
              styles.add(s);
            }
            if (!typography && meta.typography && meta.typography !== "unknown") {
              typography = meta.typography;
            }
          }

          const brandLines: Array<string> = [];
          if (palette.size > 0) {
            brandLines.push(`Brand palette: ${[...palette].join(", ")}.`);
          }
          if (styles.size > 0) {
            brandLines.push(`Brand style: ${[...styles].join(", ")}.`);
          }
          if (typography) {
            brandLines.push(`Typography hint: ${typography}.`);
          }
          const fullPrompt = `${prompt}\n\nAspect ratio: ${aspectRatio}.${brandLines.length > 0 ? `\n\n${brandLines.join(" ")}` : ""}`;

          const bytes = await generateBrandImageBytes({ aspectRatio, prompt: fullPrompt });
          const { assetId } = await ingestGeneratedAsset({
            bytes,
            mimeType: "image/png",
            orgId,
            prisma,
            prompt,
          });
          return { assetId, ok: true as const };
        } catch (error) {
          const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          logger.error({ error: message, orgId }, "generateBrandImage.failed");
          return { error: message, ok: false as const };
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

  // Aggregate tool calls/results across ALL agent steps. AI SDK v6's
  // top-level result.toolCalls / result.toolResults only contain the LAST
  // step's entries — when the model calls a tool in step 1 then writes text
  // in step 2, those arrays are empty.
  //
  // The actual per-step data lives in step.content[] as discriminated items
  // ({ type: "tool-call" | "tool-result", toolName, input, output }). Tool
  // return values are under `output`, not `result`. We walk content for the
  // truth.
  type StepContentItem = {
    output?: { assetId?: string; ok?: boolean };
    toolName?: string;
    type: string;
  };
  type StepShape = { content?: Array<StepContentItem> };
  const steps = ((result as { steps?: Array<StepShape> }).steps ?? []);

  const summary = { extractSoul: 0, generateBrandImage: 0, labelBrandAsset: 0 };
  const generatedAssetIds: Array<string> = [];
  for (const step of steps) {
    for (const item of step.content ?? []) {
      if (item.type === "tool-call") {
        if (item.toolName === "extractSoul") {
          summary.extractSoul += 1;
        } else if (item.toolName === "generateBrandImage") {
          summary.generateBrandImage += 1;
        } else if (item.toolName === "labelBrandAsset") {
          summary.labelBrandAsset += 1;
        }
        continue;
      }
      if (
        item.type === "tool-result" &&
        item.toolName === "generateBrandImage" &&
        item.output?.ok === true &&
        item.output.assetId
      ) {
        generatedAssetIds.push(item.output.assetId);
      }
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
