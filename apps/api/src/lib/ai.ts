import type { PrismaClient } from "@repo/db";
import { gateway, generateText, stepCountIs, tool } from "ai";

import { ALL_SKILLS } from "../agents/skills/registry";
import type { SkillContext } from "../agents/skills/types";

import { env } from "./env";

void env.AI_GATEWAY_API_KEY;

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
    .map(
      (a) =>
        `- assetId: ${a.assetId}, mimeType: ${a.mimeType}${a.deduped ? " (já estava no perfil — NÃO labelar)" : ""}`,
    )
    .join("\n");
};

const renderExistingBlock = (assets: ReadonlyArray<ExistingAssetSummary>): string => {
  if (assets.length === 0) {
    return "(nenhum)";
  }
  return assets
    .map(
      (a) =>
        `- assetId: ${a.assetId}, mimeType: ${a.mimeType}, metadata: ${JSON.stringify(a.metadata)}`,
    )
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
    { data: Uint8Array; mediaType: string; type: "file" } | { text: string; type: "text" }
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

  const ctx: SkillContext = { orgId, prisma };
  const tools = Object.fromEntries(
    ALL_SKILLS.map((skill) => [
      skill.id,
      tool({
        description: skill.description,
        execute: (input: unknown) => skill.execute(input, ctx),
        inputSchema: skill.inputSchema,
      }),
    ]),
  );

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
  const steps = (result as { steps?: Array<StepShape> }).steps ?? [];

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

export { runAgent };
export type { AgentInput, AgentResult, AssetSummary, ExistingAssetSummary };
