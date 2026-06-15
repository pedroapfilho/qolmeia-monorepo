import { AIChatAgent } from "@cloudflare/ai-chat";
import { callable } from "agents";
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
import { isBriefEmpty, parseBrief } from "@/lib/company-brief";
import { logInfo } from "@/lib/logger";
import { buildSkillTools } from "@/skills/registry";

const BASE_SYSTEM_PROMPT = `Você é o Planejador da Qolmeia — o agente que faz a entrevista inicial com um novo cliente para entender o negócio dele. Fale português do Brasil, de forma natural e curiosa, como uma conversa de descoberta de uma agência de marketing.

Sua missão tem duas etapas:

1. **Debriefing** — entreviste o cliente para conhecer: indústria, objetivo principal, público-alvo, canais que ele usa, e elementos de marca (cores, voz, referências). Faça perguntas abertas, uma de cada vez. Conforme aprende, chame extractBrief para registrar o que sabe (a skill aceita briefs parciais — atualize conforme a conversa evolui).

2. **Proposta de Time** — quando tiver informação suficiente, chame proposeTeam para sugerir os especialistas certos do catálogo (Designer, Marketing Strategist, etc.). Apresente a proposta com a justificativa de cada escolha, e oriente o cliente a confirmar no botão "Confirmar Time" da interface.

O cliente confirma fora do chat (botão na UI). Quando isso acontecer, o Correspondente assume — você fica em standby para um futuro re-plano se ele quiser ajustar o Time.`;

const OPENING_ADDENDUM = `Esta é a primeira mensagem da conversa. Apresente-se em uma frase e faça a primeira pergunta de descoberta sobre o negócio (o que a empresa faz). Seja breve e caloroso. Não chame ferramentas ainda.`;

const RECENT_TURNS_WINDOW = 16;
const RECENT_TURNS_KEEP = 200;

const extractText = (message: UIMessage): string =>
  message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();

// The Planner — persistent DO keyed by company id (`this.name`). Conversational
// debrief that crystallizes a typed CompanyBrief and recommends a Team. Stays
// dormant after team confirmation; the customer returns to re-plan without
// re-debrief (the brief survives in D1 + recent-turns).
class PlannerAgent extends AIChatAgent<Env> {
  // Test seam — same pattern as Correspondent.
  resolveModel() {
    return getModel(this.env);
  }

  // Synchronous re-entrancy guard. The brief check below awaits, so without
  // this two near-simultaneous calls (e.g. a StrictMode double-mount on the
  // client) could both pass the empty-transcript check before either persists,
  // producing two openings. Set before any await; never reset within an
  // instance — once opened, `this.messages` is the durable guard.
  private openingInFlight = false;

  // Client-invoked on mount of an empty planner transcript. The DO is the
  // authoritative guard: it opens the conversation only when there is no
  // history yet AND the company has no business info. Generates the first
  // discovery question and broadcasts it without triggering a model reply.
  //
  // NOTE: registered as callable below the class (imperative form) to avoid
  // stage-3 decorator syntax that workerd's V8 cannot parse at runtime.
  async startOpeningTurn(): Promise<{ status: "opened" | "skipped" }> {
    const companyId = this.name;

    if (this.messages.length > 0 || this.openingInFlight) {
      return { status: "skipped" };
    }
    this.openingInFlight = true;

    const row = await this.env.DB.prepare("SELECT brief FROM company WHERE id = ?")
      .bind(companyId)
      .first<{ brief: string | null }>();
    if (!isBriefEmpty(parseBrief(row?.brief))) {
      return { status: "skipped" };
    }

    const agentInstanceId = `planner-${companyId}`;
    const conversationId = `web-planner-${companyId}`;
    await upsertConversation(this.env.DB, {
      companyId,
      externalThreadId: "web-planner",
      id: conversationId,
    });

    // Ephemeral seed: OpenRouter rejects an empty messages array. This message
    // is never persisted and never shown — only the assistant reply lands.
    const result = streamText({
      messages: [{ content: "Inicie a conversa.", role: "user" }],
      model: this.resolveModel(),
      system: `${BASE_SYSTEM_PROMPT}\n\n${OPENING_ADDENDUM}`,
    });
    const text = await result.text;

    const id = crypto.randomUUID();
    await insertMessage(this.env.DB, {
      agentInstanceId,
      companyId,
      content: text,
      conversationId,
      id,
      role: "agent",
    });
    appendTurn(this, "agent", text);
    // persistMessages persists + broadcasts to connected clients WITHOUT
    // triggering onChatMessage (unlike saveMessages).
    await this.persistMessages([{ id, parts: [{ text, type: "text" }], role: "assistant" }]);

    return { status: "opened" };
  }

  // AIChatAgent framework callback — the agents SDK dispatches it, not our code.
  // fallow-ignore-next-line unused-class-member
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
  ): Promise<Response | undefined> {
    const turnStart = Date.now();
    const companyId = this.name;
    const agentInstanceId = `planner-${companyId}`;
    const conversationId = `web-planner-${companyId}`;

    await upsertConversation(this.env.DB, {
      companyId,
      externalThreadId: "web-planner",
      id: conversationId,
    });

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
    }

    const turns = getRecentTurns(this, RECENT_TURNS_WINDOW);
    const messages: Array<ModelMessage> = turns.map((turn) => ({
      content: turn.content,
      role: turn.role === "user" ? "user" : "assistant",
    }));

    logInfo("agent.turn.start", {
      agent: "planner",
      agentInstanceId,
      companyId,
      turnCount: turns.length,
      userText,
    });

    const tools = await buildSkillTools({ agentInstanceId, companyId, env: this.env }, [
      "extractBrief",
      "proposeTeam",
    ]);

    const result = streamText({
      messages,
      model: this.resolveModel(),
      onFinish: async (event) => {
        const agentMessageId = crypto.randomUUID();
        await insertMessage(this.env.DB, {
          agentInstanceId,
          companyId,
          content: event.text,
          conversationId,
          id: agentMessageId,
          role: "agent",
        });
        appendTurn(this, "agent", event.text);
        pruneOldTurns(this, RECENT_TURNS_KEEP);
        logInfo("agent.turn.ok", {
          agent: "planner",
          agentInstanceId,
          companyId,
          durationMs: Date.now() - turnStart,
          finishReason: event.finishReason,
          replyText: event.text,
          stepCount: event.steps?.length ?? 0,
          toolCallNames: (event.steps ?? []).flatMap((s) =>
            (s.toolCalls ?? []).map((tc) => tc.toolName),
          ),
          usage: event.usage,
        });
        await onFinish(event);
      },
      // 5 steps: model can interleave extractBrief + proposeTeam calls.
      stopWhen: stepCountIs(5),
      system: BASE_SYSTEM_PROMPT,
      tools,
    });

    return result.toUIMessageStreamResponse();
  }
}

// Register startOpeningTurn as a callable RPC method. Done imperatively here
// rather than with the @callable() decorator to avoid stage-3 decorator
// syntax that the workerd V8 runtime cannot parse when running tests.
callable()(PlannerAgent.prototype.startOpeningTurn, {
  kind: "method",
  name: "startOpeningTurn",
} as unknown as ClassMethodDecoratorContext);

export { PlannerAgent };
