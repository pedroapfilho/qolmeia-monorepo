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

// P1 hard-codes a single tenant — company resolution + onboarding arrive in
// P2/P5. The conversation is the company's one web thread.
const P1_COMPANY_ID = "p1-demo-company";
const P1_THREAD_ID = "web";
const P1_CONVERSATION_ID = "conv-web-p1-demo-company";

const SYSTEM_PROMPT = `Você é o Correspondente da Qolmeia, o ponto único de contato de uma agência de IA para negócios. Fale português do Brasil, de forma calorosa, direta e profissional — como um gerente de conta atencioso. Você ainda não executa tarefas especializadas: por enquanto, conversa, entende o pedido do cliente e responde com clareza.`;

const extractText = (message: UIMessage): string =>
  message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();

// The Correspondent — P1 scope: a chat loop through AI Gateway with no tools.
// AIChatAgent persists `this.messages` to the DO's own SQLite (that is how the
// client's history + reconnection work); we additionally mirror each turn to
// D1, the system-of-record (spec decision 6).
class CorrespondentAgent extends AIChatAgent<Env> {
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
  ): Promise<Response | undefined> {
    await upsertConversation(this.env.DB, {
      companyId: P1_COMPANY_ID,
      externalThreadId: P1_THREAD_ID,
      id: P1_CONVERSATION_ID,
    });

    const lastMessage = this.messages.at(-1);
    if (lastMessage?.role === "user") {
      await insertMessage(this.env.DB, {
        companyId: P1_COMPANY_ID,
        content: extractText(lastMessage),
        conversationId: P1_CONVERSATION_ID,
        id: lastMessage.id,
        role: "user",
      });
    }

    const result = streamText({
      messages: await convertToModelMessages(this.messages),
      model: getModel(this.env),
      onFinish: async (event) => {
        await insertMessage(this.env.DB, {
          agentInstanceId: "correspondent",
          companyId: P1_COMPANY_ID,
          content: event.text,
          conversationId: P1_CONVERSATION_ID,
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

export { CorrespondentAgent, P1_COMPANY_ID, P1_CONVERSATION_ID };
