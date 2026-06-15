import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `use-stick-to-bottom` (used by Conversation) observes element resizes;
// jsdom ships no ResizeObserver, so stub one.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const sendMessage = vi.fn();
const chatState = {
  messages: [] as Array<unknown>,
  status: "ready" as string,
};
let capturedChatOptions: { onError?: (error: Error) => void } = {};

const agentCall = vi.fn();
vi.mock("agents/react", () => ({
  useAgent: () => ({ call: agentCall, id: "test-agent" }),
}));

vi.mock("@cloudflare/ai-chat/react", () => ({
  useAgentChat: (options: { onError?: (error: Error) => void }) => {
    capturedChatOptions = options;
    return {
      messages: chatState.messages,
      sendMessage,
      status: chatState.status,
    };
  },
}));

const toastError = vi.fn();
vi.mock("@repo/ui/lib/toast", () => ({
  toast: { error: toastError, success: vi.fn() },
}));

// streamdown pulls heavy markdown deps; a passthrough keeps the test focused.
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

const { Chat } = await import("./chat");

describe("Chat", () => {
  beforeEach(() => {
    agentCall.mockClear();
    sendMessage.mockReset();
    toastError.mockReset();
    capturedChatOptions = {};
    chatState.messages = [];
    chatState.status = "ready";
  });

  it("renders the empty state when there are no messages", () => {
    render(<Chat agentsUrl="http://localhost:8787" companyId="co_test" sessionToken="tok" />);
    expect(screen.getByText("Comece a conversa")).toBeInTheDocument();
  });

  it("renders messages from useAgentChat", () => {
    chatState.messages = [
      { id: "m1", parts: [{ text: "oi", type: "text" }], role: "user" },
      { id: "m2", parts: [{ text: "olá!", type: "text" }], role: "assistant" },
    ];
    render(<Chat agentsUrl="http://localhost:8787" companyId="co_test" sessionToken="tok" />);
    expect(screen.getByText("oi")).toBeInTheDocument();
    expect(screen.getByText("olá!")).toBeInTheDocument();
  });

  it("sends the typed message on submit", () => {
    render(<Chat agentsUrl="http://localhost:8787" companyId="co_test" sessionToken="tok" />);
    const textarea = screen.getByLabelText("Mensagem");
    fireEvent.change(textarea, { target: { value: "preciso de ajuda" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(sendMessage).toHaveBeenCalledWith({ files: [], text: "preciso de ajuda" });
  });

  it("does not send while a reply is streaming", () => {
    chatState.status = "streaming";
    render(<Chat agentsUrl="http://localhost:8787" companyId="co_test" sessionToken="tok" />);
    const textarea = screen.getByLabelText("Mensagem");
    fireEvent.change(textarea, { target: { value: "outra" } });
    fireEvent.submit(textarea.closest("form") as HTMLFormElement);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("shows a toast when the chat reports an error", () => {
    render(<Chat agentsUrl="http://localhost:8787" companyId="co_test" sessionToken="tok" />);
    capturedChatOptions.onError?.(new Error("boom"));
    expect(toastError).toHaveBeenCalledOnce();
  });

  it("shows the thinking indicator while submitted", () => {
    chatState.status = "submitted";
    render(<Chat agentsUrl="http://localhost:8787" companyId="co_test" sessionToken="tok" />);
    expect(screen.getByText(/Um agente está respondendo/v)).toBeInTheDocument();
  });

  describe("opening kickoff", () => {
    it("opens the conversation once when planner transcript is empty", () => {
      render(<Chat agent="planner" agentsUrl="" companyId="c1" sessionToken="t" />);
      expect(agentCall).toHaveBeenCalledTimes(1);
      expect(agentCall).toHaveBeenCalledWith("startOpeningTurn");
    });

    it("does not open for the correspondent", () => {
      render(<Chat agent="correspondent" agentsUrl="" companyId="c1" sessionToken="t" />);
      expect(agentCall).not.toHaveBeenCalled();
    });

    it("does not open when the transcript already has messages", () => {
      chatState.messages = [{ id: "m1", parts: [{ text: "oi", type: "text" }], role: "user" }];
      render(<Chat agent="planner" agentsUrl="" companyId="c1" sessionToken="t" />);
      expect(agentCall).not.toHaveBeenCalled();
    });
  });
});
