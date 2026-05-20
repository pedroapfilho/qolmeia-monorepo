import { gateway, generateText, stepCountIs, tool } from "ai";

import type {
  AgentDispatchArgs,
  AgentRunResult,
  AssetSummary,
  ExistingAssetSummary,
} from "./dispatcher";
import { ALL_SKILLS, findSkillById } from "./skills/registry";
import type { Skill, SkillContext } from "./skills/types";
import { findTemplateBySlug } from "./templates/registry";

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

const renderSystemPrompt = (
  template: string,
  args: {
    currentContext: string;
    existingAssets: ReadonlyArray<ExistingAssetSummary>;
    newAssets: ReadonlyArray<AssetSummary>;
    oversizeCount: number;
  },
): string =>
  template
    .replace(
      "{{currentContext}}",
      args.currentContext.length > 0 ? args.currentContext : "(perfil vazio)",
    )
    .replace("{{existingAssetsBlock}}", renderExistingBlock(args.existingAssets))
    .replace("{{newAssetsBlock}}", renderAssetsBlock(args.newAssets))
    .replace("{{oversizeCount}}", String(args.oversizeCount));

const buildUserContent = (input: AgentDispatchArgs["input"]) => {
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

const resolveEnabledSkills = (
  enabledSkillIds: unknown,
  templateDefaultSkillIds: ReadonlyArray<string>,
): ReadonlyArray<Skill<unknown, unknown>> => {
  // enabledSkillIds is Json? on AgentInstance: null = use template defaults,
  // [] = explicit empty (no skills), [...] = explicit override.
  const ids: ReadonlyArray<string> =
    enabledSkillIds === null || enabledSkillIds === undefined
      ? templateDefaultSkillIds
      : (enabledSkillIds as ReadonlyArray<string>);
  const resolved: Array<Skill<unknown, unknown>> = [];
  for (const id of ids) {
    const skill = findSkillById(id);
    if (skill) {
      resolved.push(skill);
    }
  }
  return resolved;
};

const runAgentInstance = async (args: AgentDispatchArgs): Promise<AgentRunResult> => {
  const { agentInstance, currentContext, existingAssets, input, newAssets, oversizeCount, prisma } =
    args;

  const template = findTemplateBySlug(agentInstance.templateSlug);
  if (!template) {
    throw new Error(`Unknown agent template: ${agentInstance.templateSlug}`);
  }

  const skills = resolveEnabledSkills(
    agentInstance.enabledSkillIds,
    template.defaultEnabledSkillIds,
  );

  const ctx: SkillContext = {
    agentInstanceId: agentInstance.id,
    dispatcher: args.dispatcher,
    orgId: agentInstance.orgId,
    parentRunArgs: args,
    prisma,
  };
  const tools = Object.fromEntries(
    skills.map((skill) => [
      skill.id,
      tool({
        description: skill.description,
        execute: (toolInput: unknown) => skill.execute(toolInput, ctx),
        inputSchema: skill.inputSchema,
      }),
    ]),
  );

  const baseSystem = renderSystemPrompt(template.defaultSystemPrompt, {
    currentContext,
    existingAssets,
    newAssets,
    oversizeCount,
  });
  const system =
    agentInstance.mission.length > 0
      ? `${baseSystem}\n\nMissão deste agente:\n${agentInstance.mission}`
      : baseSystem;

  const result = await generateText({
    messages: [{ content: buildUserContent(input), role: "user" }],
    model: gateway("google/gemini-2.5-flash"),
    stopWhen: stepCountIs(5),
    system,
    temperature: 0.2,
    tools,
  });

  // Aggregate tool calls/results across ALL agent steps. AI SDK v6's
  // top-level result.toolCalls / result.toolResults only contain the LAST
  // step's entries — when the model calls a tool in step 1 then writes text
  // in step 2, those arrays are empty. The actual per-step data lives in
  // step.content[] as discriminated items. Tool return values are under
  // `output`, not `result`.
  type StepContentItem = {
    output?: {
      assetId?: string;
      generatedAssetIds?: ReadonlyArray<string>;
      ok?: boolean;
    };
    toolName?: string;
    type: string;
  };
  type StepShape = { content?: Array<StepContentItem> };
  const steps = (result as { steps?: Array<StepShape> }).steps ?? [];

  const summary: Record<string, number> = Object.fromEntries(ALL_SKILLS.map((s) => [s.id, 0]));
  const generatedAssetIds: Array<string> = [];
  for (const step of steps) {
    for (const item of step.content ?? []) {
      if (item.type === "tool-call" && item.toolName && item.toolName in summary) {
        summary[item.toolName] = (summary[item.toolName] ?? 0) + 1;
        continue;
      }
      if (item.type === "tool-result" && item.output?.ok === true) {
        if (item.toolName === "generateBrandImage" && item.output.assetId) {
          generatedAssetIds.push(item.output.assetId);
        } else if (
          item.toolName === "delegateToSpecialist" &&
          Array.isArray(item.output.generatedAssetIds)
        ) {
          generatedAssetIds.push(...item.output.generatedAssetIds);
        }
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

export { runAgentInstance };
