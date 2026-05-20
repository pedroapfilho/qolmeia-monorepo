import { gateway, generateText, stepCountIs, tool } from "ai";

import type { AgentDispatchArgs, AgentRunResult } from "./dispatcher";
import { ALL_SKILLS, findSkillById } from "./skills/registry";
import type { AnySkill, SkillContext } from "./skills/types";
import { aggregateSteps } from "./step-aggregator";
import type { StepShape } from "./step-aggregator";
import { findTemplateBySlug } from "./templates/registry";
import { renderSystemPrompt } from "./templates/renderer";

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
): ReadonlyArray<AnySkill> => {
  // enabledSkillIds is Json? on AgentInstance: null = use template defaults,
  // [] = explicit empty (no skills), [...] = explicit override.
  const ids: ReadonlyArray<string> =
    enabledSkillIds === null || enabledSkillIds === undefined
      ? templateDefaultSkillIds
      : (enabledSkillIds as ReadonlyArray<string>);
  const resolved: Array<AnySkill> = [];
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

  const steps = (result as { steps?: ReadonlyArray<StepShape> }).steps ?? [];
  const { generatedAssetIds, toolCallSummary } = aggregateSteps(
    steps,
    ALL_SKILLS.map((s) => s.id),
  );

  return {
    generatedAssetIds,
    text: result.text,
    toolCallSummary,
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    },
  };
};

export { runAgentInstance };
