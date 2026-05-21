import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  gateway: vi.fn(() => ({})),
  generateText: vi.fn(),
  stepCountIs: vi.fn((n: number) => ({ steps: n })),
  tool: vi.fn((t: unknown) => t),
}));

import { generateText } from "ai";

import { resolveEnabledSkills, runAgentInstance } from "./runtime";

const mockedGenerateText = vi.mocked(generateText as unknown as ReturnType<typeof vi.fn>);

// Builds a prisma stub with a controllable agentSkillEnablement.findMany
// response. Defaults to "no enablements" (runtime should fall back to
// template defaults).
const makePrisma = (
  enablements: ReadonlyArray<{ skillId: string }> = [],
): {
  activityLog: { create: ReturnType<typeof vi.fn> };
  agentAction: { aggregate: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  agentSkillEnablement: { findMany: ReturnType<typeof vi.fn> };
  brandAsset: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
} => ({
  activityLog: { create: vi.fn().mockResolvedValue({ id: "al_1" }) },
  agentAction: {
    aggregate: vi.fn().mockResolvedValue({ _sum: { costCents: 0 } }),
    create: vi.fn().mockResolvedValue({ id: "act_default" }),
  },
  agentSkillEnablement: { findMany: vi.fn().mockResolvedValue(enablements) },
  brandAsset: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
});

describe("runAgentInstance", () => {
  it("uses the systemPrompt passed in (no template rendering) and wires all 5 designer skills", async () => {
    mockedGenerateText.mockResolvedValue({
      text: "Olá!",
      toolCalls: [],
      toolResults: [],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    } as never);

    const prisma = makePrisma() as never;

    const agentInstance = {
      budgetCents: 0,
      id: "ai_1",
      mission: "",
      orgId: "org_1",
      templateSlug: "designer",
    } as never;

    const result = await runAgentInstance({
      agentInstance,
      dispatcher: { enqueueAndAwait: vi.fn() } as never,
      existingAssets: [],
      input: { imageBytes: [], text: "oi" },
      newAssets: [],
      oversizeCount: 0,
      prisma,
      runId: "run_1",
      senderRole: "OWNER",
      systemPrompt: "PROMPT-FROZEN-AT-DISPATCH",
    });

    expect(mockedGenerateText).toHaveBeenCalledOnce();
    const args = mockedGenerateText.mock.calls[0]![0] as {
      system: string;
      tools: Record<string, unknown>;
    };
    expect(Object.keys(args.tools).toSorted()).toEqual([
      "extractSoul",
      "generateBrandImage",
      "labelBrandAsset",
      "readKnowledgeDoc",
      "searchKnowledge",
    ]);
    // Runtime does NOT re-render — it must pass through exactly what
    // the dispatcher handed it.
    expect(args.system).toBe("PROMPT-FROZEN-AT-DISPATCH");
    expect(result.text).toBe("Olá!");
    expect(result.usage.inputTokens).toBe(10);
  });

  it("respects AgentSkillEnablement rows when present (overrides template defaults)", async () => {
    mockedGenerateText.mockResolvedValue({
      text: ".",
      toolCalls: [],
      toolResults: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    } as never);

    const prisma = makePrisma([{ skillId: "extractSoul" }]) as never;

    const agentInstance = {
      budgetCents: 0,
      id: "ai_2",
      mission: "",
      orgId: "org_1",
      templateSlug: "designer",
    } as never;

    await runAgentInstance({
      agentInstance,
      dispatcher: { enqueueAndAwait: vi.fn() } as never,
      existingAssets: [],
      input: { imageBytes: [], text: "oi" },
      newAssets: [],
      oversizeCount: 0,
      prisma,
      runId: "run_2",
      senderRole: "OWNER",
      systemPrompt: "p",
    });

    const args = mockedGenerateText.mock.calls.at(-1)![0] as { tools: Record<string, unknown> };
    expect(Object.keys(args.tools)).toEqual(["extractSoul"]);
  });

  it("throws when the agent's templateSlug isn't in the registry", async () => {
    const prisma = makePrisma() as never;
    const agentInstance = {
      budgetCents: 0,
      id: "ai_3",
      mission: "",
      orgId: "org_1",
      templateSlug: "ghost-template",
    } as never;

    await expect(
      runAgentInstance({
        agentInstance,
        dispatcher: { enqueueAndAwait: vi.fn() } as never,
        existingAssets: [],
        input: { imageBytes: [], text: "oi" },
        newAssets: [],
        oversizeCount: 0,
        prisma,
        runId: "run_3",
        senderRole: "OWNER",
        systemPrompt: "p",
      }),
    ).rejects.toThrow(/template/iv);
  });

  it("aggregates tool calls + results across all agent steps via step.content[]", async () => {
    mockedGenerateText.mockResolvedValue({
      steps: [
        {
          content: [
            { toolName: "generateBrandImage", type: "tool-call" },
            {
              output: { assetId: "asset_gen_1", ok: true },
              toolName: "generateBrandImage",
              type: "tool-result",
            },
          ],
        },
        { content: [] },
      ],
      text: "Pronto.",
      toolCalls: [],
      toolResults: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    } as never);

    const prisma = makePrisma() as never;
    const agentInstance = {
      budgetCents: 0,
      id: "ai_4",
      mission: "",
      orgId: "org_1",
      templateSlug: "designer",
    } as never;

    const result = await runAgentInstance({
      agentInstance,
      dispatcher: { enqueueAndAwait: vi.fn() } as never,
      existingAssets: [],
      input: { imageBytes: [], text: "gera uma imagem" },
      newAssets: [],
      oversizeCount: 0,
      prisma,
      runId: "run_4",
      senderRole: "OWNER",
      systemPrompt: "p",
    });

    expect(result.generatedAssetIds).toEqual(["asset_gen_1"]);
    expect(result.toolCallSummary.generateBrandImage).toBe(1);
  });

  it("aggregates generatedAssetIds from delegateToSpecialist tool-results", async () => {
    mockedGenerateText.mockResolvedValue({
      steps: [
        {
          content: [
            { toolName: "delegateToSpecialist", type: "tool-call" },
            {
              output: {
                generatedAssetIds: ["asset_via_child_1", "asset_via_child_2"],
                ok: true,
                text: "child reply",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
              toolName: "delegateToSpecialist",
              type: "tool-result",
            },
          ],
        },
        { content: [] },
      ],
      text: "Pronto via controller.",
      toolCalls: [],
      toolResults: [],
      usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
    } as never);

    const prisma = makePrisma() as never;
    const agentInstance = {
      budgetCents: 0,
      id: "ai_ctl",
      mission: "",
      orgId: "org_1",
      templateSlug: "designer",
    } as never;

    const result = await runAgentInstance({
      agentInstance,
      dispatcher: { enqueueAndAwait: vi.fn() } as never,
      existingAssets: [],
      input: { imageBytes: [], text: "delega aí" },
      newAssets: [],
      oversizeCount: 0,
      prisma,
      runId: "run_ctl",
      senderRole: "OWNER",
      systemPrompt: "p",
    });

    expect(result.generatedAssetIds).toEqual(["asset_via_child_1", "asset_via_child_2"]);
  });

  it("persists AgentActions with runId tying them to the parent AgentRun", async () => {
    mockedGenerateText.mockResolvedValue({
      steps: [
        {
          content: [
            { input: { foo: 1 }, toolName: "extractSoul", type: "tool-call" },
            { output: { ok: true }, toolName: "extractSoul", type: "tool-result" },
          ],
        },
      ],
      text: ".",
      toolCalls: [],
      toolResults: [],
      usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
    } as never);

    const create = vi.fn().mockResolvedValue({ id: "act_1" });
    const prisma = {
      activityLog: { create: vi.fn().mockResolvedValue({ id: "al_1" }) },
      agentAction: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { costCents: 0 } }),
        create,
      },
      agentSkillEnablement: { findMany: vi.fn().mockResolvedValue([]) },
      brandAsset: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    } as never;

    const agentInstance = {
      budgetCents: 0,
      id: "ai_run",
      mission: "",
      orgId: "org_1",
      templateSlug: "designer",
    } as never;

    await runAgentInstance({
      agentInstance,
      dispatcher: { enqueueAndAwait: vi.fn() } as never,
      existingAssets: [],
      input: { imageBytes: [], text: "x" },
      newAssets: [],
      oversizeCount: 0,
      prisma,
      runId: "run_persist",
      senderRole: "OWNER",
      systemPrompt: "p",
    });

    expect(create).toHaveBeenCalledOnce();
    const arg = create.mock.calls[0]![0] as { data: { runId: string | null } };
    expect(arg.data.runId).toBe("run_persist");
  });

  it("emits an ACTION_EXECUTED ActivityLog row alongside each successful AgentAction", async () => {
    mockedGenerateText.mockResolvedValue({
      steps: [
        {
          content: [
            { input: { foo: 1 }, toolName: "extractSoul", type: "tool-call" },
            { output: { ok: true }, toolName: "extractSoul", type: "tool-result" },
          ],
        },
      ],
      text: ".",
      toolCalls: [],
      toolResults: [],
      usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
    } as never);

    const activityCreate = vi.fn().mockResolvedValue({ id: "al_action" });
    const prisma = {
      activityLog: { create: activityCreate },
      agentAction: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { costCents: 0 } }),
        create: vi.fn().mockResolvedValue({ id: "act_emit" }),
      },
      agentSkillEnablement: { findMany: vi.fn().mockResolvedValue([]) },
      brandAsset: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    } as never;

    const agentInstance = {
      budgetCents: 0,
      displayName: "Designer",
      id: "ai_emit",
      mission: "",
      orgId: "org_emit",
      templateSlug: "designer",
    } as never;

    await runAgentInstance({
      agentInstance,
      dispatcher: { enqueueAndAwait: vi.fn() } as never,
      existingAssets: [],
      input: { imageBytes: [], text: "x" },
      newAssets: [],
      oversizeCount: 0,
      prisma,
      runId: "run_emit",
      senderRole: "OWNER",
      systemPrompt: "p",
    });

    expect(activityCreate).toHaveBeenCalledOnce();
    const arg = activityCreate.mock.calls[0]![0] as {
      data: { orgId: string; refId: string; summary: string; type: string };
    };
    expect(arg.data.type).toBe("ACTION_EXECUTED");
    expect(arg.data.refId).toBe("act_emit");
    expect(arg.data.orgId).toBe("org_emit");
    expect(arg.data.summary).toContain("Extract Soul");
  });

  it("emits an ACTION_FAILED ActivityLog row when the tool-result is not ok", async () => {
    mockedGenerateText.mockResolvedValue({
      steps: [
        {
          content: [
            { input: {}, toolName: "generateBrandImage", type: "tool-call" },
            {
              output: { error: "boom", ok: false },
              toolName: "generateBrandImage",
              type: "tool-result",
            },
          ],
        },
      ],
      text: ".",
      toolCalls: [],
      toolResults: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    } as never);

    const activityCreate = vi.fn().mockResolvedValue({ id: "al_fail" });
    const prisma = {
      activityLog: { create: activityCreate },
      agentAction: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { costCents: 0 } }),
        create: vi.fn().mockResolvedValue({ id: "act_fail" }),
      },
      agentSkillEnablement: { findMany: vi.fn().mockResolvedValue([]) },
      brandAsset: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    } as never;

    const agentInstance = {
      budgetCents: 0,
      displayName: "Designer",
      id: "ai_fail",
      mission: "",
      orgId: "org_fail",
      templateSlug: "designer",
    } as never;

    await runAgentInstance({
      agentInstance,
      dispatcher: { enqueueAndAwait: vi.fn() } as never,
      existingAssets: [],
      input: { imageBytes: [], text: "x" },
      newAssets: [],
      oversizeCount: 0,
      prisma,
      runId: "run_fail",
      senderRole: "OWNER",
      systemPrompt: "p",
    });

    const arg = activityCreate.mock.calls[0]![0] as {
      data: { payload: { errorMessage: string }; type: string };
    };
    expect(arg.data.type).toBe("ACTION_FAILED");
    expect(arg.data.payload.errorMessage).toBe("boom");
  });
});

