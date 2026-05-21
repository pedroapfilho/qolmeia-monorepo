import { describe, expect, it, vi } from "vitest";

import { createAgentRun, finalizeAgentRun, hashSubtask } from "./runs";

describe("createAgentRun", () => {
  it("persists the row with snapshot/systemPrompt and defaults parentRunId + triggerMessageId to null", async () => {
    const create = vi.fn().mockResolvedValue({ id: "run_1" });
    const prisma = { agentRun: { create } } as never;

    await createAgentRun({
      agentInstanceId: "ai_1",
      contextSnapshot: {
        businessContext: "ctx",
        existingAssets: [],
        mission: "m",
        newAssets: [],
        oversizeCount: 0,
      },
      prisma,
      systemPrompt: "p",
    });

    expect(create).toHaveBeenCalledOnce();
    const arg = create.mock.calls[0]![0] as {
      data: {
        agentInstanceId: string;
        contextSnapshot: object;
        parentRunId: string | null;
        systemPrompt: string;
        triggerMessageId: string | null;
      };
    };
    expect(arg.data.agentInstanceId).toBe("ai_1");
    expect(arg.data.systemPrompt).toBe("p");
    expect(arg.data.parentRunId).toBeNull();
    expect(arg.data.triggerMessageId).toBeNull();
    expect(arg.data.contextSnapshot).toMatchObject({ businessContext: "ctx" });
  });

  it("threads parentRunId and triggerMessageId when supplied", async () => {
    const create = vi.fn().mockResolvedValue({ id: "run_2" });
    const prisma = { agentRun: { create } } as never;

    await createAgentRun({
      agentInstanceId: "ai_2",
      contextSnapshot: {
        businessContext: "",
        existingAssets: [],
        mission: "",
        newAssets: [],
        oversizeCount: 0,
      },
      parentRunId: "run_parent",
      prisma,
      systemPrompt: "p",
      triggerMessageId: "msg_1",
    });

    const arg = create.mock.calls[0]![0] as {
      data: { parentRunId: string | null; triggerMessageId: string | null };
    };
    expect(arg.data.parentRunId).toBe("run_parent");
    expect(arg.data.triggerMessageId).toBe("msg_1");
  });
});

describe("finalizeAgentRun", () => {
  it("marks SUCCEEDED + finishedAt + token usage when result is supplied", async () => {
    const update = vi.fn().mockResolvedValue({ id: "run_1" });
    const prisma = { agentRun: { update } } as never;

    await finalizeAgentRun({
      prisma,
      result: {
        generatedAssetIds: [],
        text: "ok",
        toolCallSummary: {},
        usage: { inputTokens: 42, outputTokens: 7 },
      },
      runId: "run_1",
    });

    expect(update).toHaveBeenCalledOnce();
    const arg = update.mock.calls[0]![0] as {
      data: {
        costInputTokens: number;
        costOutputTokens: number;
        errorMessage: string | null;
        finishedAt: Date;
        status: string;
      };
      where: { id: string };
    };
    expect(arg.where.id).toBe("run_1");
    expect(arg.data.status).toBe("SUCCEEDED");
    expect(arg.data.costInputTokens).toBe(42);
    expect(arg.data.costOutputTokens).toBe(7);
    expect(arg.data.errorMessage).toBeNull();
    expect(arg.data.finishedAt).toBeInstanceOf(Date);
  });

  it("marks FAILED + errorMessage when error is supplied", async () => {
    const update = vi.fn().mockResolvedValue({ id: "run_1" });
    const prisma = { agentRun: { update } } as never;

    await finalizeAgentRun({
      error: new Error("boom"),
      prisma,
      runId: "run_1",
    });

    const arg = update.mock.calls[0]![0] as {
      data: { errorMessage: string | null; status: string };
    };
    expect(arg.data.status).toBe("FAILED");
    expect(arg.data.errorMessage).toBe("boom");
  });
});

describe("hashSubtask", () => {
  it("is deterministic and returns a 16-char hex string", () => {
    const h1 = hashSubtask("gera uma imagem promocional");
    const h2 = hashSubtask("gera uma imagem promocional");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{16}$/v);
  });

  it("returns different hashes for different subtasks", () => {
    expect(hashSubtask("a")).not.toBe(hashSubtask("b"));
  });
});
