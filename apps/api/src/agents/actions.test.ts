import { describe, expect, it, vi } from "vitest";

import { recordAgentAction, resolveActionStatus } from "./actions";

describe("resolveActionStatus", () => {
  it("returns FAILED when success is false", () => {
    expect(resolveActionStatus("extractSoul", false)).toBe("FAILED");
  });

  it("returns AUTO_APPROVED for known skills with success", () => {
    expect(resolveActionStatus("extractSoul", true)).toBe("AUTO_APPROVED");
    expect(resolveActionStatus("delegateToSpecialist", true)).toBe("AUTO_APPROVED");
  });

  it("returns AUTO_APPROVED for unknown skills with success (defensive)", () => {
    expect(resolveActionStatus("nonexistent", true)).toBe("AUTO_APPROVED");
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
      skillId: "generateBrandImage",
    });

    const arg = create.mock.calls[0]![0] as {
      data: { errorMessage: string | null; executedAt: Date | null; status: string };
    };
    expect(arg.data.status).toBe("FAILED");
    expect(arg.data.errorMessage).toBe("Gateway 500");
    expect(arg.data.executedAt).toBeNull();
  });
});
