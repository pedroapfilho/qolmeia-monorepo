import { describe, expect, it, vi } from "vitest";

import type { AgentDispatchArgs } from "../dispatcher";

import { delegateToSpecialistSkill } from "./delegate-to-specialist";

vi.mock("../templates/registry", () => ({
  findTemplateBySlug: vi.fn(),
}));

vi.mock("../context-snapshot", () => ({
  buildContextSnapshot: vi.fn().mockResolvedValue({
    businessContext: "ctx",
    existingAssets: [],
    mission: "",
    newAssets: [],
    oversizeCount: 0,
  }),
}));

describe("delegateToSpecialistSkill", () => {
  it("has the expected metadata", () => {
    expect(delegateToSpecialistSkill.id).toBe("delegateToSpecialist");
    expect(delegateToSpecialistSkill.displayName).toBe("Delegate to Specialist");
    expect(delegateToSpecialistSkill.requiresApprovalDefault).toBe(false);
    expect(delegateToSpecialistSkill.requiredConnectorTypes).toEqual([]);
  });

  it("validates input via Zod", () => {
    const parsed = delegateToSpecialistSkill.inputSchema.parse({
      subtask: "Captura o perfil do negócio",
      targetTemplateSlug: "designer",
    });
    expect(parsed.targetTemplateSlug).toBe("designer");
    expect(() =>
      delegateToSpecialistSkill.inputSchema.parse({ subtask: "", targetTemplateSlug: "designer" }),
    ).toThrow();
    expect(() =>
      delegateToSpecialistSkill.inputSchema.parse({ subtask: "x", targetTemplateSlug: "" }),
    ).toThrow();
  });

  it("returns ok:false when the parent's template can't delegate to the target", async () => {
    const { findTemplateBySlug } = await import("../templates/registry");
    vi.mocked(findTemplateBySlug)
      .mockReturnValueOnce({ canDelegateTo: [], slug: "designer" } as never)
      .mockReturnValueOnce({ slug: "designer" } as never);

    const fakePrisma = {
      agentInstance: { upsert: vi.fn() },
      agentRun: { create: vi.fn(), update: vi.fn() },
    } as never;
    const fakeDispatcher = { enqueueAndAwait: vi.fn() } as never;

    const result = await delegateToSpecialistSkill.execute(
      { subtask: "x", targetTemplateSlug: "designer" },
      {
        agentInstanceId: "ai_1",
        dispatcher: fakeDispatcher,
        orgId: "org_1",
        parentRunArgs: {
          agentInstance: { templateSlug: "designer" },
        } as unknown as AgentDispatchArgs,
        parentRunId: "run_parent",
        prisma: fakePrisma,
      },
    );

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("cannot delegate");
  });

  it("returns ok:false when target template is not in the registry", async () => {
    const { findTemplateBySlug } = await import("../templates/registry");
    vi.mocked(findTemplateBySlug)
      .mockReturnValueOnce({ canDelegateTo: ["unknown"], slug: "controller" } as never)
      .mockReturnValueOnce(undefined);

    const result = await delegateToSpecialistSkill.execute(
      { subtask: "x", targetTemplateSlug: "unknown" },
      {
        agentInstanceId: "ai_1",
        dispatcher: { enqueueAndAwait: vi.fn() } as never,
        orgId: "org_1",
        parentRunArgs: {
          agentInstance: { templateSlug: "controller" },
        } as unknown as AgentDispatchArgs,
        parentRunId: "run_parent",
        prisma: {
          agentInstance: { upsert: vi.fn() },
          agentRun: { create: vi.fn(), update: vi.fn() },
        } as never,
      },
    );

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/unknown template/iv);
  });

  it("creates a child AgentRun, dispatches with parentRunId + hashed subtask, then finalizes", async () => {
    const { findTemplateBySlug } = await import("../templates/registry");
    // findTemplateBySlug is called 3x: once for parent, once for target,
    // and once inside ensureAgentInstance for the child template.
    vi.mocked(findTemplateBySlug)
      .mockReturnValueOnce({ canDelegateTo: ["designer"], slug: "controller" } as never)
      .mockReturnValueOnce({
        defaultSystemPrompt: "PROMPT",
        displayName: "Designer",
        slug: "designer",
      } as never)
      .mockReturnValueOnce({
        defaultSystemPrompt: "PROMPT",
        displayName: "Designer",
        slug: "designer",
      } as never);

    const childAgent = {
      id: "ai_designer",
      mission: "",
      orgId: "org_1",
      templateSlug: "designer",
    };
    const upsert = vi.fn().mockResolvedValue(childAgent);
    const enqueueAndAwait = vi.fn().mockResolvedValue({
      generatedAssetIds: ["asset_gen_1"],
      text: "Pronto!",
      toolCallSummary: {},
      usage: { inputTokens: 5, outputTokens: 3 },
    });
    const runCreate = vi.fn().mockResolvedValue({ id: "run_child" });
    const runUpdate = vi.fn().mockResolvedValue({ id: "run_child" });

    const parentArgs: AgentDispatchArgs = {
      agentInstance: { id: "ai_controller", orgId: "org_1", templateSlug: "controller" } as never,
      dispatcher: { enqueueAndAwait } as never,
      existingAssets: [],
      input: { imageBytes: [], text: "olá" },
      newAssets: [],
      oversizeCount: 0,
      prisma: {
        agentInstance: { upsert },
        agentRun: { create: runCreate, update: runUpdate },
      } as never,
      runId: "run_parent",
      senderRole: "OWNER",
      systemPrompt: "parent-system",
    };

    const result = await delegateToSpecialistSkill.execute(
      { subtask: "Gera uma imagem promocional", targetTemplateSlug: "designer" },
      {
        agentInstanceId: "ai_controller",
        dispatcher: parentArgs.dispatcher,
        orgId: "org_1",
        parentRunArgs: parentArgs,
        parentRunId: "run_parent",
        prisma: parentArgs.prisma,
      },
    );

    expect(upsert).toHaveBeenCalledOnce();

    // Child AgentRun created with parentRunId pointing at the parent.
    expect(runCreate).toHaveBeenCalledOnce();
    const runCreateArgs = runCreate.mock.calls[0]![0] as {
      data: { agentInstanceId: string; parentRunId: string | null; systemPrompt: string };
    };
    expect(runCreateArgs.data.parentRunId).toBe("run_parent");
    expect(runCreateArgs.data.agentInstanceId).toBe("ai_designer");

    // Dispatch carries runId + delegation origin keyed by parentRunId.
    expect(enqueueAndAwait).toHaveBeenCalledOnce();
    const dispatchArgs = enqueueAndAwait.mock.calls[0]![0] as AgentDispatchArgs;
    expect(dispatchArgs.agentInstance).toBe(childAgent);
    expect(dispatchArgs.input.text).toBe("Gera uma imagem promocional");
    expect(dispatchArgs.runId).toBe("run_child");
    expect(dispatchArgs.dispatchOrigin).toMatchObject({
      childTemplateSlug: "designer",
      kind: "delegation",
      parentRunId: "run_parent",
    });
    // Subtask hash is deterministic and non-empty.
    const origin = dispatchArgs.dispatchOrigin as { subtaskHash: string };
    expect(origin.subtaskHash).toMatch(/^[a-f0-9]{16}$/v);

    // Child run finalized as SUCCEEDED.
    expect(runUpdate).toHaveBeenCalledOnce();
    const runUpdateArgs = runUpdate.mock.calls[0]![0] as {
      data: { status: string };
      where: { id: string };
    };
    expect(runUpdateArgs.where.id).toBe("run_child");
    expect(runUpdateArgs.data.status).toBe("SUCCEEDED");

    expect(result).toEqual({
      generatedAssetIds: ["asset_gen_1"],
      ok: true,
      text: "Pronto!",
      usage: { inputTokens: 5, outputTokens: 3 },
    });
  });

  it("returns ok:false and finalizes the child run as FAILED when the dispatch throws", async () => {
    const { findTemplateBySlug } = await import("../templates/registry");
    vi.mocked(findTemplateBySlug)
      .mockReturnValueOnce({ canDelegateTo: ["designer"], slug: "controller" } as never)
      .mockReturnValueOnce({
        defaultSystemPrompt: "PROMPT",
        displayName: "Designer",
        slug: "designer",
      } as never)
      .mockReturnValueOnce({
        defaultSystemPrompt: "PROMPT",
        displayName: "Designer",
        slug: "designer",
      } as never);

    const enqueueAndAwait = vi.fn().mockRejectedValue(new Error("worker exploded"));
    const runCreate = vi.fn().mockResolvedValue({ id: "run_child" });
    const runUpdate = vi.fn().mockResolvedValue({ id: "run_child" });

    const parentArgs = {
      agentInstance: { templateSlug: "controller" },
      dispatcher: { enqueueAndAwait },
      existingAssets: [],
      input: { imageBytes: [], text: "olá" },
      newAssets: [],
      oversizeCount: 0,
      prisma: {
        agentInstance: { upsert: vi.fn().mockResolvedValue({ id: "ai_designer", mission: "" }) },
        agentRun: { create: runCreate, update: runUpdate },
      },
      runId: "run_parent",
      systemPrompt: "p",
    } as unknown as AgentDispatchArgs;

    const result = await delegateToSpecialistSkill.execute(
      { subtask: "x", targetTemplateSlug: "designer" },
      {
        agentInstanceId: "ai_1",
        dispatcher: parentArgs.dispatcher,
        orgId: "org_1",
        parentRunArgs: parentArgs,
        parentRunId: "run_parent",
        prisma: parentArgs.prisma,
      },
    );

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("worker exploded");
    // The child run was created AND finalized as FAILED.
    expect(runCreate).toHaveBeenCalledOnce();
    expect(runUpdate).toHaveBeenCalledOnce();
    const runUpdateArgs = runUpdate.mock.calls[0]![0] as { data: { status: string } };
    expect(runUpdateArgs.data.status).toBe("FAILED");
  });
});
