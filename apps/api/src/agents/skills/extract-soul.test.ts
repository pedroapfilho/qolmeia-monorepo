import { describe, expect, it, vi } from "vitest";

import { extractSoulSkill } from "./extract-soul";

vi.mock("../../knowledge/apply", () => ({
  applySoulUpdate: vi.fn(),
}));

describe("extractSoulSkill", () => {
  it("has the expected metadata for the registry", () => {
    expect(extractSoulSkill.id).toBe("extractSoul");
    expect(extractSoulSkill.displayName).toBe("Extract Soul");
    expect(extractSoulSkill.requiresApprovalDefault).toBe(false);
    expect(extractSoulSkill.requiredConnectorTypes).toEqual([]);
  });

  it("parses input via inputSchema (Zod) — accepts the 5 nullable soul fields", () => {
    const parsed = extractSoulSkill.inputSchema.parse({
      brandVoice: null,
      differentiator: null,
      location: null,
      targetAudience: "donos de salão de barbearia",
      whatYouDo: "salão de cabelo e barba",
    });
    expect(parsed.whatYouDo).toBe("salão de cabelo e barba");
    expect(parsed.brandVoice).toBeNull();
  });

  it("execute() forwards to applySoulUpdate(orgId, partial, prisma) and returns capturedFields", async () => {
    const { applySoulUpdate } = await import("../../knowledge/apply");
    vi.mocked(applySoulUpdate).mockResolvedValueOnce({
      capturedFields: ["whatYouDo"],
      newProfile: { whatYouDo: "salão" },
    });
    const fakePrisma = { id: "fake-prisma" } as never;

    const result = await extractSoulSkill.execute(
      {
        brandVoice: null,
        differentiator: null,
        location: null,
        targetAudience: null,
        whatYouDo: "salão",
      },
      { orgId: "org_1", prisma: fakePrisma },
    );

    expect(applySoulUpdate).toHaveBeenCalledOnce();
    expect(applySoulUpdate).toHaveBeenCalledWith(
      "org_1",
      {
        brandVoice: null,
        differentiator: null,
        location: null,
        targetAudience: null,
        whatYouDo: "salão",
      },
      fakePrisma,
    );
    expect(result).toEqual({ capturedFields: ["whatYouDo"] });
  });
});
