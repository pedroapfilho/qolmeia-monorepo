import { describe, expect, it, vi } from "vitest";

import { ALL_TEMPLATES, findTemplateBySlug, syncTemplates } from "./registry";

describe("templates registry", () => {
  it("exports the Controller and Designer templates", () => {
    const slugs = ALL_TEMPLATES.map((t) => t.slug).toSorted();
    expect(slugs).toEqual(["controller", "designer"]);
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
    ]);
  });

  it("Controller template can delegate to designer and has delegateToSpecialist skill", () => {
    const controller = findTemplateBySlug("controller");
    expect(controller).toBeDefined();
    if (!controller) {
      return;
    }
    expect(controller.canDelegateTo).toEqual(["designer"]);
    expect(controller.defaultEnabledSkillIds).toEqual(["delegateToSpecialist"]);
    expect(controller.defaultSystemPrompt).toContain("{{currentContext}}");
    expect(controller.defaultSystemPrompt).toContain("delegateToSpecialist");
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
    ]);
    expect(arg.update.skills.set.map((c) => c.id).toSorted()).toEqual([
      "extractSoul",
      "generateBrandImage",
      "labelBrandAsset",
    ]);
  });
});
