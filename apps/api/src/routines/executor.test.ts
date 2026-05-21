import { describe, expect, it, vi } from "vitest";

import { executeRoutine } from "./executor";

const baseRoutineRow = {
  agentInstanceId: "ai_1",
  config: { maxDocs: 5 },
  enabled: true,
  id: "rt_1",
  name: "nightly-knowledge-summary",
  orgId: "org_1",
};

const makePrisma = (over: { routine?: Partial<typeof baseRoutineRow> | null } = {}) => {
  const routineFindUnique = vi
    .fn()
    .mockResolvedValue(over.routine === null ? null : { ...baseRoutineRow, ...over.routine });
  const routineUpdate = vi.fn().mockResolvedValue({});
  const agentUpsert = vi.fn().mockResolvedValue({
    displayName: "Controller",
    id: "ai_1",
    mission: "",
    orgId: "org_1",
    status: "ACTIVE",
    templateSlug: "controller",
  });
  const agentRunCreate = vi
    .fn()
    .mockImplementation(() => Promise.resolve({ id: "run_1", startedAt: new Date() }));
  const agentRunUpdate = vi.fn().mockResolvedValue({
    agentInstanceId: "ai_1",
    costCents: 0,
    finishedAt: new Date(),
    id: "run_1",
    startedAt: new Date(),
    status: "SUCCEEDED",
  });
  const orgFindUnique = vi.fn().mockResolvedValue({
    businessProfile: null,
    id: "org_1",
    name: "Org",
  });
  const knowledgeFindMany = vi.fn().mockResolvedValue([]);
  const activityCreate = vi.fn().mockResolvedValue({ id: "al_1" });
  return {
    activityLog: { create: activityCreate },
    agentInstance: { upsert: agentUpsert },
    agentRun: { create: agentRunCreate, update: agentRunUpdate },
    knowledgeDoc: { findMany: knowledgeFindMany },
    mocks: {
      activityCreate,
      agentRunCreate,
      agentRunUpdate,
      agentUpsert,
      knowledgeFindMany,
      orgFindUnique,
      routineFindUnique,
      routineUpdate,
    },
    organization: { findUnique: orgFindUnique },
    routine: { findUnique: routineFindUnique, update: routineUpdate },
  };
};

const makeDispatcher = (result?: unknown) => {
  const enqueueAndAwait = vi.fn().mockResolvedValue(
    result ?? {
      generatedAssetIds: [],
      text: "tudo certo",
      toolCallSummary: {},
      usage: { inputTokens: 10, outputTokens: 5 },
    },
  );
  return { enqueueAndAwait, mocks: { enqueueAndAwait } };
};

describe("executeRoutine", () => {
  it("returns FAILED + no run when the Routine row is missing", async () => {
    const prisma = makePrisma({ routine: null });
    const dispatcher = makeDispatcher();
    const outcome = await executeRoutine({
      dispatcher: dispatcher as never,
      prisma: prisma as never,
      routineId: "rt_missing",
    });
    expect(outcome).toEqual({ agentRunId: null, status: "FAILED" });
    expect(dispatcher.mocks.enqueueAndAwait).not.toHaveBeenCalled();
  });

  it("bails early without dispatching when the Routine is disabled", async () => {
    const prisma = makePrisma({ routine: { enabled: false } });
    const dispatcher = makeDispatcher();
    const outcome = await executeRoutine({
      dispatcher: dispatcher as never,
      prisma: prisma as never,
      routineId: "rt_1",
    });
    expect(outcome.status).toBe("FAILED");
    expect(dispatcher.mocks.enqueueAndAwait).not.toHaveBeenCalled();
    expect(prisma.mocks.activityCreate).not.toHaveBeenCalled();
  });

  it("records FAILED + lastRunAt when the routine name has no registered definition", async () => {
    const prisma = makePrisma({ routine: { name: "unknown-routine" } });
    const dispatcher = makeDispatcher();
    const outcome = await executeRoutine({
      dispatcher: dispatcher as never,
      prisma: prisma as never,
      routineId: "rt_1",
    });
    expect(outcome).toEqual({ agentRunId: null, status: "FAILED" });
    expect(prisma.mocks.routineUpdate).toHaveBeenCalledWith({
      data: { lastRunAt: expect.any(Date), lastRunStatus: "FAILED" },
      where: { id: "rt_1" },
    });
    expect(dispatcher.mocks.enqueueAndAwait).not.toHaveBeenCalled();
  });

  it("emits ROUTINE_TRIGGERED, dispatches, finalizes, and records SUCCEEDED on the happy path", async () => {
    const prisma = makePrisma();
    const dispatcher = makeDispatcher();
    const outcome = await executeRoutine({
      dispatcher: dispatcher as never,
      prisma: prisma as never,
      routineId: "rt_1",
    });
    expect(outcome).toEqual({ agentRunId: "run_1", status: "SUCCEEDED" });

    // ROUTINE_TRIGGERED activity logged BEFORE dispatch.
    const triggerCall = prisma.mocks.activityCreate.mock.calls.find(
      (c) =>
        (c[0] as { data: { type: string } }).data.type === "ROUTINE_TRIGGERED",
    );
    expect(triggerCall).toBeDefined();
    const triggerData = (triggerCall![0] as { data: { refId: string; refType: string } }).data;
    expect(triggerData.refType).toBe("ROUTINE");
    expect(triggerData.refId).toBe("rt_1");

    // Dispatcher invoked with the buildPrompt output + null senderRole +
    // null trigger message (it's a scheduled invocation).
    expect(dispatcher.mocks.enqueueAndAwait).toHaveBeenCalledOnce();
    const dispatchArgs = dispatcher.mocks.enqueueAndAwait.mock.calls[0]![0] as {
      input: { text?: string };
      runId: string;
      senderRole: string | null;
    };
    expect(dispatchArgs.input.text).toContain("Nenhum documento novo");
    expect(dispatchArgs.senderRole).toBeNull();
    expect(dispatchArgs.runId).toBe("run_1");

    // lastRunStatus persisted as SUCCEEDED.
    expect(prisma.mocks.routineUpdate).toHaveBeenLastCalledWith({
      data: { lastRunAt: expect.any(Date), lastRunStatus: "SUCCEEDED" },
      where: { id: "rt_1" },
    });
  });

  it("records FAILED + lastRunAt when the dispatcher throws", async () => {
    const prisma = makePrisma();
    const dispatcher = {
      enqueueAndAwait: vi.fn().mockRejectedValue(new Error("worker exploded")),
    };
    const outcome = await executeRoutine({
      dispatcher: dispatcher as never,
      prisma: prisma as never,
      routineId: "rt_1",
    });
    expect(outcome.status).toBe("FAILED");
    expect(outcome.agentRunId).toBe("run_1");
    expect(prisma.mocks.routineUpdate).toHaveBeenLastCalledWith({
      data: { lastRunAt: expect.any(Date), lastRunStatus: "FAILED" },
      where: { id: "rt_1" },
    });
  });
});
