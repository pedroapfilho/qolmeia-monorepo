import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  type ModelMessage,
  stepCountIs,
  streamText,
  type StreamTextOnFinishCallback,
  type ToolSet,
  type UIMessage,
} from "ai";

import { appendTurn, getRecentTurns, pruneOldTurns } from "@/agents/recent-turns";
import { insertMessage, upsertConversation } from "@/db/schema";
import { getModel } from "@/lib/ai-gateway";
import { getMemoryAdapter, type ScoredRecord } from "@/lib/memory";
import { buildSkillTools } from "@/skills/registry";

const BASE_SYSTEM_PROMPT = `Você é o Correspondente da Qolmeia, o ponto único de contato de uma agência de IA para negócios. Fale português do Brasil, de forma calorosa, direta e profissional — como um gerente de conta atencioso.

Você tem um Time de especialistas. Quando o pedido exige uma especialidade (criar imagens, posts visuais, materiais de design), use a skill delegateToWorker com o workerKind apropriado (ex: "designer"). Apresente o resultado do especialista ao cliente.

Ao mostrar imagens geradas, inclua a URL no formato markdown ![descrição curta](URL) para que apareça inline no chat.`;

const RECENT_TURNS_WINDOW = 12;
const MEMORY_TOP_K = 4;
const MEMORY_MIN_SCORE = 0.3;
const RECENT_TURNS_KEEP = 100;

const extractText = (message: UIMessage): string =>
  message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();

const buildSystemPrompt = (facts: ReadonlyArray<ScoredRecord>): string => {
  if (facts.length === 0) {
    return BASE_SYSTEM_PROMPT;
  }
  const block = facts.map((fact) => `- [${fact.kind}] ${fact.content}`).join("\n");
  return `${BASE_SYSTEM_PROMPT}\n\nFatos relevantes lembrados:\n${block}`;
};

// The Correspondent. Keyed by company id (`this.name`). Memory plumbing:
// recent-turns buffer in DO SQLite (always-in-context) + vector recall from
// the memory adapter (top-K facts injected into the system prompt). Both
// channels write on each turn so the next turn sees them.
class CorrespondentAgent extends AIChatAgent<Env> {
  // Model resolution is a seam: the DO runs inside the bundled worker, out
  // of reach of module mocks, so tests inject a scripted model by reassigning
  // this method on the instance.
  resolveModel() {
    return getModel(this.env);
  }

  // Called by the WorkerJob Workflow when a Worker proposes a gated action.
  // T6 wires this to format the proposal as an assistant message via the
  // AIChatAgent message API and surface it to the User. For T4 it's a stub
  // so the type signature satisfies the Workflow's RPC call.
  async presentAction(_actionId: string): Promise<void> {
    // T6: format action + saveMessages(...)
  }

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
  ): Promise<Response | undefined> {
    const companyId = this.name;
    const agentInstanceId = `corr-${companyId}`;
    const conversationId = `web-${companyId}`;
    const memory = getMemoryAdapter(this.env);

    await upsertConversation(this.env.DB, {
      companyId,
      externalThreadId: "web",
      id: conversationId,
    });

    // Persist the incoming user turn: D1 (system of record), the
    // recent-turns buffer (model context), and the memory adapter (recall).
    const lastMessage = this.messages.at(-1);
    const userText = lastMessage?.role === "user" ? extractText(lastMessage) : "";
    if (lastMessage?.role === "user" && userText.length > 0) {
      await insertMessage(this.env.DB, {
        companyId,
        content: userText,
        conversationId,
        id: lastMessage.id,
        role: "user",
      });
      appendTurn(this, "user", userText);
      await memory.upsert({
        agentInstanceId,
        companyId,
        content: userText,
        createdAt: Date.now(),
        id: lastMessage.id,
        kind: "message",
      });
    }

    // Build the model context from our buffers — NOT this.messages. The SDK's
    // history is for the client; we own what the model sees.
    const retrieved =
      userText.length > 0
        ? await memory.retrieve({
            agentInstanceId,
            minScore: MEMORY_MIN_SCORE,
            query: userText,
            topK: MEMORY_TOP_K,
          })
        : [];
    const turns = getRecentTurns(this, RECENT_TURNS_WINDOW);
    const messages: Array<ModelMessage> = turns.map((turn) => ({
      content: turn.content,
      role: turn.role === "user" ? "user" : "assistant",
    }));

    // Correspondent's skill set is fixed for P3 — the role='correspondent'
    // agent_instance has no template binding (templates are for Workers).
    const tools = await buildSkillTools({ agentInstanceId, companyId, env: this.env }, [
      "rememberFact",
      "recallMemory",
      "delegateToWorker",
    ]);

    const result = streamText({
      messages,
      model: this.resolveModel(),
      onFinish: async (event) => {
        const agentText = event.text;
        const agentMessageId = crypto.randomUUID();
        await insertMessage(this.env.DB, {
          agentInstanceId,
          companyId,
          content: agentText,
          conversationId,
          id: agentMessageId,
          role: "agent",
        });
        appendTurn(this, "agent", agentText);
        await memory.upsert({
          agentInstanceId,
          companyId,
          content: agentText,
          createdAt: Date.now(),
          id: agentMessageId,
          kind: "message",
        });
        pruneOldTurns(this, RECENT_TURNS_KEEP);
        await onFinish(event);
      },
      // 3 steps: model emits a tool call → tool result feeds back → final reply.
      stopWhen: stepCountIs(3),
      system: buildSystemPrompt(retrieved),
      tools,
    });

    return result.toUIMessageStreamResponse();
  }
}

export { CorrespondentAgent };
