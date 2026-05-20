import { describe, expect, it, vi } from "vitest";

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(function () {
    return {
      add: vi.fn().mockResolvedValue({
        id: "job_1",
        waitUntilFinished: vi.fn().mockResolvedValue({
          generatedAssetIds: [],
          text: "from-worker",
          toolCallSummary: {},
          usage: { inputTokens: 0, outputTokens: 0 },
        }),
      }),
      close: vi.fn(),
    };
  }),
  QueueEvents: vi.fn().mockImplementation(function () {
    return { close: vi.fn() };
  }),
}));

import { createBullMQDispatcher } from "./bullmq-dispatcher";
import type { AgentDispatchArgs } from "./dispatcher";

describe("createBullMQDispatcher", () => {
  it("enqueueAndAwait returns the worker's result", async () => {
    const { close, dispatcher } = createBullMQDispatcher();

    const result = await dispatcher.enqueueAndAwait({
      agentInstance: { id: "ai_1", orgId: "org_1", templateSlug: "controller" } as never,
      currentContext: "",
      dispatcher: {} as never,
      existingAssets: [],
      input: { imageBytes: [], text: "hi" },
      newAssets: [],
      oversizeCount: 0,
      prisma: {} as never,
    } as AgentDispatchArgs);

    expect(result.text).toBe("from-worker");
    await close();
  });
});
