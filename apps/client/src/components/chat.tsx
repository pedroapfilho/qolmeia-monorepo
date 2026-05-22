"use client";

import { useAgentChat } from "@cloudflare/ai-chat/react";
import { toast } from "@repo/ui/components/sonner";
import { useAgent } from "agents/react";
import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Loader } from "@/components/ai-elements/loader";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
} from "@/components/ai-elements/prompt-input";

type ChatProps = {
  agentsUrl: string;
  sessionToken: string;
};

// P1 hard-codes the single demo company as the Correspondent DO instance name.
const AGENT_INSTANCE = "p1-demo-company";

// Client chat surface. `useAgent` opens a WebSocket straight to the company's
// Correspondent DO; `useAgentChat` wraps it with the AI SDK chat interface.
// History, streaming, and reconnection are handled by the agents SDK — there
// is no server-seeded message list and no custom transport. Rendered with
// `ai-elements`.
const Chat = ({ agentsUrl, sessionToken }: ChatProps) => {
  const [input, setInput] = useState("");

  const agent = useAgent({
    agent: "correspondent",
    host: agentsUrl,
    name: AGENT_INSTANCE,
    // P1 auth token the Worker validates against the auth service (spec §9).
    query: { cf_session: sessionToken },
  });

  const { error, messages, sendMessage, status } = useAgentChat({ agent });

  useEffect(() => {
    if (error) {
      toast.error("Não foi possível enviar. Tente novamente.");
    }
  }, [error]);

  const isThinking = status === "submitted" || status === "streaming";

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      const text = message.text.trim();
      if (!text || isThinking) {
        return;
      }
      void sendMessage({ text });
      setInput("");
    },
    [isThinking, sendMessage],
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <Conversation>
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              description="Os agentes da Qolmeia respondem em segundos."
              icon={<MessageSquare aria-hidden className="size-10" />}
              title="Comece a conversa"
            />
          ) : (
            messages.map((message) => (
              <Message from={message.role} key={message.id}>
                <MessageContent>
                  {message.parts.map((part, index) =>
                    part.type === "text" ? (
                      <MessageResponse key={`${message.id}-${index}`}>{part.text}</MessageResponse>
                    ) : null,
                  )}
                </MessageContent>
              </Message>
            ))
          )}
          {isThinking ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader size={16} />
              <span>Um agente está respondendo…</span>
            </div>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="border-t border-border bg-card p-3">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea
              aria-label="Mensagem"
              autoComplete="off"
              disabled={isThinking}
              onChange={(event) => setInput(event.currentTarget.value)}
              placeholder="Escreva sua mensagem…"
              value={input}
            />
          </PromptInputBody>
          <PromptInputToolbar>
            <PromptInputSubmit disabled={input.trim().length === 0 || isThinking} status={status} />
          </PromptInputToolbar>
        </PromptInput>
      </div>
    </div>
  );
};

export { Chat };
