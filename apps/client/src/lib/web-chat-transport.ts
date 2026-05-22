import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

import { apiSend, API_URL } from "@/lib/api-client";
import type { PostMessageResponse, WebChatMessage } from "@/lib/api-types";

// Custom AI SDK `ChatTransport` bridging the existing web-chat backend.
//
// Why a hand-written transport (not `DefaultChatTransport` + custom `fetch`):
// the backend is REST + SSE, not a single `UIMessageStream` endpoint. A send
// is a POST to `/web-chat/messages`; the agent reply arrives later on a
// separate `GET /web-chat/stream` SSE channel. `DefaultChatTransport` expects
// one request whose response body *is* the UI message stream. Splitting the
// POST and the SSE, and translating SSE events into `UIMessageChunk`s, only
// fits the `ChatTransport` interface cleanly — so it is implemented directly.
//
// The backend emits each agent reply as ONE complete `event: message`
// (no token deltas), so the transport emits the reply as a single text part:
// `text-start` -> one `text-delta` -> `text-end`. Token-by-token streaming
// would need the backend to switch to `streamText`; that is out of scope.

const STREAM_PATH = "/api/v1/web-chat/stream";

// Maps a backend `WebChatMessage` sender to a UI message role.
const roleForSender = (sender: WebChatMessage["sender"]): UIMessage["role"] =>
  sender === "CUSTOMER" ? "user" : "assistant";

type WebChatSseEvent =
  | { agentDisplayName?: string; type: "agent-thinking" }
  | { assetId?: string; type: "asset" }
  | { message: WebChatMessage; type: "message" }
  | { type: "error" }
  | { type: "ping" }
  | { type: "ready" };

// Parses a raw SSE block ("event: x\ndata: {...}") into a typed event.
const parseSseBlock = (block: string): WebChatSseEvent | null => {
  let eventName = "message";
  const dataLines: Array<string> = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  if (eventName === "ping") {
    return { type: "ping" };
  }
  const raw = dataLines.join("\n");
  if (!raw) {
    return eventName === "ready" ? { type: "ready" } : null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (eventName === "agent-thinking") {
      return {
        agentDisplayName:
          typeof parsed.agentDisplayName === "string" ? parsed.agentDisplayName : undefined,
        type: "agent-thinking",
      };
    }
    if (eventName === "asset") {
      return {
        assetId: typeof parsed.assetId === "string" ? parsed.assetId : undefined,
        type: "asset",
      };
    }
    if (eventName === "ready") {
      return { type: "ready" };
    }
    if (eventName === "error") {
      return { type: "error" };
    }
    return { message: parsed as unknown as WebChatMessage, type: "message" };
  } catch {
    return null;
  }
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Erro inesperado no chat.";

const extractAssetId = (message: WebChatMessage): string | null => {
  if (message.contentType !== "IMAGE") {
    return null;
  }
  const metadata = message.metadata;
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const value = (metadata as Record<string, unknown>).assetId;
  return typeof value === "string" ? value : null;
};

// Renders an AGENT/SYSTEM message into the chunk sequence the AI SDK expects
// for a single, non-streamed text part.
const writeAgentReply = (
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  message: WebChatMessage,
): void => {
  const textId = `web-chat-${message.id}`;
  controller.enqueue({ messageId: message.id, type: "start" });
  controller.enqueue({ type: "start-step" });
  controller.enqueue({ id: textId, type: "text-start" });
  controller.enqueue({ delta: message.content, id: textId, type: "text-delta" });
  controller.enqueue({ id: textId, type: "text-end" });
  // Asset messages carry the image id in `metadata.assetId`; surface it as a
  // file part so the UI can render <img> from `/web-chat/assets/:id`.
  const assetId = extractAssetId(message);
  if (assetId) {
    controller.enqueue({
      mediaType: "image/*",
      type: "file",
      url: `${API_URL}/api/v1/web-chat/assets/${assetId}`,
    });
  }
  controller.enqueue({ type: "finish-step" });
  controller.enqueue({ type: "finish" });
};

// Opens the SSE stream for a conversation and pipes agent replies into a
// `UIMessageChunk` stream. The stream closes once the agent reply lands
// (one round-trip per send) or when `abortSignal` fires.
const openAgentChunkStream = ({
  abortSignal,
  conversationId,
}: {
  abortSignal: AbortSignal | undefined;
  conversationId: string;
}): ReadableStream<UIMessageChunk> => {
  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
      const url = `${API_URL}${STREAM_PATH}?conversationId=${encodeURIComponent(conversationId)}`;
      let response: Response;
      try {
        response = await fetch(url, {
          credentials: "include",
          headers: { Accept: "text/event-stream" },
          signal: abortSignal,
        });
      } catch (error) {
        controller.enqueue({ errorText: errorMessage(error), type: "error" });
        controller.close();
        return;
      }

      if (!response.ok || !response.body) {
        controller.enqueue({
          errorText: `Falha ao abrir o stream (${response.status}).`,
          type: "error",
        });
        controller.close();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let closed = false;

      const finish = async () => {
        if (closed) {
          return;
        }
        closed = true;
        try {
          await reader.cancel();
        } catch {
          /* reader already released */
        }
        controller.close();
      };

      abortSignal?.addEventListener("abort", () => void finish(), { once: true });

      // Drains complete SSE blocks from the buffer. Returns true once the
      // agent reply has been emitted (one reply per send).
      const drainBuffer = (): boolean => {
        let separator = buffer.indexOf("\n\n");
        while (separator !== -1) {
          const block = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          const event = parseSseBlock(block);
          if (event?.type === "message" && event.message.sender !== "CUSTOMER") {
            writeAgentReply(controller, event.message);
            return true;
          }
          separator = buffer.indexOf("\n\n");
        }
        return false;
      };

      // Recursive pump avoids a lint-flagged `await`-in-loop while still
      // reading the stream chunk by chunk until the agent reply lands.
      const pump = async (): Promise<void> => {
        if (closed) {
          return;
        }
        const { done, value } = await reader.read();
        if (done) {
          await finish();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        if (drainBuffer()) {
          // One agent reply per send — close so `useChat` settles to `ready`.
          await finish();
          return;
        }
        await pump();
      };

      try {
        await pump();
      } catch (error) {
        if (!closed) {
          controller.enqueue({ errorText: errorMessage(error), type: "error" });
          await finish();
        }
      }
    },
  });
};

