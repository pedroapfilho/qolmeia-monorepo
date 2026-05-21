import { describe, expect, it, vi } from "vitest";

import { computeActionStatus, recordAgentAction, resolveActionStatus } from "./actions";

describe("resolveActionStatus", () => {
  it("OWNER + requires=false → AUTO_APPROVED", () => {
    expect(resolveActionStatus({ senderRole: "OWNER", skillRequiresApprovalDefault: false })).toBe(
      "AUTO_APPROVED",
    );
  });

  it("OWNER + requires=true → AUTO_APPROVED (owner-side overrides)", () => {
    expect(resolveActionStatus({ senderRole: "OWNER", skillRequiresApprovalDefault: true })).toBe(
      "AUTO_APPROVED",
    );
  });

  it("CUSTOMER + requires=false → AUTO_APPROVED (skill opts out of approval)", () => {
    expect(
      resolveActionStatus({ senderRole: "CUSTOMER", skillRequiresApprovalDefault: false }),
    ).toBe("AUTO_APPROVED");
  });

  it("CUSTOMER + requires=true → DRAFTED (awaits owner approval)", () => {
    expect(
      resolveActionStatus({ senderRole: "CUSTOMER", skillRequiresApprovalDefault: true }),
    ).toBe("DRAFTED");
  });

  it("null senderRole + requires=true → AUTO_APPROVED (internal/no-connector action)", () => {
    expect(resolveActionStatus({ senderRole: null, skillRequiresApprovalDefault: true })).toBe(
      "AUTO_APPROVED",
    );
  });

  it("null senderRole + requires=false → AUTO_APPROVED", () => {
    expect(resolveActionStatus({ senderRole: null, skillRequiresApprovalDefault: false })).toBe(
      "AUTO_APPROVED",
    );
  });
});

describe("computeActionStatus", () => {
  it("returns FAILED when success is false (regardless of senderRole/skill)", () => {
    expect(
      computeActionStatus({
        senderRole: "CUSTOMER",
        skillId: "generateBrandImage",
        success: false,
      }),
    ).toBe("FAILED");
    expect(computeActionStatus({ senderRole: null, skillId: "extractSoul", success: false })).toBe(
      "FAILED",
    );
  });

  it("looks up the skill's requiresApprovalDefault to apply the §8 rule", () => {
    // generateBrandImage now requires approval. CUSTOMER → DRAFTED.
    expect(
      computeActionStatus({
        senderRole: "CUSTOMER",
        skillId: "generateBrandImage",
        success: true,
      }),
    ).toBe("DRAFTED");
    // OWNER short-circuits regardless of skill.
    expect(
      computeActionStatus({
        senderRole: "OWNER",
        skillId: "generateBrandImage",
        success: true,
      }),
    ).toBe("AUTO_APPROVED");
    // Read-only skill: even on CUSTOMER, AUTO_APPROVED.
    expect(
      computeActionStatus({
        senderRole: "CUSTOMER",
        skillId: "searchKnowledge",
        success: true,
      }),
    ).toBe("AUTO_APPROVED");
  });

  it("unknown skill ids fall back to requires=false (defensive)", () => {
    expect(
      computeActionStatus({ senderRole: "CUSTOMER", skillId: "nonexistent", success: true }),
    ).toBe("AUTO_APPROVED");
  });
});

describe("recordAgentAction", () => {
  it("creates a row with default cost/error fields when not supplied", async () => {
    const create = vi.fn().mockResolvedValue({ id: "act_1" });
    const prisma = { agentAction: { create } } as never;

    await recordAgentAction({
      agentInstanceId: "ai_1",
      prisma,
      proposedInput: { foo: "bar" },
      proposedSummary: "did a thing",
      senderRole: "OWNER",
      skillId: "extractSoul",
    });

    expect(create).toHaveBeenCalledOnce();
    const arg = create.mock.calls[0]![0] as {
      data: { costCents: number; executedAt: Date | null; status: string };
    };
    expect(arg.data.costCents).toBe(0);
    expect(arg.data.status).toBe("AUTO_APPROVED");
    expect(arg.data.executedAt).toBeInstanceOf(Date);
  });

  it("creates a FAILED row with no executedAt when errorMessage is provided", async () => {
    const create = vi.fn().mockResolvedValue({ id: "act_err" });
    const prisma = { agentAction: { create } } as never;

    await recordAgentAction({
      agentInstanceId: "ai_1",
      errorMessage: "Gateway 500",
      prisma,
      proposedInput: {},
      proposedSummary: "tried to generate",
      senderRole: "OWNER",
      skillId: "generateBrandImage",
    });

    const arg = create.mock.calls[0]![0] as {
      data: { errorMessage: string | null; executedAt: Date | null; status: string };
    };
    expect(arg.data.status).toBe("FAILED");
    expect(arg.data.errorMessage).toBe("Gateway 500");
    expect(arg.data.executedAt).toBeNull();
  });

  it("creates a DRAFTED row (no executedAt) for CUSTOMER + requires-approval skill", async () => {
    const create = vi.fn().mockResolvedValue({ id: "act_draft" });
    const prisma = { agentAction: { create } } as never;

    await recordAgentAction({
      agentInstanceId: "ai_1",
      prisma,
      proposedInput: { prompt: "Banner" },
      proposedSummary: "generate banner",
      senderRole: "CUSTOMER",
      skillId: "generateBrandImage",
    });

    const arg = create.mock.calls[0]![0] as {
      data: { executedAt: Date | null; status: string };
    };
    expect(arg.data.status).toBe("DRAFTED");
    expect(arg.data.executedAt).toBeNull();
  });

  it("treats omitted senderRole as null (internal action → AUTO_APPROVED)", async () => {
    const create = vi.fn().mockResolvedValue({ id: "act_internal" });
    const prisma = { agentAction: { create } } as never;

    await recordAgentAction({
      agentInstanceId: "ai_1",
      prisma,
      proposedInput: {},
      proposedSummary: "internal",
      skillId: "generateBrandImage",
    });

    const arg = create.mock.calls[0]![0] as { data: { status: string } };
    expect(arg.data.status).toBe("AUTO_APPROVED");
  });
});