describe("resolveEnabledSkills", () => {
  it("falls back to template defaults when no enablement rows exist", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { agentSkillEnablement: { findMany } };
    const skills = await resolveEnabledSkills(prisma as never, "ai_x", [
      "extractSoul",
      "searchKnowledge",
    ]);
    expect(findMany).toHaveBeenCalledWith({
      select: { skillId: true },
      where: { agentInstanceId: "ai_x" },
    });
    expect(skills.map((s) => s.id)).toEqual(["extractSoul", "searchKnowledge"]);
  });

  it("returns the enablement-listed skills when rows exist (ignoring template defaults)", async () => {
    const findMany = vi.fn().mockResolvedValue([{ skillId: "extractSoul" }]);
    const prisma = { agentSkillEnablement: { findMany } };
    const skills = await resolveEnabledSkills(prisma as never, "ai_y", [
      "extractSoul",
      "searchKnowledge",
      "generateBrandImage",
    ]);
    expect(skills.map((s) => s.id)).toEqual(["extractSoul"]);
  });

  it("silently drops enabled ids that aren't in the in-code skill registry", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ skillId: "extractSoul" }, { skillId: "ghost-skill" }]);
    const prisma = { agentSkillEnablement: { findMany } };
    const skills = await resolveEnabledSkills(prisma as never, "ai_z", []);
    expect(skills.map((s) => s.id)).toEqual(["extractSoul"]);
  });
});
