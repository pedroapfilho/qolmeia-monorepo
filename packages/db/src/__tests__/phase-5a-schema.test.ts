import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../client";

// These tests hit the live local Postgres (docker-compose, host port 5436).
// They assume `pnpm db:push` has been run. Each test creates its own scoped
// fixtures with unique-by-test prefixes so the suite can run repeatedly
// without an explicit truncate.

const PREFIX = `p5a-${Date.now()}`;
const tag = (key: string): string => `${PREFIX}-${key}`;

describe("Phase 5a schema", () => {
  beforeAll(() => {
    // Sanity: the new models exist on the typed Prisma client.
    expect(prisma.agentTemplate).toBeDefined();
    expect(prisma.skill).toBeDefined();
    expect(prisma.connectorInstance).toBeDefined();
    expect(prisma.agentInstance).toBeDefined();
    expect(prisma.agentConnectorBinding).toBeDefined();
    expect(prisma.agentAction).toBeDefined();
  });

  afterAll(async () => {
    // Best-effort cleanup of anything we inserted under our prefix.
    await prisma.agentSkillEnablement.deleteMany({
      where: { agentInstance: { org: { slug: { startsWith: PREFIX } } } },
    });
    await prisma.agentAction.deleteMany({
      where: { agentInstance: { org: { slug: { startsWith: PREFIX } } } },
    });
    await prisma.agentConnectorBinding.deleteMany({
      where: { agentInstance: { org: { slug: { startsWith: PREFIX } } } },
    });
    await prisma.agentInstance.deleteMany({ where: { org: { slug: { startsWith: PREFIX } } } });
    await prisma.connectorInstance.deleteMany({ where: { org: { slug: { startsWith: PREFIX } } } });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: PREFIX } } });
    await prisma.skill.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await prisma.agentTemplate.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  });

  it("creates a Skill row", async () => {
    const skill = await prisma.skill.create({
      data: {
        description: "A skill used in Phase 5a CRUD tests.",
        displayName: "Test Skill",
        id: tag("skill-1"),
        parametersJsonSchema: { properties: {}, type: "object" },
        requiredConnectorTypes: [],
        requiresApprovalDefault: false,
      },
    });
    expect(skill.id).toBe(tag("skill-1"));
    expect(skill.requiredConnectorTypes).toEqual([]);
  });

  it("creates an AgentTemplate row with the many-to-many skill relation", async () => {
    const skill = await prisma.skill.create({
      data: {
        description: "for template binding",
        displayName: "Tag-2 Skill",
        id: tag("skill-2"),
        parametersJsonSchema: { properties: {}, type: "object" },
        requiredConnectorTypes: ["TELEGRAM"],
      },
    });
    const template = await prisma.agentTemplate.create({
      data: {
        canDelegateTo: [],
        compatibleInboundConnectorTypes: ["TELEGRAM"],
        compatibleOutboundConnectorTypes: ["TELEGRAM", "WHATSAPP"],
        defaultMission: "mission",
        defaultSystemPrompt: "system",
        description: "Phase 5a CRUD",
        displayName: "Template 1",
        skills: { connect: [{ id: skill.id }] },
        slug: tag("tpl-1"),
      },
      include: { skills: true },
    });
    expect(template.slug).toBe(tag("tpl-1"));
    expect(template.skills).toHaveLength(1);
    expect(template.skills[0]!.id).toBe(skill.id);
    expect(template.compatibleOutboundConnectorTypes).toEqual(["TELEGRAM", "WHATSAPP"]);
  });

  it("creates an Organization + ConnectorInstance + AgentInstance + Binding + Action chain", async () => {
    const template = await prisma.agentTemplate.create({
      data: {
        canDelegateTo: [],
        compatibleInboundConnectorTypes: ["TELEGRAM"],
        compatibleOutboundConnectorTypes: ["TELEGRAM"],
        defaultMission: "m",
        defaultSystemPrompt: "p",
        description: "d",
        displayName: "T2",
        slug: tag("tpl-2"),
      },
    });
    const skill = await prisma.skill.create({
      data: {
        description: "d",
        displayName: "S3",
        id: tag("skill-3"),
        parametersJsonSchema: {},
        requiredConnectorTypes: [],
      },
    });
    const org = await prisma.organization.create({
      data: { name: "Phase 5a org", slug: tag("org") },
    });
    const connector = await prisma.connectorInstance.create({
      data: {
        capabilities: { inbound: true, outbound: true },
        config: { chatId: "test-chat" },
        displayName: "Phase 5a chat",
        orgId: org.id,
        senderRole: "OWNER",
        type: "TELEGRAM",
      },
    });
    const agent = await prisma.agentInstance.create({
      data: {
        budgetCents: 5000,
        displayName: "Phase 5a agent",
        mission: "test",
        orgId: org.id,
        templateSlug: template.slug,
      },
    });
    const binding = await prisma.agentConnectorBinding.create({
      data: {
        agentInstanceId: agent.id,
        connectorInstanceId: connector.id,
        direction: "BOTH",
      },
    });
    const action = await prisma.agentAction.create({
      data: {
        agentInstanceId: agent.id,
        proposedInput: { foo: "bar" },
        proposedSummary: "test summary",
        skillId: skill.id,
      },
    });
    const child = await prisma.agentAction.create({
      data: {
        agentInstanceId: agent.id,
        parentActionId: action.id,
        proposedInput: {},
        proposedSummary: "child",
        skillId: skill.id,
      },
    });

    expect(connector.senderRole).toBe("OWNER");
    expect(agent.status).toBe("ACTIVE");
    expect(binding.direction).toBe("BOTH");
    expect(action.status).toBe("DRAFTED");
    expect(action.costCurrency).toBe("BRL");
    expect(child.parentActionId).toBe(action.id);

    // (orgId, templateSlug) unique
    await expect(
      prisma.agentInstance.create({
        data: {
          displayName: "dup",
          mission: "",
          orgId: org.id,
          templateSlug: template.slug,
        },
      }),
    ).rejects.toThrow();

    // Cascade delete: removing the org wipes downstream rows.
    await prisma.agentAction.deleteMany({ where: { agentInstanceId: agent.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    const remainingAgent = await prisma.agentInstance.findUnique({ where: { id: agent.id } });
    const remainingConnector = await prisma.connectorInstance.findUnique({
      where: { id: connector.id },
    });
    expect(remainingAgent).toBeNull();
    expect(remainingConnector).toBeNull();
  });

  it("round-trips Organization.agentInstructions + businessIdea as nullable strings", async () => {
    // Defaults are null on create.
    const blank = await prisma.organization.create({
      data: { name: "blank owner-curated", slug: tag("org-curated-blank") },
      select: { agentInstructions: true, businessIdea: true },
    });
    expect(blank.agentInstructions).toBeNull();
    expect(blank.businessIdea).toBeNull();

    // Populated values round-trip.
    const populated = await prisma.organization.create({
      data: {
        agentInstructions: "Sempre responda em pt-BR. Nunca use emojis.",
        businessIdea: "Salão de beleza premium em SP focado em coloração.",
        name: "populated owner-curated",
        slug: tag("org-curated-populated"),
      },
      select: { agentInstructions: true, businessIdea: true },
    });
    expect(populated.agentInstructions).toBe("Sempre responda em pt-BR. Nunca use emojis.");
    expect(populated.businessIdea).toBe("Salão de beleza premium em SP focado em coloração.");

    // Clearing back to null is supported.
    const cleared = await prisma.organization.update({
      data: { agentInstructions: null, businessIdea: null },
      select: { agentInstructions: true, businessIdea: true },
      where: { slug: tag("org-curated-populated") },
    });
    expect(cleared.agentInstructions).toBeNull();
    expect(cleared.businessIdea).toBeNull();
  });

  it("round-trips AgentSkillEnablement rows and enforces (agentInstanceId, skillId) uniqueness", async () => {
    const skillA = await prisma.skill.create({
      data: {
        description: "d",
        displayName: "EnA",
        id: tag("skill-en-a"),
        parametersJsonSchema: {},
        requiredConnectorTypes: [],
      },
    });
    const skillB = await prisma.skill.create({
      data: {
        description: "d",
        displayName: "EnB",
        id: tag("skill-en-b"),
        parametersJsonSchema: {},
        requiredConnectorTypes: [],
      },
    });
    const template = await prisma.agentTemplate.create({
      data: {
        canDelegateTo: [],
        compatibleInboundConnectorTypes: [],
        compatibleOutboundConnectorTypes: [],
        defaultMission: "m",
        defaultSystemPrompt: "p",
        description: "d",
        displayName: "T-Enablement",
        slug: tag("tpl-enablement"),
      },
    });
    const org = await prisma.organization.create({
      data: { name: "n", slug: tag("org-enablement") },
    });
    const agent = await prisma.agentInstance.create({
      data: {
        displayName: "agent-en",
        mission: "",
        orgId: org.id,
        templateSlug: template.slug,
      },
    });

    const rowA = await prisma.agentSkillEnablement.create({
      data: {
        agentInstanceId: agent.id,
        configOverride: { topK: 5 },
        enabledBy: "user_test",
        skillId: skillA.id,
      },
    });
    const rowB = await prisma.agentSkillEnablement.create({
      data: { agentInstanceId: agent.id, skillId: skillB.id },
    });

    expect(rowA.configOverride).toEqual({ topK: 5 });
    expect(rowA.enabledBy).toBe("user_test");
    expect(rowB.configOverride).toBeNull();
    expect(rowB.enabledBy).toBeNull();
    expect(rowA.enabledAt).toBeInstanceOf(Date);

    // (agentInstanceId, skillId) unique.
    await expect(
      prisma.agentSkillEnablement.create({
        data: { agentInstanceId: agent.id, skillId: skillA.id },
      }),
    ).rejects.toThrow();

    // Eager-load via the AgentInstance relation.
    const reloaded = await prisma.agentInstance.findUnique({
      include: { enablements: { orderBy: { skillId: "asc" }, select: { skillId: true } } },
      where: { id: agent.id },
    });
    expect(reloaded?.enablements.map((e) => e.skillId).toSorted()).toEqual(
      [skillA.id, skillB.id].toSorted(),
    );

    // Cascade delete: removing the AgentInstance wipes its enablement rows.
    await prisma.agentInstance.delete({ where: { id: agent.id } });
    const remaining = await prisma.agentSkillEnablement.findMany({
      where: { agentInstanceId: agent.id },
    });
    expect(remaining).toEqual([]);
  });

  it("uses zero AgentSkillEnablement rows to mean 'use template defaults'", async () => {
    const template = await prisma.agentTemplate.create({
      data: {
        canDelegateTo: [],
        compatibleInboundConnectorTypes: [],
        compatibleOutboundConnectorTypes: [],
        defaultMission: "m",
        defaultSystemPrompt: "p",
        description: "d",
        displayName: "T3",
        slug: tag("tpl-3"),
      },
    });
    const org = await prisma.organization.create({
      data: { name: "n", slug: tag("org-defaults") },
    });
    const usingDefaults = await prisma.agentInstance.create({
      data: { displayName: "a", mission: "", orgId: org.id, templateSlug: template.slug },
    });
    const enablements = await prisma.agentSkillEnablement.findMany({
      where: { agentInstanceId: usingDefaults.id },
    });
    expect(enablements).toEqual([]);
  });
});