// Pulls the text of the most recent user message out of the UI history.
const latestUserText = (messages: ReadonlyArray<UIMessage>): string => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "user") {
      continue;
    }
    return message.parts
      .filter((part): part is { text: string; type: "text" } => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
  }
  return "";
};

type WebChatTransportOptions = {
  // Seeded from the server-rendered conversation, if any. The first send with
  // no id creates a conversation; the POST response id is reused afterwards.
  initialConversationId?: string | null;
};

// `ChatTransport` implementation. Holds the conversation id in closure state
// across sends within a single chat instance.
const createWebChatTransport = (
  options: WebChatTransportOptions = {},
): ChatTransport<UIMessage> => {
  let conversationId: string | null = options.initialConversationId ?? null;

  const sendMessages: ChatTransport<UIMessage>["sendMessages"] = async ({
    abortSignal,
    messages,
  }) => {
    const text = latestUserText(messages);
    if (!text) {
      throw new Error("Mensagem vazia.");
    }

    const response = await apiSend<PostMessageResponse>("POST", "/web-chat/messages", {
      ...(conversationId ? { conversationId } : {}),
      text,
    });
    conversationId = response.conversationId;

    return openAgentChunkStream({ abortSignal, conversationId });
  };

  // Re-opens the SSE channel for an in-flight conversation (page refresh,
  // dropped connection). Returns null when there is no conversation yet.
  const reconnectToStream: ChatTransport<UIMessage>["reconnectToStream"] = () => {
    if (!conversationId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(openAgentChunkStream({ abortSignal: undefined, conversationId }));
  };

  return { reconnectToStream, sendMessages };
};

export { createWebChatTransport, roleForSender };
export type { WebChatTransportOptions };
