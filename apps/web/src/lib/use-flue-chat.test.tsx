import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createUseFlueChat, type ConversationHookOptions } from "./use-flue-chat";

const hookSendMessage = vi.fn();
let capturedOptions: ConversationHookOptions | undefined;
const useFlueChat = createUseFlueChat((options) => {
  capturedOptions = options;
  return {
    error: undefined,
    historyReady: true,
    messages: [],
    sendMessage: hookSendMessage,
    status: "idle",
  };
});

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
  });

  it("addresses the conversation by agent mount plus company id", () => {
    renderHook(() =>
      useFlueChat({
        agent: "correspondent",
        baseUrl: "https://agents.test/",
        companyId: "co_test",
      }),
    );

    expect(capturedOptions?.url).toBe("https://agents.test/agents/correspondent/co_test");
  });
});
