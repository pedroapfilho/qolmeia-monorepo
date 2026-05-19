import { describe, expect, it } from "vitest";

import { SOUL_FIELDS } from "./soul";
import { SOUL_LABELS_PT } from "./labels";

describe("SOUL_LABELS_PT", () => {
  it("has a non-empty pt-BR label for every SoulProfile field", () => {
    for (const field of SOUL_FIELDS) {
      expect(SOUL_LABELS_PT[field]).toBeTypeOf("string");
      expect(SOUL_LABELS_PT[field].length).toBeGreaterThan(0);
    }
  });
});
