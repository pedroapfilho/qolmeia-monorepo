import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WebChatMessage } from "@/lib/api-types";

// `use-stick-to-bottom` (used by Conversation) observes element resizes;
// jsdom ships no ResizeObserver, so stub one.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const sendMessage = vi.fn();
const useChatState = {
  error: undefined as Error | undefined,
  messages: [] as Array<unknown>,
  status: "ready" as string,
};

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    error: useChatState.error,
    messages: useChatState.messages,
    sendMessage,
    status: useChatState.status,
  }),
}));

vi.mock("@/lib/web-chat-transport", () => ({
  createWebChatTransport: vi.fn(() => ({})),
  roleForSender: (sender: WebChatMessage["sender"]) =>
    sender === "CUSTOMER" ? "user" : "assistant",
}));

const toastError = vi.fn();
vi.mock("@repo/ui/components/sonner", () => ({
  toast: { error: toastError, success: vi.fn() },
}));

// streamdown pulls heavy markdown deps; a passthrough keeps the test focused.
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

const { Chat } = await import("./chat");

describe("Chat", () => {
  beforeEach(() => {
    sendMessage.mockReset();
    toastError.mockReset();
    useChatState.error = undefined;
    useChatState.messages = [];
    useChatState.status = "ready";
  });

  it("renders the empty state when there are no messages", () => {
    render(<Chat initialConversationId={null} initialMessages={[]} />);
    expect(screen.getByText("Comece a conversa")).toBeInTheDocument();
  });

  it("renders seeded messages from useChat", () => {
    useChatState.messages = [
      { id: "m1", parts: [{ text: "oi", type: "text" }], role: "user" },
      { id: "m2", parts: [{ text: "olá!", type: "text" }], role: "assistant" },
    ];
    render(<Chat initialConversationId="conv_1" initialMessages={[]} />);
    expect(screen.getByText("oi")).toBeInTheDocument();
    expect(screen.getByText("olá!")).toBeInTheDocument();
  });

  it("sends the typed message on submit", () => {
    render(<Chat initialConversationId={null} initialMessages={[]} />);
    const textarea = screen.getByLabelText("Mensagem");
    fireEvent.change(textarea, { target: { value: "preciso de ajuda" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(sendMessage).toHaveBeenCalledWith({ text: "preciso de ajuda" });
  });

  it("does not send while a reply is streaming", () => {
    useChatState.status = "streaming";
    render(<Chat initialConversationId="conv_1" initialMessages={[]} />);
    const textarea = screen.getByLabelText("Mensagem");
    fireEvent.change(textarea, { target: { value: "outra" } });
    fireEvent.submit(textarea.closest("form") as HTMLFormElement);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("shows a toast when useChat reports an error", () => {
    useChatState.error = new Error("boom");
    render(<Chat initialConversationId={null} initialMessages={[]} />);
    expect(toastError).toHaveBeenCalledOnce();
  });

  it("shows the thinking indicator while submitted", () => {
    useChatState.status = "submitted";
    render(<Chat initialConversationId="conv_1" initialMessages={[]} />);
    expect(screen.getByText(/Um agente está respondendo/v)).toBeInTheDocument();
  });
});
