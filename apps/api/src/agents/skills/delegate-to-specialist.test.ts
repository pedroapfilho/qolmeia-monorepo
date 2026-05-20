import { describe, expect, it, vi } from "vitest";

import type { AgentDispatchArgs } from "../dispatcher";

import { delegateToSpecialistSkill } from "./delegate-to-specialist";

vi.mock("../templates/registry", () => ({
  findTemplateBySlug: vi.fn(),
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

    const fakePrisma = { agentInstance: { upsert: vi.fn() } } as never;
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
        prisma: { agentInstance: { upsert: vi.fn() } } as never,
      },
    );

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/unknown template/iv);
  });

  it("upserts the child AgentInstance and dispatches with swapped agent + subtask", async () => {
    const { findTemplateBySlug } = await import("../templates/registry");
    vi.mocked(findTemplateBySlug)
      .mockReturnValueOnce({ canDelegateTo: ["designer"], slug: "controller" } as never)
      .mockReturnValueOnce({ displayName: "Designer", slug: "designer" } as never)
      .mockReturnValueOnce({ displayName: "Designer", slug: "designer" } as never);

    const childAgent = { id: "ai_designer", orgId: "org_1", templateSlug: "designer" };
    const upsert = vi.fn().mockResolvedValue(childAgent);
    const enqueueAndAwait = vi.fn().mockResolvedValue({
      generatedAssetIds: ["asset_gen_1"],
      text: "Pronto!",
      toolCallSummary: {},
      usage: { inputTokens: 5, outputTokens: 3 },
    });

    const parentArgs: AgentDispatchArgs = {
      agentInstance: { id: "ai_controller", orgId: "org_1", templateSlug: "controller" } as never,
      currentContext: "perfil-X",
      dispatcher: { enqueueAndAwait } as never,
      existingAssets: [],
      input: { imageBytes: [], text: "olá" },
      newAssets: [],
      oversizeCount: 0,
      prisma: { agentInstance: { upsert } } as never,
    };

    const result = await delegateToSpecialistSkill.execute(
      { subtask: "Gera uma imagem promocional", targetTemplateSlug: "designer" },
      {
        agentInstanceId: "ai_controller",
        dispatcher: parentArgs.dispatcher,
        orgId: "org_1",
        parentRunArgs: parentArgs,
        prisma: parentArgs.prisma,
      },
    );

    expect(upsert).toHaveBeenCalledOnce();
    const upsertArgs = upsert.mock.calls[0]![0] as {
      create: { templateSlug: string };
      where: { orgId_templateSlug: { orgId: string; templateSlug: string } };
    };
    expect(upsertArgs.where.orgId_templateSlug).toEqual({
      orgId: "org_1",
      templateSlug: "designer",
    });
    expect(upsertArgs.create.templateSlug).toBe("designer");

    expect(enqueueAndAwait).toHaveBeenCalledOnce();
    const dispatchArgs = enqueueAndAwait.mock.calls[0]![0] as AgentDispatchArgs;
    expect(dispatchArgs.agentInstance).toBe(childAgent);
    expect(dispatchArgs.input.text).toBe("Gera uma imagem promocional");
    expect(dispatchArgs.currentContext).toBe("perfil-X");
    expect(dispatchArgs.dispatcher).toBe(parentArgs.dispatcher);

    expect(result).toEqual({
      generatedAssetIds: ["asset_gen_1"],
      ok: true,
      text: "Pronto!",
      usage: { inputTokens: 5, outputTokens: 3 },
    });
  });

  it("returns ok:false when the child dispatch throws", async () => {
    const { findTemplateBySlug } = await import("../templates/registry");
    vi.mocked(findTemplateBySlug)
      .mockReturnValueOnce({ canDelegateTo: ["designer"], slug: "controller" } as never)
      .mockReturnValueOnce({ displayName: "Designer", slug: "designer" } as never)
      .mockReturnValueOnce({ displayName: "Designer", slug: "designer" } as never);

    const enqueueAndAwait = vi.fn().mockRejectedValue(new Error("worker exploded"));

    const parentArgs = {
      agentInstance: { templateSlug: "controller" },
      dispatcher: { enqueueAndAwait },
      input: { imageBytes: [], text: "olá" },
    } as unknown as AgentDispatchArgs;

    const result = await delegateToSpecialistSkill.execute(
      { subtask: "x", targetTemplateSlug: "designer" },
      {
        agentInstanceId: "ai_1",
        dispatcher: parentArgs.dispatcher,
        orgId: "org_1",
        parentRunArgs: parentArgs,
        prisma: {
          agentInstance: { upsert: vi.fn().mockResolvedValue({ id: "ai_designer" }) },
        } as never,
      },
    );

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("worker exploded");
  });
});
