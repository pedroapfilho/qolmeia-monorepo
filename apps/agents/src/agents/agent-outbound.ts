import type { CorrespondentAgent } from "@/agents/correspondent";
import {
  prepareProactiveSuggestion,
  type ProactiveOutcome,
  recordProactiveSuggestion,
} from "@/agents/proactive";
import { appendTurn } from "@/agents/recent-turns";
import { insertMessage, upsertConversation } from "@/db/schema";
import { logInfo } from "@/lib/logger";

// Agent-initiated outbound turns (no user prompt) for the Correspondent. Kept out
// of the DO class so correspondent.ts stays focused. `env` is passed in because
// it's protected on the DO base and not reachable from here.

// Persist to D1 + the recent-turns buffer, then persistMessages to broadcast to
// connected WS clients WITHOUT re-triggering onChatMessage (saveMessages would
// make the agent reply to its own message).
const emitAgentMessage = async (
  agent: CorrespondentAgent,
  env: Env,
  content: string,
): Promise<void> => {
  const companyId = agent.name;
  const conversationId = `web-${companyId}`;
  const messageId = crypto.randomUUID();
  await upsertConversation(env.DB, { companyId, externalThreadId: "web", id: conversationId });
  await insertMessage(env.DB, {
    agentInstanceId: `corr-${companyId}`,
    companyId,
    content,
    conversationId,
    id: messageId,
    role: "agent",
  });
  appendTurn(agent, "agent", content);
  await agent.persistMessages([
    ...agent.messages,
    { id: messageId, parts: [{ text: content, type: "text" }], role: "assistant" },
  ]);
};

// Called by the WorkerJob Workflow (DO RPC stub) once a deliverable is ready,
// auto-executed or operator-approved. The Worker's markdown output (inline image
// URLs already rendered) is delivered as a regular agent turn.
const presentResult = async (
  agent: CorrespondentAgent,
  env: Env,
  args: { result: string; ticketId: string },
): Promise<void> => {
  const text = args.result.trim();
  if (text.length === 0) {
    logInfo("agent.presentResult.skip", { reason: "empty result", ticketId: args.ticketId });
    return;
  }
  logInfo("agent.presentResult", { companyId: agent.name, ticketId: args.ticketId });
  await emitAgentMessage(agent, env, text);
};

// Called by the weekly proactive sweep (scheduled.ts) via DO RPC stub. The DO is
// the authoritative guard (brief-complete + weekly dedup), so a cron double-fire
// is safe.
const suggestNextWork = async (agent: CorrespondentAgent, env: Env): Promise<ProactiveOutcome> => {
  const prepared = await prepareProactiveSuggestion(env, agent.resolveModel(), agent.name);
  if (prepared.status !== "ready") {
    return prepared;
  }
  await emitAgentMessage(agent, env, prepared.text);
  await recordProactiveSuggestion(env, agent.name);
  logInfo("agent.proactive.suggested", { companyId: agent.name });
  return { status: "suggested" };
};

export { presentResult, suggestNextWork };
export type { ProactiveOutcome };
