import { describe, expect, it } from "vitest";

import { buildReply } from "./reply";
import type { SoulProfile } from "./soul";

const empty: SoulProfile = {};

const populated: SoulProfile = {
  competitors: "Salão Y",
  contextLinks: ["https://example.com"],
  targetAudience: "moradores do bairro",
  whatYouDeliver: "corte e barba",
  whatYouDo: "salão de cabelo",
};

describe("buildReply", () => {
  it("joins captured + missing when both non-empty", () => {
    const reply = buildReply(
      { whatYouDo: "salão" },
      ["whatYouDo"],
    );
    expect(reply).toBe(
      "Anotei: o que vocês fazem. Ainda preciso saber: seu público-alvo, o que vocês entregam, seus concorrentes e links sobre o negócio.",
    );
  });

  it("uses comma + ' e ' for three-item captured lists", () => {
    const reply = buildReply(
      { competitors: "X", targetAudience: "donas de casa", whatYouDo: "salão" },
      ["whatYouDo", "targetAudience", "competitors"],
    );
    expect(reply).toContain("Anotei: o que vocês fazem, seu público-alvo e seus concorrentes.");
  });

  it("celebrates completeness when nothing is missing", () => {
    const reply = buildReply(populated, ["competitors"]);
    expect(reply).toBe("Tudo capturado! Você pode me corrigir a qualquer momento.");
  });

  it("nudges with the first missing field when nothing was captured", () => {
    const reply = buildReply(empty, []);
    expect(reply).toBe(
      "Não consegui captar nada útil dessa mensagem. Pode tentar descrever o que vocês fazem?",
    );
  });

  it("returns the all-set-no-change fallback when complete and nothing new", () => {
    const reply = buildReply(populated, []);
    expect(reply).toBe("Tudo certo, nada novo por aqui.");
  });
});
