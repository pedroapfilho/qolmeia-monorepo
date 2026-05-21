import { describe, expect, it, vi } from "vitest";

import { ALL_ROUTINES, findRoutineByName, syncRoutines } from "./registry";

describe("registry", () => {
  it("exposes the seeded routines and a name-based lookup", () => {
    expect(ALL_ROUTINES.length).toBeGreaterThan(0);
    expect(findRoutineByName("nightly-knowledge-summary")?.defaultAgentTemplate).toBe("controller");
    expect(findRoutineByName("nonexistent")).toBeUndefined();
  });
});

const makePrisma = ({
  agentExists,
  existingRoutine,
}: {
  agentExists: boolean;
  existingRoutine: boolean;
}) => {
  const agentFindUnique = vi.fn().mockResolvedValue(agentExists ? { id: "agent_1" } : null);
  const routineFindUnique = vi.fn().mockResolvedValue(existingRoutine ? { id: "routine_1" } : null);
  const routineCreate = vi.fn().mockResolvedValue({ id: "routine_new" });
  const routineUpdate = vi.fn().mockResolvedValue({ id: "routine_1" });
  return {
    agentInstance: { findUnique: agentFindUnique },
    mocks: { agentFindUnique, routineCreate, routineFindUnique, routineUpdate },
    routine: {
      create: routineCreate,
      findUnique: routineFindUnique,
      update: routineUpdate,
    },
  };
};

describe("syncRoutines", () => {
  it("returns a no-op result when targetOrgIds is empty", async () => {
    const prisma = makePrisma({ agentExists: true, existingRoutine: false });
    const result = await syncRoutines({ prisma: prisma as never, targetOrgIds: [] });
    expect(result).toEqual({ created: 0, orgsTouched: 0, skipped: 0 });
    expect(prisma.mocks.agentFindUnique).not.toHaveBeenCalled();
    expect(prisma.mocks.routineCreate).not.toHaveBeenCalled();
  });

  it("creates a Routine per definition when no row exists and the AgentInstance is present", async () => {
    const prisma = makePrisma({ agentExists: true, existingRoutine: false });
    const result = await syncRoutines({
      prisma: prisma as never,
      targetOrgIds: ["org_1"],
    });
    expect(result.created).toBe(ALL_ROUTINES.length);
    expect(result.skipped).toBe(0);
    expect(result.orgsTouched).toBe(1);
    expect(prisma.mocks.routineCreate).toHaveBeenCalledTimes(ALL_ROUTINES.length);
    const firstCallData = prisma.mocks.routineCreate.mock.calls[0]![0] as {
      data: { agentInstanceId: string; enabled: boolean; name: string };
    };
    expect(firstCallData.data.enabled).toBe(false);
    expect(firstCallData.data.agentInstanceId).toBe("agent_1");
    expect(firstCallData.data.name).toBe("nightly-knowledge-summary");
  });

  it("skips definitions whose target AgentInstance does not exist", async () => {
    const prisma = makePrisma({ agentExists: false, existingRoutine: false });
    const result = await syncRoutines({
      prisma: prisma as never,
      targetOrgIds: ["org_1"],
    });
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(ALL_ROUTINES.length);
    expect(prisma.mocks.routineCreate).not.toHaveBeenCalled();
  });

  it("refreshes the description on existing rows but never touches `enabled`/`schedule`/`config`", async () => {
    const prisma = makePrisma({ agentExists: true, existingRoutine: true });
    const result = await syncRoutines({
      prisma: prisma as never,
      targetOrgIds: ["org_1"],
    });
    expect(result.created).toBe(0);
    expect(prisma.mocks.routineCreate).not.toHaveBeenCalled();
    expect(prisma.mocks.routineUpdate).toHaveBeenCalledTimes(ALL_ROUTINES.length);
    const updateData = prisma.mocks.routineUpdate.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(Object.keys(updateData.data)).toEqual(["description"]);
  });
});
