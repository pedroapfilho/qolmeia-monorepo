import { describe, expect, it, vi } from "vitest";

import { approveAction, editAction, executeApprovedAction, rejectAction } from "./approvals";

const makePrisma = (overrides: {
  action: {
    agentInstanceId?: string;
    id?: string;
    proposedInput?: object;
    runId?: string | null;
    skillId?: string;
    status:
      | "APPROVED"
      | "AUTO_APPROVED"
      | "DRAFTED"
      | "EDITED"
      | "EXECUTED"
      | "FAILED"
      | "REJECTED";
  };
  agentInstance?: { orgId?: string };
}) => {
  const action = {
    agentInstanceId: overrides.action.agentInstanceId ?? "ai_1",
    id: overrides.action.id ?? "act_1",
    proposedInput: overrides.action.proposedInput ?? { prompt: "x" },
    runId: overrides.action.runId === undefined ? "run_1" : overrides.action.runId,
    skillId: overrides.action.skillId ?? "generateBrandImage",
    status: overrides.action.status,
  };
  const agentInstance = {
    orgId: overrides.agentInstance?.orgId ?? "org_1",
    ...overrides.agentInstance,
  };
  return {
    activityLog: { create: vi.fn().mockResolvedValue({ id: "al_1" }) },
    agentAction: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(action),
      update: vi
        .fn()
        .mockImplementation(({ data, where }: { data: object; where: { id: string } }) =>
          Promise.resolve({ ...action, ...data, id: where.id }),
        ),
    },
    agentInstance: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ displayName: "Designer", ...agentInstance }),
    },
  };
};

describe("approveAction", () => {
  it("transitions DRAFTED → APPROVED, stamps decided fields, emits ACTION_APPROVED", async () => {
    const prisma = makePrisma({ action: { status: "DRAFTED" } });

    const result = await approveAction({
      actionId: "act_1",
      decidedByUserId: "user_owner",
      prisma: prisma as never,
    });

    expect(result.status).toBe("APPROVED");
    const updateCall = prisma.agentAction.update.mock.calls[0]![0] as {
      data: { decidedAt: Date; decidedByUserId: string; status: string };
      where: { id: string };
    };
    expect(updateCall.where.id).toBe("act_1");
    expect(updateCall.data.status).toBe("APPROVED");
    expect(updateCall.data.decidedByUserId).toBe("user_owner");
    expect(updateCall.data.decidedAt).toBeInstanceOf(Date);

    const activityCall = prisma.activityLog.create.mock.calls[0]![0] as {
      data: { actorId: string | null; refId: string; type: string };
    };
    expect(activityCall.data.type).toBe("ACTION_APPROVED");
    expect(activityCall.data.refId).toBe("act_1");
    expect(activityCall.data.actorId).toBe("user_owner");
  });

  it("rejects (throws) when the action is not DRAFTED", async () => {
    const prisma = makePrisma({ action: { status: "EXECUTED" } });

    await expect(
      approveAction({
        actionId: "act_1",
        decidedByUserId: "user_owner",
        prisma: prisma as never,
      }),
    ).rejects.toThrow(/DRAFTED/v);

    expect(prisma.agentAction.update).not.toHaveBeenCalled();
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });
});

describe("rejectAction", () => {
  it("transitions DRAFTED → REJECTED, stores reason in errorMessage, emits ACTION_REJECTED", async () => {
    const prisma = makePrisma({ action: { status: "DRAFTED" } });

    await rejectAction({
      actionId: "act_1",
      decidedByUserId: "user_owner",
      prisma: prisma as never,
      reason: "off brand",
    });

    const updateCall = prisma.agentAction.update.mock.calls[0]![0] as {
      data: { errorMessage: string | null; status: string };
    };
    expect(updateCall.data.status).toBe("REJECTED");
    expect(updateCall.data.errorMessage).toBe("off brand");

    const activityCall = prisma.activityLog.create.mock.calls[0]![0] as {
      data: { payload: { reason: string | null }; type: string };
    };
    expect(activityCall.data.type).toBe("ACTION_REJECTED");
    expect(activityCall.data.payload.reason).toBe("off brand");
  });

  it("allows omitting reason (errorMessage null)", async () => {
    const prisma = makePrisma({ action: { status: "DRAFTED" } });

    await rejectAction({
      actionId: "act_1",
      decidedByUserId: "user_owner",
      prisma: prisma as never,
    });

    const updateCall = prisma.agentAction.update.mock.calls[0]![0] as {
      data: { errorMessage: string | null };
    };
    expect(updateCall.data.errorMessage).toBeNull();
  });

  it("rejects (throws) when the action is not DRAFTED", async () => {
    const prisma = makePrisma({ action: { status: "APPROVED" } });

    await expect(
      rejectAction({
        actionId: "act_1",
        decidedByUserId: "user_owner",
        prisma: prisma as never,
      }),
    ).rejects.toThrow(/DRAFTED/v);
  });
});

