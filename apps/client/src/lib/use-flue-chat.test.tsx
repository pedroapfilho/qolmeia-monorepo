import type * as FlueSdk from "@flue/sdk";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const rawSend = vi.fn();
const hookSendMessage = vi.fn();

vi.mock("@flue/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof FlueSdk>();
  return {
    ...actual,
    createFlueClient: vi.fn(() => ({
      agents: {
        send: rawSend,
      },
    })),
  };
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
  it("sends Planner kickoff through the React conversation hook", async () => {
    hookSendMessage.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() =>
      useFlueChat({
        agent: "planner",
        baseUrl: "/",
        companyId: "co_test",
      }),
    );

    await act(async () => {
      await result.current.kickoff("comece");
    });

    expect(hookSendMessage).toHaveBeenCalledWith("comece");
    expect(rawSend).not.toHaveBeenCalled();
  });
});
