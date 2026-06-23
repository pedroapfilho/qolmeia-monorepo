import { generateText, stepCountIs } from "ai";

import { getTemplate } from "#/db/template";
import { loadAgentInstance, loadTicket } from "#/db/ticket";
import type { GenerateResult, JobContext } from "#/jobs/worker-job-steps";
import { getModel } from "#/lib/ai-gateway";
import { logInfo } from "#/lib/logger";
import { buildSkillTools } from "#/skills/registry";
import { resolveSystemPrompt } from "#/team/resolve-system-prompt";

type ChatMessage = { content: string; role: "assistant" | "user" };

// The prompt for one generation round. The first round is just the brief; a
// revision round replays the prior deliverable and the operator's note so the
// Worker reworks instead of starting over.
const buildRevisionMessages = (
  brief: string,
  priorSummary: string | null,
  feedback: string | null,
): Array<ChatMessage> => {
  const messages: Array<ChatMessage> = [{ content: brief, role: "user" }];
  if (priorSummary && feedback) {
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

// Skills whose result carries a `url` that should render as an inline image.
const IMAGE_SKILLS = ["generateBrandImage"] as const;

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^$\{\}\(\)\|\[\]\\]/gv, String.raw`\$&`);

// Force a generated image to render inline in chat. The image skill returns a
// signed asset URL the model often writes as a bare link, which the client
// renders as an <a> rather than an image. Promote a link or bare occurrence of
// the URL to `![](url)` markdown, appending it if the model never mentioned it.
//
// react-doctor hints don't apply here: the patterns are built from the per-URL
// `escaped` value so they can't be hoisted out of the loop, and
// `out.includes(url)` is a substring check, not an array scan.
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
    // Already an inline image embed → leave it.
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

// `generate-<round>` step: run the Worker model with its template's skills and
// return the deliverable summary plus the tool-call outputs.
const generateDeliverable = async (
  ctx: JobContext,
  round: number,
  priorSummary: string | null,
  feedback: string | null,
): Promise<GenerateResult> => {
  const { agentInstanceId, companyId, env, ticketId } = ctx;
  const stepStart = Date.now();
  // Independent D1 reads, overlapped. Both are required, so fail-fast is correct.
  const [ticket, agentInstance] = await Promise.all([
    loadTicket(env.DB, ticketId),
    loadAgentInstance(env.DB, agentInstanceId),
  ]);
  if (!ticket || !agentInstance?.templateId) {
    throw new Error(`ticket ${ticketId} or its agent_instance not properly seeded`);
  }
  const template = await getTemplate(env.DB, agentInstance.templateId);
  if (!template) {
    throw new Error(`template ${agentInstance.templateId} not found`);
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
    messages: buildRevisionMessages(ticket.brief, priorSummary, feedback),
    model: getModel(env, template.model),
    stopWhen: stepCountIs(5),
    system: resolveSystemPrompt(agentInstance, template),
    tools,
  });
  const summary = result.text.trim();
  // Collect tool-call outputs for the propose step. The AI SDK exposes them on
  // `step.toolResults[i]`; last write wins per skill id.
  const skillResults: Record<string, unknown> = {};
  for (const stepResult of result.steps ?? []) {
    for (const toolResult of stepResult.toolResults ?? []) {
      const name = (toolResult as { toolName?: string }).toolName;
      const output =
        (toolResult as { output?: unknown }).output ?? (toolResult as { result?: unknown }).result;
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
