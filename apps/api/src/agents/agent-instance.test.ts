import { describe, expect, it, vi } from "vitest";

import { ensureAgentInstance, findInboundAgentInstanceForConnector } from "./agent-instance";

vi.mock("./templates/registry", () => ({
  findTemplateBySlug: vi.fn(),
}));

describe("ensureAgentInstance", () => {
  it("throws when the template is not in the registry", async () => {
    const { findTemplateBySlug } = await import("./templates/registry");
    vi.mocked(findTemplateBySlug).mockReturnValueOnce(undefined);

    const prisma = { agentInstance: { upsert: vi.fn() } } as never;

    expect(() =>
      ensureAgentInstance({ orgId: "org_1", prisma, templateSlug: "ghost-template" }),
    ).toThrow(/ghost-template/v);
  });

  it("upserts using the template's displayName", async () => {
    const { findTemplateBySlug } = await import("./templates/registry");
    vi.mocked(findTemplateBySlug).mockReturnValueOnce({
      displayName: "Marketing Strategist",
      slug: "marketing-strategist",
    } as never);

    const created = { id: "ai_ms", orgId: "org_1", templateSlug: "marketing-strategist" };
    const upsert = vi.fn().mockResolvedValue(created);
    const prisma = { agentInstance: { upsert } } as never;

    const result = await ensureAgentInstance({
      orgId: "org_1",
      prisma,
      templateSlug: "marketing-strategist",
    });

    expect(result).toBe(created);
    expect(upsert).toHaveBeenCalledWith({
      create: {
        displayName: "Marketing Strategist",
        mission: "",
        orgId: "org_1",
        templateSlug: "marketing-strategist",
      },
      update: {},
      where: {
        orgId_templateSlug: { orgId: "org_1", templateSlug: "marketing-strategist" },
      },
    });
  });
});

const makeAgent = (over: Partial<{ id: string; templateSlug: string }> = {}) => ({
  budgetCents: 0,
  createdAt: new Date(),
  displayName: "Controller",
  enabledSkillIds: null,
  id: over.id ?? "ai_controller",
  mission: "",
  orgId: "org_1",
  status: "ACTIVE",
  templateSlug: over.templateSlug ?? "controller",
  updatedAt: new Date(),
});

describe("findInboundAgentInstanceForConnector", () => {
  it("returns the bound AgentInstance when exactly one INBOUND/BOTH binding exists", async () => {
    const agentInstance = makeAgent();
    const findMany = vi.fn().mockResolvedValue([
      {
        agentInstance,
        agentInstanceId: agentInstance.id,
        connectorInstanceId: "ci_1",
        direction: "INBOUND",
        id: "binding_1",
      },
    ]);
    const prisma = { agentConnectorBinding: { findMany } } as never;

    const result = await findInboundAgentInstanceForConnector({
      connectorInstanceId: "ci_1",
      prisma,
    });

    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.agentInstance).toBe(agentInstance);
    }
    expect(findMany).toHaveBeenCalledWith({
      include: { agentInstance: true },
      where: {
        connectorInstanceId: "ci_1",
        direction: { in: ["INBOUND", "BOTH"] },
      },
    });
  });

  it("returns kind=none when no inbound binding exists", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { agentConnectorBinding: { findMany } } as never;

    const result = await findInboundAgentInstanceForConnector({
      connectorInstanceId: "ci_2",
      prisma,
    });

    expect(result.kind).toBe("none");
  });

  it("returns kind=ambiguous when multiple inbound bindings exist (v0 cannot route)", async () => {
    const agentA = makeAgent({ id: "ai_a", templateSlug: "controller" });
    const agentB = makeAgent({ id: "ai_b", templateSlug: "designer" });
    const findMany = vi.fn().mockResolvedValue([
      {
        agentInstance: agentA,
        agentInstanceId: agentA.id,
        connectorInstanceId: "ci_3",
        direction: "INBOUND",
        id: "binding_a",
      },
      {
        agentInstance: agentB,
        agentInstanceId: agentB.id,
        connectorInstanceId: "ci_3",
        direction: "BOTH",
        id: "binding_b",
      },
    ]);
    const prisma = { agentConnectorBinding: { findMany } } as never;

    const result = await findInboundAgentInstanceForConnector({
      connectorInstanceId: "ci_3",
      prisma,
    });

    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidateTemplateSlugs).toEqual(["controller", "designer"]);
    }
  });
});
