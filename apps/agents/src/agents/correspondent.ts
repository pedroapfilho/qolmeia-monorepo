import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  streamText,
  type StreamTextOnFinishCallback,
  type ToolSet,
  type UIMessage,
} from "ai";

import { insertMessage, upsertConversation } from "@/db/schema";
import { getModel } from "@/lib/ai-gateway";

const SYSTEM_PROMPT = `Você é o Correspondente da Qolmeia, o ponto único de contato de uma agência de IA para negócios. Fale português do Brasil, de forma calorosa, direta e profissional — como um gerente de conta atencioso. Você ainda não executa tarefas especializadas: por enquanto, conversa, entende o pedido do cliente e responde com clareza.`;

const extractText = (message: UIMessage): string =>
  message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();

// The Correspondent. Keyed by company id (`this.name`), which comes from the
// client's `useAgent({ name: companyId })` call. The agent_instance row uses
// the deterministic id `corr-{companyId}` (seeded in P2); the conversation
// id is `web-{companyId}` (one web thread per company in P2).
class CorrespondentAgent extends AIChatAgent<Env> {
  // Model resolution is a seam: the DO runs inside the bundled worker, out
  // of reach of module mocks, so tests inject a scripted model by reassigning
  // this method on the instance.
  resolveModel() {
    return getModel(this.env);
  }

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
  ): Promise<Response | undefined> {
    const companyId = this.name;
    const agentInstanceId = `corr-${companyId}`;
    const conversationId = `web-${companyId}`;

    await upsertConversation(this.env.DB, {
      companyId,
      externalThreadId: "web",
      id: conversationId,
    });

    const lastMessage = this.messages.at(-1);
    if (lastMessage?.role === "user") {
      await insertMessage(this.env.DB, {
        companyId,
        content: extractText(lastMessage),
        conversationId,
        id: lastMessage.id,
        role: "user",
      });
    }

    const result = streamText({
      messages: await convertToModelMessages(this.messages),
      model: this.resolveModel(),
      onFinish: async (event) => {
        await insertMessage(this.env.DB, {
          agentInstanceId,
          companyId,
          content: event.text,
          conversationId,
          id: crypto.randomUUID(),
          role: "agent",
        });
        await onFinish(event);
      },
      system: SYSTEM_PROMPT,
    });

    return result.toUIMessageStreamResponse();
  }
}

export { CorrespondentAgent };
