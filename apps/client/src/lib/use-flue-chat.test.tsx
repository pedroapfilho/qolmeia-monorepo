import type * as FlueSdk from "@flue/sdk";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const rawSend = vi.fn();
const hookSendMessage = vi.fn();
const createFlueClient = vi.fn((options: { url: string }) => ({
  send: rawSend,
  url: options.url,
}));

vi.mock("@flue/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof FlueSdk>();
  return { ...actual, createFlueClient };
});

vi.mock("@flue/react", () => ({
  useFlueAgent: vi.fn(() => ({
    error: undefined,
    historyReady: true,
    messages: [],
    sendMessage: hookSendMessage,
    status: "idle",
  })),
}));

const { useFlueChat } = await import("./use-flue-chat");

describe("useFlueChat", () => {
  it("sends customer messages through the React conversation hook", async () => {
    hookSendMessage.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() =>
      useFlueChat({
        agent: "planner",
        baseUrl: "/",
        companyId: "co_test",
      }),
    );

    await act(async () => {
      await result.current.sendMessage({ files: [], text: "  Olá  " });
    });

    expect(hookSendMessage).toHaveBeenCalledWith("Olá", { images: [] });
    expect(rawSend).not.toHaveBeenCalled();
  });

  it("addresses the conversation by agent mount plus company id", () => {
    renderHook(() =>
      useFlueChat({
        agent: "correspondent",
        baseUrl: "https://agents.test/",
        companyId: "co_test",
      }),
    );

    expect(createFlueClient).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://agents.test/agents/correspondent/co_test" }),
    );
  });
});
