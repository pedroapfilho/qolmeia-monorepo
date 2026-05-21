import { describe, expect, it, vi } from "vitest";

import { getBusinessContext } from "./provider";

type OrgRow = {
  agentInstructions?: string | null;
  businessIdea?: string | null;
  businessProfile?: unknown;
};

const makePrisma = (row: OrgRow | null) =>
  ({
    organization: {
      findUnique: vi.fn().mockResolvedValue(
        row === null
          ? null
          : {
              agentInstructions: row.agentInstructions ?? null,
              businessIdea: row.businessIdea ?? null,
              businessProfile: row.businessProfile ?? null,
            },
      ),
    },
  }) as never;

describe("getBusinessContext", () => {
  it("returns empty string when org is not found", async () => {
    expect(await getBusinessContext("org_1", makePrisma(null))).toBe("");
  });

  it("returns empty string when org has no profile and no owner-curated fields", async () => {
    expect(await getBusinessContext("org_1", makePrisma({}))).toBe("");
    expect(
      await getBusinessContext(
        "org_1",
        makePrisma({
          agentInstructions: null,
          businessIdea: null,
          businessProfile: null,
        }),
      ),
    ).toBe("");
  });

  it("serializes a populated businessProfile to a markdown block", async () => {
    const result = await getBusinessContext(
      "org_1",
      makePrisma({ businessProfile: { audience: "Locals", whatYouDo: "Salon" } }),
    );
    expect(result).toContain("# Business Context");
    expect(result).toContain("whatYouDo");
    expect(result).toContain("Salon");
  });

  it("renders businessIdea section only when set", async () => {
    const result = await getBusinessContext(
      "org_1",
      makePrisma({ businessIdea: "Salão premium em SP" }),
    );
    expect(result).toContain("## Ideia do negócio (definida pelo dono)");
    expect(result).toContain("Salão premium em SP");
    expect(result).not.toContain("Instruções para a equipe de IA");
    expect(result).not.toContain("# Business Context");
  });

  it("renders agentInstructions section only when set", async () => {
    const result = await getBusinessContext(
      "org_1",
      makePrisma({ agentInstructions: "Sempre responda em pt-BR. Nunca use emojis." }),
    );
    expect(result).toContain("## Instruções para a equipe de IA (definidas pelo dono)");
    expect(result).toContain("Sempre responda em pt-BR. Nunca use emojis.");
    expect(result).not.toContain("Ideia do negócio");
    expect(result).not.toContain("# Business Context");
  });

  it("renders all three sections with owner-curated content first, businessProfile last", async () => {
    const result = await getBusinessContext(
      "org_1",
      makePrisma({
        agentInstructions: "Tom descontraído.",
        businessIdea: "Salão em SP.",
        businessProfile: { whatYouDo: "Cortes e coloração" },
      }),
    );

    const ideaIdx = result.indexOf("Ideia do negócio");
    const instructionsIdx = result.indexOf("Instruções para a equipe de IA");
    const profileIdx = result.indexOf("# Business Context");

    expect(ideaIdx).toBeGreaterThanOrEqual(0);
    expect(instructionsIdx).toBeGreaterThan(ideaIdx);
    expect(profileIdx).toBeGreaterThan(instructionsIdx);
    expect(result).toContain("Cortes e coloração");
  });

  it("treats empty-string owner-curated values as set (rendered as empty sections)", async () => {
    // Defensive: empty string is non-null, so it should still render its
    // section header. Owner UX clearing should send null, not empty string.
    const result = await getBusinessContext(
      "org_1",
      makePrisma({ agentInstructions: "", businessIdea: "" }),
    );
    expect(result).toContain("## Ideia do negócio (definida pelo dono)");
    expect(result).toContain("## Instruções para a equipe de IA (definidas pelo dono)");
  });
});
