import { describe, expect, it, vi } from "vitest";

import { reconcileRoutines, schedulerIdFor } from "./reconcile";

type FakeScheduler = { key: string; pattern?: string; tz?: string };

const makePrisma = (rows: ReadonlyArray<{
  enabled: boolean;
  id: string;
  schedule: string;
  timezone: string;
}>) => {
  const findMany = vi.fn().mockResolvedValue(rows);
  return { mocks: { findMany }, routine: { findMany } };
};

const makeQueue = (existing: ReadonlyArray<FakeScheduler>) => {
  const getJobSchedulers = vi.fn().mockResolvedValue(existing);
  const upsertJobScheduler = vi.fn().mockResolvedValue({});
  const removeJobScheduler = vi.fn().mockResolvedValue(true);
  return {
    getJobSchedulers,
    mocks: { getJobSchedulers, removeJobScheduler, upsertJobScheduler },
    removeJobScheduler,
    upsertJobScheduler,
  };
};

describe("schedulerIdFor", () => {
  it("namespaces routine schedulers under routine:<id>", () => {
    expect(schedulerIdFor("abc123")).toBe("routine:abc123");
  });
});

describe("reconcileRoutines", () => {
  it("adds schedulers for newly enabled routines that aren't registered", async () => {
    const prisma = makePrisma([
      { enabled: true, id: "r1", schedule: "0 3 * * *", timezone: "America/Sao_Paulo" },
    ]);
    const queue = makeQueue([]);
    const summary = await reconcileRoutines({
      prisma: prisma as never,
      queue: queue as never,
    });
    expect(summary).toEqual({ added: 1, removed: 0, updated: 0 });
    expect(queue.mocks.upsertJobScheduler).toHaveBeenCalledOnce();
    const call = queue.mocks.upsertJobScheduler.mock.calls[0]!;
    expect(call[0]).toBe("routine:r1");
    expect(call[1]).toEqual({ pattern: "0 3 * * *", tz: "America/Sao_Paulo" });
    expect((call[2] as { data: { routineId: string } }).data.routineId).toBe("r1");
  });

  it("removes schedulers whose Routine is disabled or no longer present", async () => {
    const prisma = makePrisma([
      { enabled: false, id: "r1", schedule: "0 3 * * *", timezone: "America/Sao_Paulo" },
    ]);
    const queue = makeQueue([
      { key: "routine:r1", pattern: "0 3 * * *", tz: "America/Sao_Paulo" },
      { key: "routine:r-stale", pattern: "0 4 * * *", tz: "America/Sao_Paulo" },
    ]);
    const summary = await reconcileRoutines({
      prisma: prisma as never,
      queue: queue as never,
    });
    expect(summary.removed).toBe(2);
    expect(summary.added).toBe(0);
    expect(summary.updated).toBe(0);
    expect(queue.mocks.removeJobScheduler).toHaveBeenCalledWith("routine:r1");
    expect(queue.mocks.removeJobScheduler).toHaveBeenCalledWith("routine:r-stale");
  });

  it("re-upserts when the cron pattern drifts", async () => {
    const prisma = makePrisma([
      { enabled: true, id: "r1", schedule: "0 9 * * 1", timezone: "America/Sao_Paulo" },
    ]);
    const queue = makeQueue([
      { key: "routine:r1", pattern: "0 3 * * *", tz: "America/Sao_Paulo" },
    ]);
    const summary = await reconcileRoutines({
      prisma: prisma as never,
      queue: queue as never,
    });
    expect(summary.updated).toBe(1);
    expect(summary.added).toBe(0);
    expect(summary.removed).toBe(0);
    expect(queue.mocks.upsertJobScheduler).toHaveBeenCalledOnce();
    expect(queue.mocks.upsertJobScheduler.mock.calls[0]![1]).toEqual({
      pattern: "0 9 * * 1",
      tz: "America/Sao_Paulo",
    });
  });

  it("re-upserts when the timezone drifts", async () => {
    const prisma = makePrisma([
      { enabled: true, id: "r1", schedule: "0 3 * * *", timezone: "UTC" },
    ]);
    const queue = makeQueue([
      { key: "routine:r1", pattern: "0 3 * * *", tz: "America/Sao_Paulo" },
    ]);
    const summary = await reconcileRoutines({
      prisma: prisma as never,
      queue: queue as never,
    });
    expect(summary.updated).toBe(1);
  });

  it("is a no-op when nothing changed", async () => {
    const prisma = makePrisma([
      { enabled: true, id: "r1", schedule: "0 3 * * *", timezone: "America/Sao_Paulo" },
    ]);
    const queue = makeQueue([
      { key: "routine:r1", pattern: "0 3 * * *", tz: "America/Sao_Paulo" },
    ]);
    const summary = await reconcileRoutines({
      prisma: prisma as never,
      queue: queue as never,
    });
    expect(summary).toEqual({ added: 0, removed: 0, updated: 0 });
    expect(queue.mocks.upsertJobScheduler).not.toHaveBeenCalled();
    expect(queue.mocks.removeJobScheduler).not.toHaveBeenCalled();
  });

  it("leaves non-routine schedulers alone", async () => {
    const prisma = makePrisma([]);
    const queue = makeQueue([
      { key: "some-other-system:job-1", pattern: "0 0 * * *" },
    ]);
    const summary = await reconcileRoutines({
      prisma: prisma as never,
      queue: queue as never,
    });
    expect(summary).toEqual({ added: 0, removed: 0, updated: 0 });
    expect(queue.mocks.removeJobScheduler).not.toHaveBeenCalled();
  });
});