describe("editAction", () => {
  it("transitions DRAFTED → EDITED, replaces proposedInput, emits ACTION_APPROVED", async () => {
    const prisma = makePrisma({ action: { proposedInput: { prompt: "old" }, status: "DRAFTED" } });
    const newInput = { aspectRatio: "16:9", prompt: "new banner copy" };

    await editAction({
      actionId: "act_1",
      decidedByUserId: "user_owner",
      newInput,
      prisma: prisma as never,
    });

    const updateCall = prisma.agentAction.update.mock.calls[0]![0] as {
      data: { proposedInput: object; status: string };
    };
    expect(updateCall.data.status).toBe("EDITED");
    expect(updateCall.data.proposedInput).toEqual(newInput);

    const activityCall = prisma.activityLog.create.mock.calls[0]![0] as {
      data: { payload: { edited: boolean }; type: string };
    };
    expect(activityCall.data.type).toBe("ACTION_APPROVED");
    expect(activityCall.data.payload.edited).toBe(true);
  });

  it("rejects (throws) when the action is not DRAFTED", async () => {
    const prisma = makePrisma({ action: { status: "REJECTED" } });

    await expect(
      editAction({
        actionId: "act_1",
        decidedByUserId: "user_owner",
        newInput: {},
        prisma: prisma as never,
      }),
    ).rejects.toThrow(/DRAFTED/v);
  });
});

describe("executeApprovedAction", () => {
  it("runs the skill against proposedInput for APPROVED actions, transitions to EXECUTED, emits ACTION_EXECUTED", async () => {
    const prisma = makePrisma({
      action: {
        proposedInput: { goal: "Promover Black Friday" },
        skillId: "draftMarketingStrategy",
        status: "APPROVED",
      },
    });

    const runSkill = vi.fn().mockResolvedValue({ headline: "Black Friday", ok: true });

    const result = await executeApprovedAction({
      actionId: "act_1",
      prisma: prisma as never,
      runSkill,
    });

    expect(runSkill).toHaveBeenCalledOnce();
    const [, input] = runSkill.mock.calls[0]!;
    expect(input).toEqual({ goal: "Promover Black Friday" });

    const updateCall = prisma.agentAction.update.mock.calls[0]![0] as {
      data: { executedAt: Date; resultJson: object | undefined; status: string };
    };
    expect(updateCall.data.status).toBe("EXECUTED");
    expect(updateCall.data.executedAt).toBeInstanceOf(Date);
    expect(updateCall.data.resultJson).toEqual({ headline: "Black Friday", ok: true });
    expect(result.status).toBe("EXECUTED");

    const activityCall = prisma.activityLog.create.mock.calls[0]![0] as { data: { type: string } };
    expect(activityCall.data.type).toBe("ACTION_EXECUTED");
  });

  it("runs the skill for EDITED actions too (uses the edited proposedInput)", async () => {
    const editedInput = { goal: "Edited goal" };
    const prisma = makePrisma({
      action: {
        proposedInput: editedInput,
        skillId: "draftMarketingStrategy",
        status: "EDITED",
      },
    });
    const runSkill = vi.fn().mockResolvedValue({ ok: true });

    await executeApprovedAction({
      actionId: "act_1",
      prisma: prisma as never,
      runSkill,
    });

    expect(runSkill).toHaveBeenCalledOnce();
    const [, input] = runSkill.mock.calls[0]!;
    expect(input).toEqual(editedInput);
  });

  it("transitions to FAILED + emits ACTION_FAILED when the skill throws", async () => {
    const prisma = makePrisma({
      action: { skillId: "generateBrandImage", status: "APPROVED" },
    });
    const runSkill = vi.fn().mockRejectedValue(new Error("gateway 500"));

    const result = await executeApprovedAction({
      actionId: "act_1",
      prisma: prisma as never,
      runSkill,
    });

    expect(result.status).toBe("FAILED");
    const updateCall = prisma.agentAction.update.mock.calls[0]![0] as {
      data: { errorMessage: string | null; status: string };
    };
    expect(updateCall.data.status).toBe("FAILED");
    expect(updateCall.data.errorMessage).toContain("gateway 500");

    const activityCall = prisma.activityLog.create.mock.calls[0]![0] as { data: { type: string } };
    expect(activityCall.data.type).toBe("ACTION_FAILED");
  });

  it("rejects (throws) when status is DRAFTED (must approve first)", async () => {
    const prisma = makePrisma({ action: { status: "DRAFTED" } });

    await expect(
      executeApprovedAction({ actionId: "act_1", prisma: prisma as never }),
    ).rejects.toThrow(/APPROVED.*EDITED/v);
  });

  it("rejects (throws) when status is AUTO_APPROVED (already ran inline)", async () => {
    const prisma = makePrisma({ action: { status: "AUTO_APPROVED" } });

    await expect(
      executeApprovedAction({ actionId: "act_1", prisma: prisma as never }),
    ).rejects.toThrow(/APPROVED.*EDITED/v);
  });

  it("throws when the skill id no longer exists in the registry", async () => {
    const prisma = makePrisma({ action: { skillId: "ghostSkill", status: "APPROVED" } });

    await expect(
      executeApprovedAction({ actionId: "act_1", prisma: prisma as never }),
    ).rejects.toThrow(/unknown skill/v);
  });
});
