import type { Metadata } from "next";

import { Chat } from "@/components/chat";
import { apiGetServer } from "@/lib/api-server";
import type { ListResponse, WebChatConversation, WebChatMessage } from "@/lib/api-types";

export const metadata: Metadata = {
  title: "Chat",
};

const loadInitialState = async (): Promise<{
  conversationId: string | null;
  messages: ReadonlyArray<WebChatMessage>;
}> => {
  try {
    const conversations = await apiGetServer<ListResponse<WebChatConversation>>(
      "/web-chat/conversations?limit=1",
    );
    const conversation = conversations.items[0];
    if (!conversation) {
      return { conversationId: null, messages: [] };
    }
    const messages = await apiGetServer<ListResponse<WebChatMessage>>(
      `/web-chat/messages?conversationId=${conversation.id}&limit=50`,
    );
    return { conversationId: conversation.id, messages: messages.items };
  } catch (error) {
    // First-time customer (no conversation yet) — render the empty chat
    // and let the composer create one on first send.
    console.error("[chat] failed to load initial state", { error });
    return { conversationId: null, messages: [] };
  }
};

const ChatPage = async () => {
  const { conversationId, messages } = await loadInitialState();

  return <Chat initialConversationId={conversationId} initialMessages={messages} />;
};

export default ChatPage;
