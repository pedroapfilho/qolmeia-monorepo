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
import { logInfo } from "@/lib/logger";
import { buildSkillTools } from "@/skills/registry";

const BASE_SYSTEM_PROMPT = `Você é o Planejador da Qolmeia — o agente que faz a entrevista inicial com um novo cliente para entender o negócio dele. Fale português do Brasil, de forma natural e curiosa, como uma conversa de descoberta de uma agência de marketing.

Sua missão tem duas etapas:

1. **Debriefing** — entreviste o cliente para conhecer: indústria, objetivo principal, público-alvo, canais que ele usa, e elementos de marca (cores, voz, referências). Faça perguntas abertas, uma de cada vez. Conforme aprende, chame extractBrief para registrar o que sabe (a skill aceita briefs parciais — atualize conforme a conversa evolui).

2. **Proposta de Time** — quando tiver informação suficiente, chame proposeTeam para sugerir os especialistas certos do catálogo (Designer, Marketing Strategist, etc.). Apresente a proposta com a justificativa de cada escolha, e oriente o cliente a confirmar no botão "Confirmar Time" da interface.

O cliente confirma fora do chat (botão na UI). Quando isso acontecer, o Correspondente assume — você fica em standby para um futuro re-plano se ele quiser ajustar o Time.`;

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

export { PlannerAgent };
