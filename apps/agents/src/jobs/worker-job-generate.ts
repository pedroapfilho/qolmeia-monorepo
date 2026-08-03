import { generateText, isStepCount } from "ai";

import { getDb } from "#/db/client";
import { loadInstanceWithTemplate, loadTicket } from "#/db/ticket";
import type { GenerateResult, JobContext } from "#/jobs/worker-job-steps";
import { getModel } from "#/lib/ai-gateway";
import { logInfo } from "#/lib/logger";
import { buildSkillTools } from "#/skills/registry";
import { resolveSystemPrompt } from "#/team/resolve-system-prompt";

type ChatMessage = { content: string; role: "assistant" | "user" };

const buildRevisionMessages = (
  brief: string,
  priorSummary: string | null,
  feedback: string | null,
): Array<ChatMessage> => {
  const messages: Array<ChatMessage> = [{ content: brief, role: "user" }];
  if (priorSummary !== null && priorSummary !== "" && feedback !== null && feedback !== "") {
    messages.push(
      { content: priorSummary, role: "assistant" },
      {
        content: `O revisor (operador da Qolmeia) pediu ajustes na entrega anterior:\n\n"${feedback}"\n\nRefaça o trabalho incorporando o pedido. Mantenha o que já estava bom e entregue a versão revisada.`,
        role: "user",
      },
    );
  }
  return messages;
};

const IMAGE_SKILLS = ["generateBrandImage"] as const;

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^$\{\}\(\)\|\[\]\\]/gv, String.raw`\$&`);

/* oxlint-disable react-doctor/js-hoist-regexp, react-doctor/js-set-map-lookups */
const embedGeneratedImages = (summary: string, skillResults: Record<string, unknown>): string => {
  let out = summary;
  for (const skillId of IMAGE_SKILLS) {
    const result = skillResults[skillId];
    const url =
      typeof result === "object" && result !== null ? (result as { url?: unknown }).url : undefined;
    if (typeof url !== "string" || url.length === 0) {
      continue;
    }
    const escaped = escapeRegExp(url);
    if (new RegExp(`!\\[[^\\]]*\\]\\(${escaped}\\)`, "v").test(out)) {
      continue;
    }
    const linkPattern = new RegExp(`\\[([^\\]]*)\\]\\(${escaped}\\)`, "v");
    if (linkPattern.test(out)) {
      out = out.replace(linkPattern, (_match, label: string) => `![${label}](${url})`);
    } else if (out.includes(url)) {
      out = out.replace(url, `![](${url})`);
    } else {
      out = `${out}\n\n![](${url})`;
    }
  }
  return out;
};
/* oxlint-enable react-doctor/js-hoist-regexp, react-doctor/js-set-map-lookups */

const generateDeliverable = async (
  ctx: JobContext,
  round: number,
  priorSummary: string | null,
  feedback: string | null,
): Promise<GenerateResult> => {
  const { agentInstanceId, companyId, env, ticketId } = ctx;
  const db = getDb(env);
  const stepStart = Date.now();
  const [ticket, { agentInstance, template }] = await Promise.all([
    loadTicket(db, ticketId),
    loadInstanceWithTemplate(db, agentInstanceId),
  ]);
  if (ticket === null) {
    throw new Error(`ticket ${ticketId} not properly seeded`);
  }
  logInfo("workflow.generate.start", {
    agentInstanceId,
    brief: ticket.brief,
    companyId,
    model: template.model,
    revision: round,
    skillIds: template.skillIds,
    templateId: template.id,
    ticketId,
  });
  const tools = await buildSkillTools(
    { agentInstanceId: agentInstance.id, companyId, env },
    template.skillIds,
  );
  const result = await generateText({
    instructions: resolveSystemPrompt(agentInstance, template),
    messages: buildRevisionMessages(ticket.brief, priorSummary, feedback),
    model: getModel(env, template.model),
    stopWhen: isStepCount(5),
    tools,
  });
  const summary = result.text.trim();
  const skillResults: Record<string, unknown> = {};
  for (const stepResult of result.steps ?? []) {
    for (const toolResult of stepResult.toolResults ?? []) {
      const name = toolResult.toolName;
      const output: unknown = toolResult.output;
      if (typeof name === "string" && output !== undefined) {
        skillResults[name] = output;
      }
    }
  }
  logInfo("workflow.generate.ok", {
    agentInstanceId,
    companyId,
    durationMs: Date.now() - stepStart,
    replyText: summary,
    revision: round,
    skillResultNames: Object.keys(skillResults),
    ticketId,
    toolCallNames: (result.steps ?? []).flatMap((s) =>
      (s.toolCalls ?? []).map((tc) => tc.toolName),
    ),
    usage: result.usage,
  });
  return {
    skillResultsJson: JSON.stringify(skillResults),
    summary: embedGeneratedImages(summary, skillResults),
  };
};

export { buildRevisionMessages, generateDeliverable };
