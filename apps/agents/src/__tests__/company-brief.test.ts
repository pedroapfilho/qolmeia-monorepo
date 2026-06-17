import { describe, expect, it } from "vitest";

import {
  BRIEF_SCHEMA_VERSION,
  briefCompleteness,
  companyBriefSchema,
  isBriefEmpty,
  mergeBrief,
  parseBrief,
} from "@/lib/company-brief";

describe("companyBriefSchema", () => {
  it("validates a complete brief", () => {
    const ok = companyBriefSchema.safeParse({
      audience: "donos de cafeteria em SP",
      brand: { palette: "marrom + creme", voice: "acolhedora" },
      channels: ["instagram", "whatsapp"],
      industry: "alimentação",
      locale: "pt-BR",
      primaryGoal: "aumentar vendas no fim de semana",
      schemaVersion: 1,
    });
    expect(ok.success).toBe(true);
  });

  it("partial schema accepts an empty brief during the debrief", () => {
    const ok = companyBriefSchema.partial().safeParse({});
    expect(ok.success).toBe(true);
  });

  it("rejects an invalid channel", () => {
    const result = companyBriefSchema.safeParse({
      channels: ["not-a-real-channel"],
    });
    expect(result.success).toBe(false);
  });
});

describe("mergeBrief", () => {
  it("partial updates land on top of existing fields without overwriting with undefined", () => {
    const existing = { audience: "vegetariano", industry: "alimentação" };
    const updates = { industry: "alimentação saudável", primaryGoal: "delivery" };
    const merged = mergeBrief(existing, updates);
    expect(merged.audience).toBe("vegetariano");
    expect(merged.industry).toBe("alimentação saudável");
    expect(merged.primaryGoal).toBe("delivery");
  });

  it("fills in default locale and schemaVersion when neither side specifies", () => {
    const merged = mergeBrief({}, {});
    expect(merged.locale).toBe("pt-BR");
    expect(merged.schemaVersion).toBe(BRIEF_SCHEMA_VERSION);
  });
});

describe("parseBrief", () => {
  it("returns {} for null or empty input", () => {
    expect(parseBrief(null)).toEqual({});
    expect(parseBrief("")).toEqual({});
  });

  it("returns {} for malformed JSON", () => {
    expect(parseBrief("not json")).toEqual({});
  });

  it("parses a valid brief JSON", () => {
    const json = JSON.stringify({ industry: "SaaS", primaryGoal: "leads" });
    const parsed = parseBrief(json);
    expect(parsed.industry).toBe("SaaS");
    expect(parsed.primaryGoal).toBe("leads");
  });
});

describe("isBriefEmpty", () => {
  it("treats an empty brief as empty", () => {
    expect(isBriefEmpty(parseBrief(null))).toBe(true);
    expect(isBriefEmpty({})).toBe(true);
  });

  it("treats schema defaults (locale/schemaVersion only) as empty", () => {
    expect(isBriefEmpty({ locale: "pt-BR", schemaVersion: 1 })).toBe(true);
  });

  it("treats any meaningful field as non-empty", () => {
    expect(isBriefEmpty({ industry: "alimentação" })).toBe(false);
    expect(isBriefEmpty({ primaryGoal: "mais vendas" })).toBe(false);
    expect(isBriefEmpty({ audience: "donos de cafeteria" })).toBe(false);
    expect(isBriefEmpty({ channels: ["instagram"] })).toBe(false);
    expect(isBriefEmpty({ brand: { voice: "acolhedora" } })).toBe(false);
  });

  it("treats an empty channels array as empty", () => {
    expect(isBriefEmpty({ channels: [] })).toBe(true);
  });
});

describe("briefCompleteness", () => {
  it("reports 0% and all 7 fields missing for an empty brief", () => {
    const c = briefCompleteness({});
    expect(c.percent).toBe(0);
    expect(c.isComplete).toBe(false);
    expect(c.missing).toHaveLength(7);
    expect(c.filled).toHaveLength(0);
  });

  it("counts each filled required field, including nested brand fields", () => {
    const c = briefCompleteness({
      brand: { voice: "acolhedora" },
      channels: ["instagram"],
      industry: "alimentação",
    });
    // industry + channels + brand.voice = 3 of 7
    expect(c.filled).toEqual(expect.arrayContaining(["industry", "channels", "brand.voice"]));
    expect(c.filled).toHaveLength(3);
    expect(c.percent).toBe(43);
    expect(c.isComplete).toBe(false);
  });

  it("treats an empty channels array as missing", () => {
    expect(briefCompleteness({ channels: [] }).missing).toContain("channels");
  });

  it("is complete only when all 7 fields are present", () => {
    const c = briefCompleteness({
      audience: "donos de cafeteria",
      brand: { palette: "marrom", references: "Starbucks", voice: "acolhedora" },
      channels: ["instagram"],
      industry: "alimentação",
      primaryGoal: "vender mais",
    });
    expect(c.isComplete).toBe(true);
    expect(c.percent).toBe(100);
    expect(c.missing).toHaveLength(0);
  });
});
