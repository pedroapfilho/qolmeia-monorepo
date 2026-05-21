import { describe, expect, it, vi } from "vitest";

import { ensureInboundBindingForTelegramConnector } from "./connector-binding-seed";

vi.mock("./templates/registry", () => ({
  findTemplateBySlug: vi.fn().mockReturnValue({
    displayName: "Controller",
    slug: "controller",
  }),
}));

describe("ensureInboundBindingForTelegramConnector", () => {
  it("creates the Controller AgentInstance and an INBOUND binding when neither exists", async () => {
    const upsertAgent = vi.fn().mockResolvedValue({ id: "ai_controller", orgId: "org_1" });
    const upsertBinding = vi.fn().mockResolvedValue({ id: "binding_1" });
    const prisma = {
      agentConnectorBinding: { upsert: upsertBinding },
      agentInstance: { upsert: upsertAgent },
    } as never;

    await ensureInboundBindingForTelegramConnector({
      connectorInstanceId: "ci_1",
      orgId: "org_1",
      prisma,
    });

    expect(upsertAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId_templateSlug: { orgId: "org_1", templateSlug: "controller" } },
      }),
    );
    expect(upsertBinding).toHaveBeenCalledWith({
      create: {
        agentInstanceId: "ai_controller",
        connectorInstanceId: "ci_1",
        direction: "INBOUND",
      },
      update: {},
      where: {
        agentInstanceId_connectorInstanceId_direction: {
          agentInstanceId: "ai_controller",
          connectorInstanceId: "ci_1",
          direction: "INBOUND",
        },
      },
    });
  });

  it("is idempotent — re-running with same args does not fail (upsert semantics)", async () => {
    const upsertAgent = vi.fn().mockResolvedValue({ id: "ai_controller", orgId: "org_1" });
    const upsertBinding = vi.fn().mockResolvedValue({ id: "binding_1" });
    const prisma = {
      agentConnectorBinding: { upsert: upsertBinding },
      agentInstance: { upsert: upsertAgent },
    } as never;

    await ensureInboundBindingForTelegramConnector({
      connectorInstanceId: "ci_1",
      orgId: "org_1",
      prisma,
    });
    await ensureInboundBindingForTelegramConnector({
      connectorInstanceId: "ci_1",
      orgId: "org_1",
      prisma,
    });

    expect(upsertAgent).toHaveBeenCalledTimes(2);
    expect(upsertBinding).toHaveBeenCalledTimes(2);
  });
});
