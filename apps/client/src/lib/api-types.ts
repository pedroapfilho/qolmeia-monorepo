// Shared response shapes for /api/v1/web-chat/*. Kept in one file so the
// chat UI components, query hooks, and SSE subscriber stay in sync.

type WebChatSender = "AGENT" | "CUSTOMER" | "SYSTEM";

type WebChatContentType = "AUDIO" | "DOCUMENT" | "IMAGE" | "TEXT";

type WebChatMessage = {
  content: string;
  contentType: WebChatContentType;
  createdAt: string;
  id: string;
  metadata: unknown;
  sender: WebChatSender;
};

type WebChatConversation = {
  createdAt: string;
  id: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  status: "ACTIVE" | "ARCHIVED" | "RESOLVED";
  updatedAt: string;
};

type WebChatAsset = {
  createdAt: string;
  id: string;
  metadata: unknown;
  mimeType: string;
  size: number;
  // Pre-signed URL for fetching the bytes. Short-lived (15min default) —
  // refetch the list to renew. Built server-side via buildSignedAssetUrl.
  url: string;
};

type PostMessageResponse = {
  conversationId: string;
  messageExternalId: string;
};

type SseMessageEvent = {
  conversationId: string;
  message: WebChatMessage;
  type: "message";
};

type SseAgentThinkingEvent = {
  agentDisplayName: string;
  conversationId: string;
  type: "agent-thinking";
};

type SseAssetEvent = {
  assetId: string;
  conversationId: string;
  type: "asset";
};

type SseEvent = SseAgentThinkingEvent | SseAssetEvent | SseMessageEvent;

type ListResponse<T> = {
  items: ReadonlyArray<T>;
  nextCursor: string | null;
};

export type {
  ListResponse,
  PostMessageResponse,
  SseAgentThinkingEvent,
  SseAssetEvent,
  SseEvent,
  SseMessageEvent,
  WebChatAsset,
  WebChatContentType,
  WebChatConversation,
  WebChatMessage,
  WebChatSender,
};
