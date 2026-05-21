import { describe, expect, it, vi } from "vitest";

const addMock = vi.fn();

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(function () {
    return {
      add: addMock,
      close: vi.fn(),
    };
  }),
  QueueEvents: vi.fn().mockImplementation(function () {
    return { close: vi.fn() };
  }),
}));

import { createBullMQDispatcher } from "./bullmq-dispatcher";
import type { AgentDispatchArgs } from "./dispatcher";

const successJob = (text = "from-worker") => ({
  id: "job_1",
  waitUntilFinished: vi.fn().mockResolvedValue({
    generatedAssetIds: [],
    text,
    toolCallSummary: {},
    usage: { inputTokens: 0, outputTokens: 0 },
  }),
});

const baseArgs = (over: Partial<AgentDispatchArgs> = {}): AgentDispatchArgs =>
  ({
    agentInstance: { id: "ai_1", orgId: "org_1", templateSlug: "controller" },
    dispatcher: {} as never,
    existingAssets: [],
    input: { imageBytes: [], text: "hi" },
    newAssets: [],
    oversizeCount: 0,
    prisma: {} as never,
    runId: "run_1",
    systemPrompt: "system",
    ...over,
  }) as AgentDispatchArgs;

describe("createBullMQDispatcher", () => {
  it("enqueueAndAwait returns the worker's result", async () => {
    addMock.mockReset().mockResolvedValue(successJob());
    const { close, dispatcher } = createBullMQDispatcher();

    const result = await dispatcher.enqueueAndAwait(baseArgs());

    expect(result.text).toBe("from-worker");
    await close();
  });

  it("uses inbox:<connectorInstanceId>:<threadId>:<msgId> as jobId for top-level runs", async () => {
    addMock.mockReset().mockResolvedValue(successJob());
    const { close, dispatcher } = createBullMQDispatcher();

    await dispatcher.enqueueAndAwait(
      baseArgs({
        dispatchOrigin: {
          connectorInstanceId: "ci_42",
          externalThreadId: "tg_chat_99",
          kind: "inbound",
          triggerMessageExternalId: "msg_777",
        },
      }),
    );

    expect(addMock).toHaveBeenCalledOnce();
    const opts = addMock.mock.calls[0]![2] as { jobId?: string };
    expect(opts.jobId).toBe("inbox:ci_42:tg_chat_99:msg_777");
    await close();
  });

  it("uses delegate:<parentRunId>:<childTemplateSlug>:<subtaskHash> as jobId for delegation runs", async () => {
    addMock.mockReset().mockResolvedValue(successJob());
    const { close, dispatcher } = createBullMQDispatcher();

    await dispatcher.enqueueAndAwait(
      baseArgs({
        dispatchOrigin: {
          childTemplateSlug: "designer",
          kind: "delegation",
          parentRunId: "run_parent",
          subtaskHash: "abc123",
        },
      }),
    );

    expect(addMock).toHaveBeenCalledOnce();
    const opts = addMock.mock.calls[0]![2] as { jobId?: string };
    expect(opts.jobId).toBe("delegate:run_parent:designer:abc123");
    await close();
  });

  it("falls back to legacy connector token when connectorInstanceId is null", async () => {
    addMock.mockReset().mockResolvedValue(successJob());
    const { close, dispatcher } = createBullMQDispatcher();

    await dispatcher.enqueueAndAwait(
      baseArgs({
        dispatchOrigin: {
          connectorInstanceId: null,
          externalThreadId: "tg_chat_legacy",
          kind: "inbound",
          triggerMessageExternalId: "msg_001",
        },
      }),
    );

    const opts = addMock.mock.calls[0]![2] as { jobId?: string };
    expect(opts.jobId).toBe("inbox:legacy:tg_chat_legacy:msg_001");
    await close();
  });

  it("second enqueue with same jobId returns the result of the first run", async () => {
    // BullMQ's contract: when a job with the given jobId already exists
    // (queued/active/completed), `queue.add` returns the existing job and
    // `waitUntilFinished` resolves with that run's result. We emulate that
    // by returning the same job object for both calls.
    const sharedWait = vi.fn().mockResolvedValue({
      generatedAssetIds: [],
      text: "first-run",
      toolCallSummary: {},
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    const sharedJob = { id: "inbox:ci_1:t_1:m_1", waitUntilFinished: sharedWait };
    addMock.mockReset().mockResolvedValue(sharedJob);

    const { close, dispatcher } = createBullMQDispatcher();
    const args = baseArgs({
      dispatchOrigin: {
        connectorInstanceId: "ci_1",
        externalThreadId: "t_1",
        kind: "inbound",
        triggerMessageExternalId: "m_1",
      },
    });

    const [a, b] = await Promise.all([
      dispatcher.enqueueAndAwait(args),
      dispatcher.enqueueAndAwait(args),
    ]);

    expect(a.text).toBe("first-run");
    expect(b.text).toBe("first-run");
    expect(addMock).toHaveBeenCalledTimes(2);
    // Both calls carried the same jobId — BullMQ uses that to short-circuit.
    const opts0 = addMock.mock.calls[0]![2] as { jobId?: string };
    const opts1 = addMock.mock.calls[1]![2] as { jobId?: string };
    expect(opts0.jobId).toBe("inbox:ci_1:t_1:m_1");
    expect(opts1.jobId).toBe(opts0.jobId);
    await close();
  });
});
