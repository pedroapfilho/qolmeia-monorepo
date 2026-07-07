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
  historyReady: true,
  messages: [] as Array<unknown>,
  status: "ready" as string,
};
let capturedChatOptions: { onError?: (error: unknown) => void } = {};

vi.mock("@/lib/use-flue-chat", () => ({
  useFlueChat: (options: { onError?: (error: unknown) => void }) => {
    capturedChatOptions = options;
    return {
      historyReady: chatState.historyReady,
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

// Mirrors PLANNER_KICKOFF in chat.tsx — the transcript filter matches on it.
const KICKOFF_PROMPT =
  "O cliente acabou de abrir o chat de onboarding. Cumprimente-o de forma calorosa e breve, diga em uma frase que você vai fazer algumas perguntas para entender o negócio dele, e já faça a primeira pergunta da entrevista.";

describe("Chat", () => {
  beforeEach(() => {
    sendMessage.mockReset();
    kickoff.mockReset();
    toastError.mockReset();
    capturedChatOptions = {};
    chatState.historyReady = true;
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

  it("does not kick off the Planner before durable history loads", () => {
    chatState.historyReady = false;
    render(
      <Chat
        agent="planner"
        agentsUrl="http://localhost:8787"
        companyId="co_test"
        sessionToken="tok"
      />,
    );
    expect(kickoff).not.toHaveBeenCalled();
  });

  it("does not kick off the Planner again when the transcript replays", () => {
    chatState.messages = [
      { id: "m1", parts: [{ state: "done", text: KICKOFF_PROMPT, type: "text" }], role: "user" },
      {
        id: "m2",
        parts: [{ state: "done", text: "Olá! Bem-vindo.", type: "text" }],
        role: "assistant",
      },
    ];
    render(
      <Chat
        agent="planner"
        agentsUrl="http://localhost:8787"
        companyId="co_test"
        sessionToken="tok"
      />,
    );
    expect(kickoff).not.toHaveBeenCalled();
  });

  it("hides the kickoff prompt from the rendered transcript", () => {
    chatState.messages = [
      { id: "m1", parts: [{ state: "done", text: KICKOFF_PROMPT, type: "text" }], role: "user" },
      {
        id: "m2",
        parts: [{ state: "done", text: "Olá! Bem-vindo.", type: "text" }],
        role: "assistant",
      },
    ];
    render(
      <Chat
        agent="planner"
        agentsUrl="http://localhost:8787"
        companyId="co_test"
        sessionToken="tok"
      />,
    );
    expect(screen.queryByText(KICKOFF_PROMPT)).not.toBeInTheDocument();
    expect(screen.getByText("Olá! Bem-vindo.")).toBeInTheDocument();
  });

  it("shows a loading skeleton until durable history is ready", () => {
    chatState.historyReady = false;
    render(<Chat agentsUrl="http://localhost:8787" companyId="co_test" sessionToken="tok" />);
    expect(screen.queryByText("Comece a conversa")).not.toBeInTheDocument();
  });

  it("renders an activity marker for an in-flight tool call", () => {
    chatState.messages = [
      {
        id: "m1",
        parts: [
          { state: "done", text: "Deixa comigo.", type: "text" },
          {
            input: {},
            state: "input-available",
            toolCallId: "t1",
            toolName: "delegateToWorker",
            type: "dynamic-tool",
          },
        ],
        role: "assistant",
      },
    ];
    render(<Chat agentsUrl="http://localhost:8787" companyId="co_test" sessionToken="tok" />);
    expect(screen.getByText("Encaminhando para o time…")).toBeInTheDocument();
  });

  it("hides assistant turns that only contain settled tool calls", () => {
    chatState.messages = [
      { id: "m0", parts: [{ state: "done", text: "oi", type: "text" }], role: "user" },
      {
        id: "m1",
        parts: [
          {
            input: {},
            output: { ok: true },
            state: "output-available",
            toolCallId: "t1",
            toolName: "recallMemory",
            type: "dynamic-tool",
          },
        ],
        role: "assistant",
      },
    ];
    render(<Chat agentsUrl="http://localhost:8787" companyId="co_test" sessionToken="tok" />);
    expect(screen.getByText("oi")).toBeInTheDocument();
    expect(document.querySelectorAll('[class*="rounded-2xl"]')).toHaveLength(1);
  });

  it("keeps completed tool calls out of the transcript", () => {
    chatState.messages = [
      {
        id: "m1",
        parts: [
          {
            input: {},
            output: { ok: true },
            state: "output-available",
            toolCallId: "t1",
            toolName: "delegateToWorker",
            type: "dynamic-tool",
          },
          { state: "done", text: "Encaminhei para o Designer.", type: "text" },
        ],
        role: "assistant",
      },
    ];
    render(<Chat agentsUrl="http://localhost:8787" companyId="co_test" sessionToken="tok" />);
    expect(screen.queryByText("Encaminhando para o time…")).not.toBeInTheDocument();
    expect(screen.getByText("Encaminhei para o Designer.")).toBeInTheDocument();
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
