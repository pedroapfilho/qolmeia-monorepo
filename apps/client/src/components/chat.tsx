"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { Composer } from "@/components/composer";
import { MessageList } from "@/components/message-list";
import { SseSubscriber } from "@/components/sse-subscriber";
import { apiGet } from "@/lib/api-client";
import type { ListResponse, PostMessageResponse, SseEvent, WebChatMessage } from "@/lib/api-types";

type ChatProps = {
  initialConversationId: string | null;
  initialMessages: ReadonlyArray<WebChatMessage>;
};

const messagesQueryKey = (conversationId: string | null) =>
  ["web-chat", "messages", conversationId] as const;

const buildOptimisticMessage = (text: string, sentAt: string): WebChatMessage => ({
  content: text,
  contentType: "TEXT",
  // sentAt = user submit time, not POST-resolve time. In serial dispatch
  // the POST resolves only after the agent reply is persisted, so a
  // resolve-time stamp would sort the user's own message below the reply.
  createdAt: sentAt,
  // `local-` prefix avoids collision with server cuids.
  id: `local-${Date.now()}`,
  metadata: {},
  sender: "CUSTOMER",
});

// Client-side chat surface. Hydrates from server-rendered initial state,
// then keeps the message list in sync via:
//   1) Optimistic insert on composer submit
//   2) SSE `message` events from agent responses
//   3) TanStack Query background refetch as a safety net
const Chat = ({ initialConversationId, initialMessages }: ChatProps) => {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [agentThinkingFrom, setAgentThinkingFrom] = useState<string | null>(null);

  const { data } = useQuery({
    enabled: conversationId !== null,
    initialData:
      conversationId === initialConversationId
        ? ({
            items: [...initialMessages],
            nextCursor: null,
          } satisfies ListResponse<WebChatMessage>)
        : undefined,
    queryFn: () => {
      const cid = conversationId ?? "";
      return apiGet<ListResponse<WebChatMessage>>(`/web-chat/messages?conversationId=${cid}`);
    },
    queryKey: messagesQueryKey(conversationId),
  });

  // Sort by createdAt — cache insertion order isn't chronological (in
  // serial dispatch the agent's SSE reply can land before the optimistic
  // user row).
  const messages = (data?.items ?? []).toSorted(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const handleSent = useCallback(
    (response: PostMessageResponse, sentText: string, sentAt: string) => {
      const optimistic = buildOptimisticMessage(sentText, sentAt);

      // First send creates the conversation; subsequent sends reuse it.
      const wasNewConversation = conversationId === null;
      if (wasNewConversation) {
        setConversationId(response.conversationId);
      }

      queryClient.setQueryData<ListResponse<WebChatMessage>>(
        messagesQueryKey(response.conversationId),
        (prev) => {
          const existingItems = prev?.items ?? [];
          // Insert at the front because API order is newest-first.
          return {
            items: [optimistic, ...existingItems],
            nextCursor: prev?.nextCursor ?? null,
          };
        },
      );
    },
    [conversationId, queryClient],
  );

  const handleSseEvent = useCallback(
    (event: SseEvent) => {
      if (event.type === "agent-thinking") {
        setAgentThinkingFrom(event.agentDisplayName);
        return;
      }
      if (event.type === "message") {
        setAgentThinkingFrom(null);
        queryClient.setQueryData<ListResponse<WebChatMessage>>(
          messagesQueryKey(event.conversationId),
          (prev) => {
            const items = prev?.items ?? [];
            // Avoid duplicate inserts if the SSE event arrives twice (the
            // browser EventSource auto-reconnects on transient errors,
            // which can replay the last event).
            if (items.some((existing) => existing.id === event.message.id)) {
              return prev ?? { items, nextCursor: null };
            }
            return {
              items: [event.message, ...items],
              nextCursor: prev?.nextCursor ?? null,
            };
          },
        );
      }
      // asset events trigger a background refetch of /assets — handled
      // on the assets page; ignore here.
    },
    [queryClient],
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex-1 overflow-y-auto">
        <MessageList agentThinkingFrom={agentThinkingFrom} messages={messages} />
      </div>
      <Composer conversationId={conversationId} onSent={handleSent} />
      <SseSubscriber conversationId={conversationId} onEvent={handleSseEvent} />
    </div>
  );
};

export { Chat };
