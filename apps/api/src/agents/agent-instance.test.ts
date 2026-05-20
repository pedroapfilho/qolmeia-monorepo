import { describe, expect, it, vi } from "vitest";

import { ensureAgentInstance } from "./agent-instance";

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
