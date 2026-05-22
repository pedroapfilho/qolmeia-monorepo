import type { UIMessage, UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiSend = vi.fn();

vi.mock("@/lib/api-client", () => ({
  API_URL: "http://api.test",
  apiSend: (...args: ReadonlyArray<unknown>) => apiSend(...args),
}));

const { createWebChatTransport, roleForSender } = await import("./web-chat-transport");

// Builds a Response whose body streams the given SSE text as one chunk.
const sseResponse = (sse: string): Response => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sse));
      controller.close();
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
    status: 200,
  });
};

const drain = async (stream: ReadableStream<UIMessageChunk>): Promise<Array<UIMessageChunk>> => {
  const reader = stream.getReader();
  const chunks: Array<UIMessageChunk> = [];
  const pump = async (): Promise<void> => {
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    chunks.push(value);
    await pump();
  };
  await pump();
  return chunks;
};

const userMessage = (text: string): UIMessage => ({
  id: "user-1",
  parts: [{ text, type: "text" }],
  role: "user",
});

describe("roleForSender", () => {
  it("maps CUSTOMER to user and AGENT/SYSTEM to assistant", () => {
    expect(roleForSender("CUSTOMER")).toBe("user");
    expect(roleForSender("AGENT")).toBe("assistant");
    expect(roleForSender("SYSTEM")).toBe("assistant");
  });
});

describe("createWebChatTransport", () => {
  beforeEach(() => {
    apiSend.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the latest user text and streams the agent reply as text chunks", async () => {
    apiSend.mockResolvedValueOnce({ conversationId: "conv_1", messageExternalId: "ext_1" });
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse(
        `event: ready\ndata: {"conversationId":"conv_1"}\n\n` +
          `event: message\ndata: ${JSON.stringify({
            content: "Olá! Como posso ajudar?",
            contentType: "TEXT",
            createdAt: "2026-05-22T12:00:00.000Z",
            id: "msg_agent",
            metadata: {},
            sender: "AGENT",
          })}\n\n`,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const transport = createWebChatTransport();
    const stream = await transport.sendMessages({
      abortSignal: undefined,
      chatId: "chat",
      messageId: undefined,
      messages: [userMessage("oi")],
      trigger: "submit-message",
    });
    const chunks = await drain(stream);

    expect(apiSend).toHaveBeenCalledWith("POST", "/web-chat/messages", { text: "oi" });
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "start",
      "start-step",
      "text-start",
      "text-delta",
      "text-end",
      "finish-step",
      "finish",
    ]);
    const delta = chunks.find((chunk) => chunk.type === "text-delta");
    expect(delta).toMatchObject({ delta: "Olá! Como posso ajudar?" });
  });

  it("reuses the conversation id returned by the first POST on subsequent sends", async () => {
    apiSend
      .mockResolvedValueOnce({ conversationId: "conv_42", messageExternalId: "ext_1" })
      .mockResolvedValueOnce({ conversationId: "conv_42", messageExternalId: "ext_2" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          sseResponse(
            `event: message\ndata: ${JSON.stringify({
              content: "ok",
              contentType: "TEXT",
              createdAt: "2026-05-22T12:00:00.000Z",
              id: "m",
              metadata: {},
              sender: "AGENT",
            })}\n\n`,
          ),
        ),
      ),
    );

    const transport = createWebChatTransport();
    await drain(
      await transport.sendMessages({
        abortSignal: undefined,
        chatId: "chat",
        messageId: undefined,
        messages: [userMessage("primeira")],
        trigger: "submit-message",
      }),
    );
    await drain(
      await transport.sendMessages({
        abortSignal: undefined,
        chatId: "chat",
        messageId: undefined,
        messages: [userMessage("segunda")],
        trigger: "submit-message",
      }),
    );

    expect(apiSend.mock.calls[0]?.[2]).toEqual({ text: "primeira" });
    expect(apiSend.mock.calls[1]?.[2]).toEqual({ conversationId: "conv_42", text: "segunda" });
  });

  it("emits an image file chunk for IMAGE messages with an assetId", async () => {
    apiSend.mockResolvedValueOnce({ conversationId: "conv_1", messageExternalId: "ext_1" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse(
          `event: message\ndata: ${JSON.stringify({
            content: "Aqui está",
            contentType: "IMAGE",
            createdAt: "2026-05-22T12:00:00.000Z",
            id: "msg_img",
            metadata: { assetId: "asset_9" },
            sender: "AGENT",
          })}\n\n`,
        ),
      ),
    );

    const transport = createWebChatTransport();
    const chunks = await drain(
      await transport.sendMessages({
        abortSignal: undefined,
        chatId: "chat",
        messageId: undefined,
        messages: [userMessage("gere uma imagem")],
        trigger: "submit-message",
      }),
    );

    const file = chunks.find((chunk) => chunk.type === "file");
    expect(file).toMatchObject({
      mediaType: "image/*",
      url: "http://api.test/api/v1/web-chat/assets/asset_9",
    });
  });

  it("reconnectToStream returns null when there is no conversation yet", async () => {
    const transport = createWebChatTransport();
    await expect(transport.reconnectToStream({ chatId: "chat" })).resolves.toBeNull();
  });
});
