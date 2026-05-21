"use client";

import { useEffect, useRef } from "react";

import type { WebChatMessage } from "@/lib/api-types";

import { MessageBubble } from "./message-bubble";

type MessageListProps = {
  agentThinkingFrom: string | null;
  messages: ReadonlyArray<WebChatMessage>;
};

// Renders messages oldest→newest. Auto-scrolls to the bottom whenever the
// last message id changes — using `messages.at(-1).id` (not length) is
// important because the SSE subscriber may rewrite an optimistic row with
// the server-issued id.
const MessageList = ({ agentThinkingFrom, messages }: MessageListProps) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastId = messages.at(-1)?.id ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lastId, agentThinkingFrom]);

  if (messages.length === 0 && !agentThinkingFrom) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <p className="max-w-md text-center text-sm text-muted-foreground">
          Comece a conversa. Os agentes da Qolmeia respondem em segundos.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-6">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      {agentThinkingFrom ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-block size-2 animate-pulse rounded-full bg-primary" />
          <span>{agentThinkingFrom} está trabalhando...</span>
        </div>
      ) : null}
      <div ref={bottomRef} />
    </div>
  );
};

export { MessageList };
