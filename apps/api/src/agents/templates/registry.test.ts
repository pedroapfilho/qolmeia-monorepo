import { describe, expect, it, vi } from "vitest";

import {
  ALL_TEMPLATES,
  findTemplateBySlug,
  syncTemplates,
  validateCanDelegateTo,
} from "./registry";

describe("templates registry", () => {
  it("exports the Controller and Designer templates", () => {
    const slugs = ALL_TEMPLATES.map((t) => t.slug).toSorted();
    expect(slugs).toEqual(["controller", "designer", "marketing-strategist"]);
  });

  it("findTemplateBySlug returns matching template or undefined", () => {
    expect(findTemplateBySlug("designer")?.slug).toBe("designer");
    expect(findTemplateBySlug("nonexistent")).toBeUndefined();
  });

  it("Designer template carries the system-prompt placeholders the runtime expects", () => {
    const designer = findTemplateBySlug("designer");
    expect(designer).toBeDefined();
    if (!designer) {
      return;
    }
    expect(designer.defaultSystemPrompt).toContain("{{currentContext}}");
    expect(designer.defaultSystemPrompt).toContain("{{existingAssetsBlock}}");
    expect(designer.defaultSystemPrompt).toContain("{{newAssetsBlock}}");
    expect(designer.defaultSystemPrompt).toContain("{{oversizeCount}}");
    expect(designer.defaultEnabledSkillIds).toEqual([
      "extractSoul",
      "generateBrandImage",
      "labelBrandAsset",
      "readKnowledgeDoc",
      "searchKnowledge",
    ]);
  });

  it("Controller template can delegate to both specialists and carries the briefing-gatherer skills", () => {
    const controller = findTemplateBySlug("controller");
    expect(controller).toBeDefined();
    if (!controller) {
      return;
    }
    expect(controller.canDelegateTo).toEqual(["designer", "marketing-strategist"]);
    expect(controller.defaultEnabledSkillIds.toSorted()).toEqual([
      "delegateToSpecialist",
      "extractSoul",
      "readKnowledgeDoc",
      "searchKnowledge",
    ]);
    expect(controller.defaultSystemPrompt).toContain("{{currentContext}}");
    expect(controller.defaultSystemPrompt).toContain("delegateToSpecialist");
    expect(controller.defaultSystemPrompt).toContain("briefing");
  });

  it("Marketing Strategist template can delegate to designer and lists the 4 expected skills", () => {
    const ms = findTemplateBySlug("marketing-strategist");
    expect(ms).toBeDefined();
    if (!ms) {
      return;
    }
    expect(ms.canDelegateTo).toEqual(["designer"]);
    expect(ms.defaultEnabledSkillIds.toSorted()).toEqual([
      "delegateToSpecialist",
      "draftMarketingStrategy",
      "readKnowledgeDoc",
      "searchKnowledge",
    ]);
  });

  it("Controller can delegate to designer AND marketing-strategist", () => {
    const controller = findTemplateBySlug("controller");
    expect(controller?.canDelegateTo.toSorted()).toEqual(["designer", "marketing-strategist"]);
  });

  it("syncTemplates upserts each template with skill connections", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const fakePrisma = { agentTemplate: { upsert } } as never;

    await syncTemplates(fakePrisma);

    expect(upsert).toHaveBeenCalledTimes(ALL_TEMPLATES.length);
    const designerCall = upsert.mock.calls.find(
      (args: Array<unknown>) => (args[0] as { where: { slug: string } }).where.slug === "designer",
    );
    expect(designerCall).toBeDefined();
    const arg = (designerCall as Array<unknown>)[0] as {
      create: { skills: { connect: Array<{ id: string }> }; slug: string };
      update: { skills: { set: Array<{ id: string }> } };
    };
    expect(arg.create.skills.connect.map((c) => c.id).toSorted()).toEqual([
      "extractSoul",
      "generateBrandImage",
      "labelBrandAsset",
      "readKnowledgeDoc",
      "searchKnowledge",
    ]);
    expect(arg.update.skills.set.map((c) => c.id).toSorted()).toEqual([
      "extractSoul",
      "generateBrandImage",
      "labelBrandAsset",
      "readKnowledgeDoc",
      "searchKnowledge",
    ]);
  });
});

const mkTemplate = (slug: string, edges: Array<string>) => ({
  canDelegateTo: edges,
  compatibleInboundConnectorTypes: [],
  compatibleOutboundConnectorTypes: [],
  defaultBudgetCents: 0,
  defaultEnabledSkillIds: [],
  defaultMission: "",
  defaultSystemPrompt: "",
  description: "",
  displayName: "",
  slug,
});

describe("validateCanDelegateTo", () => {
  it("accepts the production registry", () => {
    expect(() => validateCanDelegateTo(ALL_TEMPLATES)).not.toThrow();
  });

  it("rejects a direct self-cycle", () => {
    const templates = [mkTemplate("a", ["a"])];
    expect(() => validateCanDelegateTo(templates)).toThrow(/cycle/iv);
  });

  it("rejects a 2-cycle", () => {
    expect(() => validateCanDelegateTo([mkTemplate("a", ["b"]), mkTemplate("b", ["a"])])).toThrow(
      /cycle/iv,
    );
  });

  it("rejects a delegate-to-unknown reference", () => {
    const templates = [mkTemplate("real", ["ghost"])];
    expect(() => validateCanDelegateTo(templates)).toThrow(/unknown template/iv);
  });

  it("accepts a longer acyclic DAG", () => {
    expect(() =>
      validateCanDelegateTo([
        mkTemplate("a", ["b", "c"]),
        mkTemplate("b", ["c"]),
        mkTemplate("c", []),
      ]),
    ).not.toThrow();
  });
});
