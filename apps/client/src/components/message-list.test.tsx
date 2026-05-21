import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/ui/lib/utils", () => ({
  cn: (...args: ReadonlyArray<unknown>) => args.filter(Boolean).join(" "),
}));

// jsdom doesn't implement scrollIntoView; stub it so the auto-scroll
// effect doesn't throw.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const { MessageList } = await import("./message-list");

describe("MessageList", () => {
  it("renders the empty state when there are no messages and no agent activity", () => {
    render(<MessageList agentThinkingFrom={null} messages={[]} />);
    expect(screen.getByText(/Comece a conversa/v)).toBeInTheDocument();
  });

  it("renders every message in order", () => {
    render(
      <MessageList
        agentThinkingFrom={null}
        messages={[
          {
            content: "oi",
            contentType: "TEXT",
            createdAt: "2026-05-21T12:00:00.000Z",
            id: "msg_1",
            metadata: {},
            sender: "CUSTOMER",
          },
          {
            content: "olá!",
            contentType: "TEXT",
            createdAt: "2026-05-21T12:00:10.000Z",
            id: "msg_2",
            metadata: {},
            sender: "AGENT",
          },
        ]}
      />,
    );
    expect(screen.getByText("oi")).toBeInTheDocument();
    expect(screen.getByText("olá!")).toBeInTheDocument();
  });

  it("shows the agent-thinking indicator with the supplied display name", () => {
    render(<MessageList agentThinkingFrom="Designer" messages={[]} />);
    expect(screen.getByText(/Designer está trabalhando/v)).toBeInTheDocument();
  });
});
