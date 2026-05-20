import { describe, expect, it } from "vitest";

import { renderAssetsBlock, renderExistingBlock, renderSystemPrompt } from "./renderer";

describe("renderAssetsBlock", () => {
  it("returns (nenhum) for empty input", () => {
    expect(renderAssetsBlock([])).toBe("(nenhum)");
  });

  it("formats new assets and flags deduped ones", () => {
    const out = renderAssetsBlock([
      { assetId: "a1", deduped: false, mimeType: "image/png" },
      { assetId: "a2", deduped: true, mimeType: "image/jpeg" },
    ]);
    expect(out).toContain("assetId: a1");
    expect(out).toContain("image/png");
    expect(out).toContain("(já estava no perfil — NÃO labelar)");
  });
});

describe("renderExistingBlock", () => {
  it("returns (nenhum) for empty input", () => {
    expect(renderExistingBlock([])).toBe("(nenhum)");
  });

  it("formats existing assets with stringified metadata", () => {
    const out = renderExistingBlock([
      { assetId: "x1", metadata: { palette: ["#fff"] }, mimeType: "image/png" },
    ]);
    expect(out).toContain("assetId: x1");
    expect(out).toContain(`metadata: {"palette":["#fff"]}`);
  });
});

describe("renderSystemPrompt", () => {
  it("substitutes all 4 placeholders", () => {
    const template =
      "ctx={{currentContext}} ex={{existingAssetsBlock}} new={{newAssetsBlock}} over={{oversizeCount}}";
    const out = renderSystemPrompt(template, {
      currentContext: "PROFILE",
      existingAssets: [],
      newAssets: [],
      oversizeCount: 2,
    });
    expect(out).toBe("ctx=PROFILE ex=(nenhum) new=(nenhum) over=2");
  });

  it("substitutes (perfil vazio) when currentContext is empty", () => {
    const out = renderSystemPrompt("{{currentContext}}", {
      currentContext: "",
      existingAssets: [],
      newAssets: [],
      oversizeCount: 0,
    });
    expect(out).toBe("(perfil vazio)");
  });
});
