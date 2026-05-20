import { describe, expect, it, vi } from "vitest";

import { createSerialDispatcher } from "./dispatcher";
import type { AgentDispatchArgs, AgentRunResult } from "./dispatcher";

describe("createSerialDispatcher", () => {
  it("forwards the args to the runner and returns its result", async () => {
    const fakeResult: AgentRunResult = {
      generatedAssetIds: [],
      text: "ok",
      toolCallSummary: {},
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    const runner = vi.fn().mockResolvedValue(fakeResult);
    const dispatcher = createSerialDispatcher(runner);

    const args = {
      agentInstance: { id: "ai_1" },
      currentContext: "",
      existingAssets: [],
      input: { imageBytes: [], text: "hi" },
      newAssets: [],
      oversizeCount: 0,
      prisma: {},
    } as unknown as AgentDispatchArgs;

    const result = await dispatcher.enqueueAndAwait(args);

    expect(runner).toHaveBeenCalledOnce();
    expect(runner).toHaveBeenCalledWith(args);
    expect(result).toBe(fakeResult);
  });

  it("propagates rejections from the runner", async () => {
    const runner = vi.fn().mockRejectedValue(new Error("boom"));
    const dispatcher = createSerialDispatcher(runner);
    await expect(dispatcher.enqueueAndAwait({} as unknown as AgentDispatchArgs)).rejects.toThrow(
      "boom",
    );
  });
});
