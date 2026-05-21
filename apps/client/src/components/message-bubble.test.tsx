import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/ui/lib/utils", () => ({
  cn: (...args: ReadonlyArray<unknown>) => args.filter(Boolean).join(" "),
}));

const { MessageBubble } = await import("./message-bubble");

describe("MessageBubble", () => {
  it("renders a customer text bubble", () => {
    render(
      <MessageBubble
        message={{
          content: "oi",
          contentType: "TEXT",
          createdAt: "2026-05-21T12:00:00.000Z",
          id: "msg_1",
          metadata: {},
          sender: "CUSTOMER",
        }}
      />,
    );
    expect(screen.getByText("oi")).toBeInTheDocument();
  });

  it("renders an agent text bubble", () => {
    render(
      <MessageBubble
        message={{
          content: "como posso ajudar?",
          contentType: "TEXT",
          createdAt: "2026-05-21T12:00:00.000Z",
          id: "msg_2",
          metadata: {},
          sender: "AGENT",
        }}
      />,
    );
    expect(screen.getByText("como posso ajudar?")).toBeInTheDocument();
  });

  it("renders the asset id as an img src for IMAGE messages with metadata.assetId", () => {
    render(
      <MessageBubble
        message={{
          content: "asset.png",
          contentType: "IMAGE",
          createdAt: "2026-05-21T12:00:00.000Z",
          id: "msg_3",
          metadata: { assetId: "ba_42" },
          sender: "AGENT",
        }}
      />,
    );
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toContain("/api/v1/web-chat/assets/ba_42");
  });

  it("renders a system bubble centred", () => {
    render(
      <MessageBubble
        message={{
          content: "Designer está pensando...",
          contentType: "TEXT",
          createdAt: "2026-05-21T12:00:00.000Z",
          id: "msg_4",
          metadata: {},
          sender: "SYSTEM",
        }}
      />,
    );
    expect(screen.getByText("Designer está pensando...")).toBeInTheDocument();
  });
});
