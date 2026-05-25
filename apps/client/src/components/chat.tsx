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
  agent?: "correspondent" | "planner";
  agentsUrl: string;
  companyId: string;
  sessionToken: string;
};

// Client chat surface. `useAgent` opens a WebSocket straight to the company's
// agent DO (named by the real org id). `useAgentChat` wraps it with the AI SDK
// chat interface. History, streaming, and reconnection are handled by the
// agents SDK. The `agent` prop picks which DO class to talk to — default is
// "correspondent"; onboarding sets it to "planner".
const Chat = ({
  agent: agentName = "correspondent",
  agentsUrl,
  companyId,
  sessionToken,
}: ChatProps) => {
  const [input, setInput] = useState("");

  const agent = useAgent({
    agent: agentName,
    host: agentsUrl,
    name: companyId,
    // Session token the Worker validates against the auth service (spec §9).
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
                  {message.parts.map((part, index) => {
                    if (part.type === "text") {
                      return (
                        <MessageResponse key={`${message.id}-${index}`}>
                          {part.text}
                        </MessageResponse>
                      );
                    }
                    if (part.type === "file" && part.mediaType?.startsWith("image/")) {
                      return (
                        // Asset URL is HMAC-signed by the Worker; a plain <img>
                        // is correct — no CORS needed for image loads.
                        // oxlint-disable-next-line no-img-element
                        <img
                          alt="Imagem gerada"
                          className="max-h-80 rounded-md object-contain"
                          key={`${message.id}-${index}`}
                          src={part.url}
                        />
                      );
                    }
                    return null;
                  })}
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
