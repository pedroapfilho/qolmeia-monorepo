import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  generateText,
  type ModelMessage,
  stepCountIs,
  streamText,
  type StreamTextOnFinishCallback,
  type ToolSet,
  type UIMessage,
} from "ai";

import { appendTurn, getRecentTurns, pruneOldTurns } from "@/agents/recent-turns";
import { getAdapter } from "@/connectors/registry";
import type { ConnectorType, NormalizedMessage } from "@/connectors/types";
import { getAction } from "@/db/action";
import { insertMemoryFact, insertMessage, upsertConversation } from "@/db/schema";
import { getModel } from "@/lib/ai-gateway";
import type { CompanyBriefPartial } from "@/lib/company-brief";
import { getConnectorSecrets } from "@/lib/connector-secrets";
import { getMemoryAdapter, type ScoredRecord } from "@/lib/memory";
import { buildSkillTools } from "@/skills/registry";

const BASE_SYSTEM_PROMPT = `Você é o Correspondente da Qolmeia, o ponto único de contato de uma agência de IA para negócios. Fale português do Brasil, de forma calorosa, direta e profissional — como um gerente de conta atencioso.

Você tem um Time de especialistas. Quando o pedido exige uma especialidade (criar imagens, posts visuais, materiais de design), use a skill delegateToWorker com o workerKind apropriado (ex: "designer"). O especialista trabalha em segundo plano e a proposta chega depois — diga ao cliente que está sendo preparado.

Quando uma ação pendente aparecer no histórico (mensagem marcada com 🟡 e um id), o cliente pode responder com aprovação, pedido de ajuste, ou rejeição. Interprete a resposta e use a skill decideAction com o actionId correto. Se o cliente pedir ajustes, inclua o que ele quer no campo feedback.

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
  // Formats the proposal as an assistant message + persists it everywhere
  // the next chat turn looks: D1 (system of record), the SDK's message list
  // (which it auto-broadcasts to connected WS clients), and the recent-turns
  // buffer (so the model sees the proposal in context and knows to call
  // decideAction on the User's next reply).
  async presentAction(actionId: string): Promise<void> {
    const action = await getAction(this.env.DB, actionId);
    if (!action) {
      return;
    }
    const proposedSummary =
      typeof action.proposed.summary === "string" ? action.proposed.summary : "";
    const text = `🟡 **Ação pendente** (id: \`${actionId}\`)

O especialista propõe:

${proposedSummary}

Quer **aprovar**, **ajustar** (diga o que mudar) ou **rejeitar**?`;

    const companyId = this.name;
    const agentInstanceId = `corr-${companyId}`;
    const conversationId = `web-${companyId}`;
    const messageId = crypto.randomUUID();

    await upsertConversation(this.env.DB, {
      companyId,
      externalThreadId: "web",
      id: conversationId,
    });
    await insertMessage(this.env.DB, {
      agentInstanceId,
      companyId,
      content: text,
      conversationId,
      id: messageId,
      role: "agent",
    });
    appendTurn(this, "agent", text);
    await this.saveMessages([
      ...this.messages,
      { id: messageId, parts: [{ text, type: "text" }], role: "assistant" },
    ]);
  }

  // Called by the webhooks route when a NormalizedMessage arrives from an
  // external channel (Telegram, etc.). Mirrors the chat-loop logic in
  // onChatMessage but uses generateText (non-streaming) and sends the reply
  // out via the channel adapter — there's no WebSocket client on this path.
  async handleInboundFromConnector(input: {
    connectorId: string;
    connectorType: ConnectorType;
    conversationId: string;
    message: NormalizedMessage;
  }): Promise<void> {
    const companyId = this.name;
    const agentInstanceId = `corr-${companyId}`;
    const memory = getMemoryAdapter(this.env);
    const text = input.message.text;
    if (!text) {
      return;
    }

    await insertMessage(this.env.DB, {
      companyId,
      content: text,
      conversationId: input.conversationId,
      id: input.message.externalId,
      role: "user",
    });
    appendTurn(this, "user", text);
    await memory.upsert({
      agentInstanceId,
      companyId,
      content: text,
      createdAt: Date.now(),
      id: input.message.externalId,
      kind: "message",
    });

    const retrieved = await memory.retrieve({
      agentInstanceId,
      minScore: MEMORY_MIN_SCORE,
      query: text,
      topK: MEMORY_TOP_K,
    });
    const turns = getRecentTurns(this, RECENT_TURNS_WINDOW);
    const messages: Array<ModelMessage> = turns.map((turn) => ({
      content: turn.content,
      role: turn.role === "user" ? "user" : "assistant",
    }));
    const tools = await buildSkillTools({ agentInstanceId, companyId, env: this.env }, [
      "rememberFact",
      "recallMemory",
      "delegateToWorker",
      "decideAction",
    ]);

    let reply: string;
    try {
      const result = await generateText({
        messages,
        model: this.resolveModel(),
        stopWhen: stepCountIs(3),
        system: buildSystemPrompt(retrieved),
        tools,
      });
      reply = result.text.trim();
    } catch (error) {
      // oxlint-disable-next-line no-console
      console.error("[correspondent] generateText failed for inbound connector message", { error });
      return;
    }
    if (!reply) {
      return;
    }

    const agentMessageId = crypto.randomUUID();
    await insertMessage(this.env.DB, {
      agentInstanceId,
      companyId,
      content: reply,
      conversationId: input.conversationId,
      id: agentMessageId,
      role: "agent",
    });
    appendTurn(this, "agent", reply);
    await memory.upsert({
      agentInstanceId,
      companyId,
      content: reply,
      createdAt: Date.now(),
      id: agentMessageId,
      kind: "message",
    });
    pruneOldTurns(this, RECENT_TURNS_KEEP);

    // Send the reply back out through the channel. Failure here is logged
    // but doesn't blow up — the reply still lives in D1; operator can
    // surface it from the backoffice.
    const adapter = getAdapter(input.connectorType);
    const config = await getConnectorSecrets(this.env, input.connectorId);
    if (!adapter || !config) {
      // oxlint-disable-next-line no-console
      console.error("[correspondent] missing adapter/config for outbound reply", {
        connectorId: input.connectorId,
        connectorType: input.connectorType,
      });
      return;
    }
    try {
      await adapter.sendOutbound({
        config,
        externalThreadId: input.message.externalThreadId,
        text: reply,
      });
    } catch (error) {
      // oxlint-disable-next-line no-console
      console.error("[correspondent] sendOutbound failed", {
        connectorType: input.connectorType,
        error,
      });
    }
  }

  // Called by the team-confirm route after materializeTeam. Writes structured
  // facts into memory so the Correspondent's first chat turn already knows
  // who the customer is, instead of starting blank.
  async seedMemory(input: {
    brief: Partial<CompanyBriefPartial>;
    debriefSummary: string;
  }): Promise<void> {
    const companyId = this.name;
    const agentInstanceId = `corr-${companyId}`;
    const memory = getMemoryAdapter(this.env);

    const facts: Array<{ content: string; kind: string }> = [];
    if (input.brief.industry) {
      facts.push({ content: `Setor: ${input.brief.industry}`, kind: "industry" });
    }
    if (input.brief.primaryGoal) {
      facts.push({ content: `Objetivo principal: ${input.brief.primaryGoal}`, kind: "goal" });
    }
    if (input.brief.audience) {
      facts.push({ content: `Público: ${input.brief.audience}`, kind: "audience" });
    }
    if (input.brief.channels && input.brief.channels.length > 0) {
      facts.push({
        content: `Canais ativos: ${input.brief.channels.join(", ")}`,
        kind: "channels",
      });
    }
    if (input.brief.brand?.voice) {
      facts.push({ content: `Tom da marca: ${input.brief.brand.voice}`, kind: "brand_voice" });
    }
    if (input.brief.brand?.palette) {
      facts.push({ content: `Paleta: ${input.brief.brand.palette}`, kind: "brand_palette" });
    }
    if (input.debriefSummary) {
      facts.push({ content: input.debriefSummary, kind: "onboarding_summary" });
    }

    await Promise.all(
      facts.map(async (fact) => {
        const id = crypto.randomUUID();
        await insertMemoryFact(this.env.DB, {
          agentInstanceId,
          companyId,
          content: fact.content,
          id,
          kind: fact.kind,
        });
        await memory.upsert({
          agentInstanceId,
          companyId,
          content: fact.content,
          createdAt: Date.now(),
          id,
          kind: fact.kind,
        });
      }),
    );
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

    // Correspondent's skill set is fixed for P4 — the role='correspondent'
    // agent_instance has no template binding (templates are for Workers).
    // decideAction lets it interpret User replies to pending Actions.
    const tools = await buildSkillTools({ agentInstanceId, companyId, env: this.env }, [
      "rememberFact",
      "recallMemory",
      "delegateToWorker",
      "decideAction",
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
