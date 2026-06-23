import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "#/agents/correspondent-context";
import { briefCompleteness, type CompanyBrief } from "#/lib/company-brief";

const ctx = (brief: Partial<CompanyBrief>) => ({
  brandAssetCount: 0,
  brief,
  completeness: briefCompleteness(brief),
});

describe("buildSystemPrompt — brief context", () => {
  it("omits the brief block when no context is passed", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).not.toContain("## Brief da empresa");
  });

  it("instructs the agent to ask one missing-field question when incomplete", () => {
    const prompt = buildSystemPrompt([], ctx({ industry: "alimentação" }));
    expect(prompt).toContain("## Brief da empresa");
    expect(prompt).toContain("UMA pergunta");
    expect(prompt).toContain("extractBrief");
    // Lists known fields and at least one missing label.
    expect(prompt).toContain("Setor: alimentação");
    expect(prompt).toContain("Público-alvo");
  });

  it("notes uploaded brand references when present", () => {
    const prompt = buildSystemPrompt([], {
      brandAssetCount: 3,
      brief: { industry: "alimentação" },
      completeness: briefCompleteness({ industry: "alimentação" }),
    });
    expect(prompt).toContain("3 referência(s) de marca");
    expect(prompt).toContain("Designer as usa");
  });

  it("tells the agent to stop asking once the brief is complete", () => {
    const prompt = buildSystemPrompt(
      [],
      ctx({
        audience: "donos de cafeteria",
        brand: { palette: "marrom", references: "Starbucks", voice: "acolhedora" },
        channels: ["instagram"],
        industry: "alimentação",
        primaryGoal: "vender mais",
      }),
    );
    expect(prompt).toContain("O brief está completo");
    expect(prompt).not.toContain("UMA pergunta");
  });
});
