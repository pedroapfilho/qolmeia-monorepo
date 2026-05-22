"use client";

import { useChat } from "@ai-sdk/react";
import { toast } from "@repo/ui/components/sonner";
import type { UIMessage } from "ai";
import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

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
import type { WebChatMessage } from "@/lib/api-types";
import { createWebChatTransport, roleForSender } from "@/lib/web-chat-transport";

type ChatProps = {
  initialConversationId: string | null;
  initialMessages: ReadonlyArray<WebChatMessage>;
};

const extractAssetId = (message: WebChatMessage): string | null => {
  if (
    message.contentType !== "IMAGE" ||
    !message.metadata ||
    typeof message.metadata !== "object"
  ) {
    return null;
  }
  const value = (message.metadata as Record<string, unknown>).assetId;
  return typeof value === "string" ? value : null;
};

// Maps the server-rendered history into `UIMessage`s for `useChat` seeding.
// API order is newest-first, so the list is reversed to oldest-first.
const toUIMessages = (messages: ReadonlyArray<WebChatMessage>): Array<UIMessage> =>
  [...messages]
    .toSorted((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((message) => {
      const assetId = extractAssetId(message);
      return {
        id: message.id,
        parts: [
          { text: message.content, type: "text" as const },
          ...(assetId
            ? [
                {
                  mediaType: "image/*",
                  type: "file" as const,
                  url: `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/v1/web-chat/assets/${assetId}`,
                },
              ]
            : []),
        ],
        role: roleForSender(message.sender),
      } satisfies UIMessage;
    });

// Client chat surface. `useChat` owns the message list; the custom transport
// bridges to the REST + SSE web-chat backend. Rendered with `ai-elements`.
const Chat = ({ initialConversationId, initialMessages }: ChatProps) => {
  const [input, setInput] = useState("");

  const transport = useMemo(
    () => createWebChatTransport({ initialConversationId }),
    [initialConversationId],
  );
  const seededMessages = useMemo(() => toUIMessages(initialMessages), [initialMessages]);

  const { error, messages, sendMessage, status } = useChat({
    messages: seededMessages,
    transport,
  });

  useEffect(() => {
    if (error) {
      toast.error("Não foi possível enviar. Tente novamente.");
    }
  }, [error]);

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      const text = message.text.trim();
      if (!text || status === "submitted" || status === "streaming") {
        return;
      }
      void sendMessage({ text });
      setInput("");
    },
    [sendMessage, status],
  );

  const isThinking = status === "submitted" || status === "streaming";

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
                    if (part.type === "file" && part.mediaType?.startsWith("image")) {
                      return (
                        // The API streams asset bytes with a private
                        // Cache-Control; a plain <img> is correct here.
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
