import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage, UseFlueChatResult } from "@/lib/use-flue-chat";

import { ChatView, PLANNER_GREETING, PLANNER_KICKOFF } from "./chat";
import type { ChatProps } from "./chat";

class MockObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

globalThis.ResizeObserver = MockObserver;
globalThis.IntersectionObserver = MockObserver as unknown as typeof IntersectionObserver;

if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = () => {};
}

const sendMessage = vi.fn();
type TestMessage = Omit<ChatMessage, "display" | "purpose"> &
  Partial<Pick<ChatMessage, "display" | "purpose">>;

const defaultPurpose = (role: ChatMessage["role"]): ChatMessage["purpose"] => {
  if (role === "assistant") {
    return "assistant";
  }
  if (role === "user") {
    return "user";
  }
  return "advisory";
};

const buildMessage = ({ display, purpose, ...message }: TestMessage): ChatMessage => ({
  ...message,
  display: display ?? "visible",
  purpose: purpose ?? defaultPurpose(message.role),
});

const chatState: UseFlueChatResult = {
  historyReady: true,
  messages: [],
  sendMessage,
  status: "ready",
};
const Chat = ({ agent }: ChatProps) => <ChatView agent={agent} chat={chatState} />;

describe("Chat", () => {
  beforeEach(() => {
    sendMessage.mockReset();
    sendMessage.mockResolvedValue(undefined);
    chatState.historyReady = true;
    chatState.messages = [];
    chatState.status = "ready";
  });

  it("renders the empty state when there are no messages", () => {
    render(<Chat agentsUrl="http://localhost:8787" companyId="co_test" sessionToken="tok" />);
    expect(screen.getByText("Comece a conversa")).toBeInTheDocument();
  });

  it("opens the Planner with a deterministic greeting and no synthetic submission", () => {
    render(
      <Chat
        agent="planner"
        agentsUrl="http://localhost:8787"
        companyId="co_test"
        sessionToken="tok"
      />,
    );
    expect(screen.getByText(PLANNER_GREETING)).toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("keeps the Planner greeting visible after the customer's first message", () => {
    chatState.messages = [
      buildMessage({
        id: "m1",
        parts: [{ state: "done", text: "Nós somos uma padaria.", type: "text" }],
        role: "user",
      }),
    ];
    render(
      <Chat
        agent="planner"
        agentsUrl="http://localhost:8787"
        companyId="co_test"
        sessionToken="tok"
      />,
    );
    expect(screen.getByText(PLANNER_GREETING)).toBeInTheDocument();
    expect(screen.getByText("Nós somos uma padaria.")).toBeInTheDocument();
  });

  it("does not show a thinking spinner for an idle empty Planner transcript", () => {
    chatState.status = "ready";
    chatState.messages = [];
    render(
      <Chat
        agent="planner"
        agentsUrl="http://localhost:8787"
        companyId="co_test"
        sessionToken="tok"
      />,
    );
    expect(screen.queryByText(/Um agente está respondendo/v)).not.toBeInTheDocument();
  });

  it("does not show the Planner greeting for the Correspondent", () => {
    render(
      <Chat
        agent="correspondent"
        agentsUrl="http://localhost:8787"
        companyId="co_test"
        sessionToken="tok"
      />,
    );
    expect(screen.queryByText(PLANNER_GREETING)).not.toBeInTheDocument();
  });

  it("does not show the Planner greeting before durable history loads", () => {
    chatState.historyReady = false;
    render(
      <Chat
        agent="planner"
        agentsUrl="http://localhost:8787"
        companyId="co_test"
        sessionToken="tok"
      />,
    );
    expect(screen.queryByText(PLANNER_GREETING)).not.toBeInTheDocument();
  });

  it("does not prepend the deterministic greeting to legacy kickoff histories", () => {
    chatState.messages = [
      buildMessage({
        id: "m1",
        parts: [{ state: "done", text: PLANNER_KICKOFF, type: "text" }],
        role: "user",
      }),
      buildMessage({
        id: "m2",
        parts: [{ state: "done", text: "Olá! Bem-vindo.", type: "text" }],
        role: "assistant",
      }),
    ];
    render(
      <Chat
        agent="planner"
        agentsUrl="http://localhost:8787"
        companyId="co_test"
        sessionToken="tok"
      />,
    );
    expect(screen.queryByText(PLANNER_GREETING)).not.toBeInTheDocument();
    expect(screen.getByText("Olá! Bem-vindo.")).toBeInTheDocument();
  });

  it("hides the kickoff prompt from the rendered transcript", () => {
    chatState.messages = [
      buildMessage({
        id: "m1",
        parts: [{ state: "done", text: PLANNER_KICKOFF, type: "text" }],
        role: "user",
      }),
      buildMessage({
        id: "m2",
        parts: [{ state: "done", text: "Olá! Bem-vindo.", type: "text" }],
        role: "assistant",
      }),
    ];
    render(
      <Chat
        agent="planner"
        agentsUrl="http://localhost:8787"
        companyId="co_test"
        sessionToken="tok"
      />,
    );
    expect(screen.queryByText(PLANNER_KICKOFF)).not.toBeInTheDocument();
    expect(screen.getByText("Olá! Bem-vindo.")).toBeInTheDocument();
  });

  it("hides diagnostic messages: internal dispatches and runtime advisories", () => {
    chatState.messages = [
      buildMessage({
        display: "diagnostic",
        id: "m1",
        parts: [
          { state: "done", text: "Um especialista do Time concluiu uma tarefa.", type: "text" },
        ],
        purpose: "dispatch",
        role: "user",
      }),
      buildMessage({
        display: "diagnostic",
        id: "m2",
        parts: [{ state: "done", text: 'The tool "rememberFact" was updated.', type: "text" }],
        purpose: "advisory",
        role: "system",
      }),
      buildMessage({
        display: "visible",
        id: "m3",
        parts: [{ state: "done", text: "Sua arte ficou pronta!", type: "text" }],
        role: "assistant",
      }),
    ];
    render(<Chat agentsUrl="http://localhost:8787" companyId="co_test" sessionToken="tok" />);
    expect(screen.queryByText(/Um especialista do Time/v)).not.toBeInTheDocument();
    expect(screen.queryByText(/was updated/v)).not.toBeInTheDocument();
    expect(screen.getByText("Sua arte ficou pronta!")).toBeInTheDocument();
  });

  it("shows a loading skeleton until durable history is ready", () => {
    chatState.historyReady = false;
    render(<Chat agentsUrl="http://localhost:8787" companyId="co_test" sessionToken="tok" />);
    expect(screen.queryByText("Comece a conversa")).not.toBeInTheDocument();
  });

  it("renders an activity marker for an in-flight tool call", () => {
    chatState.messages = [
      buildMessage({
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
      }),
    ];
    render(<Chat agentsUrl="http://localhost:8787" companyId="co_test" sessionToken="tok" />);
    expect(screen.getByText("Encaminhando para o time…")).toBeInTheDocument();
  });

  it("hides assistant turns that only contain settled tool calls", () => {
    chatState.messages = [
      buildMessage({
        id: "m0",
        parts: [{ state: "done", text: "oi", type: "text" }],
        role: "user",
      }),
      buildMessage({
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
      }),
    ];
    render(<Chat agentsUrl="http://localhost:8787" companyId="co_test" sessionToken="tok" />);
    expect(screen.getByText("oi")).toBeInTheDocument();
    expect(document.querySelectorAll('[class*="rounded-2xl"]')).toHaveLength(1);
  });

  it("keeps completed tool calls out of the transcript", () => {
    chatState.messages = [
      buildMessage({
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
      }),
    ];
    render(<Chat agentsUrl="http://localhost:8787" companyId="co_test" sessionToken="tok" />);
    expect(screen.queryByText("Encaminhando para o time…")).not.toBeInTheDocument();
    expect(screen.getByText("Encaminhei para o Designer.")).toBeInTheDocument();
  });

  it("renders messages from the chat hook", () => {
    chatState.messages = [
      buildMessage({
        id: "m1",
        parts: [{ state: "done", text: "oi", type: "text" }],
        role: "user",
      }),
      buildMessage({
        id: "m2",
        parts: [{ state: "done", text: "olá!", type: "text" }],
        role: "assistant",
      }),
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

  it("shows the thinking indicator while submitted", () => {
    chatState.status = "submitted";
    render(<Chat agentsUrl="http://localhost:8787" companyId="co_test" sessionToken="tok" />);
    expect(screen.getByText(/Um agente está respondendo/v)).toBeInTheDocument();
  });
});
