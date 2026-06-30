import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// jsdom lacks ResizeObserver, IntersectionObserver, and Element.scrollTo — all used by the
// message scroller. One mock covers both observer contracts.
class MockObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

globalThis.ResizeObserver = MockObserver as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver = MockObserver as unknown as typeof IntersectionObserver;

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

const sendMessage = vi.fn();
const kickoff = vi.fn();
const chatState = {
  messages: [] as Array<unknown>,
  status: "ready" as string,
};
let capturedChatOptions: { onError?: (error: unknown) => void } = {};

vi.mock("@/lib/use-flue-chat", () => ({
  useFlueChat: (options: { onError?: (error: unknown) => void }) => {
    capturedChatOptions = options;
    return {
      kickoff,
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

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

const { Chat } = await import("./chat");

describe("Chat", () => {
  beforeEach(() => {
    sendMessage.mockReset();
    kickoff.mockReset();
    toastError.mockReset();
    capturedChatOptions = {};
    chatState.messages = [];
    chatState.status = "ready";
  });

  it("renders the empty state when there are no messages", () => {
    render(<Chat agentsUrl="http://localhost:8787" companyId="co_test" sessionToken="tok" />);
    expect(screen.getByText("Comece a conversa")).toBeInTheDocument();
  });

  it("auto-opens the Planner with a kickoff on mount", () => {
    render(
      <Chat
        agent="planner"
        agentsUrl="http://localhost:8787"
        companyId="co_test"
        sessionToken="tok"
      />,
    );
    expect(kickoff).toHaveBeenCalledTimes(1);
  });

  it("does not kick off the Correspondent", () => {
    render(
      <Chat
        agent="correspondent"
        agentsUrl="http://localhost:8787"
        companyId="co_test"
        sessionToken="tok"
      />,
    );
    expect(kickoff).not.toHaveBeenCalled();
  });

  it("renders messages from the chat hook", () => {
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
});
