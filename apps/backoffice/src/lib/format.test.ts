import { describe, expect, it } from "vitest";

import { formatBRL, formatRelative, truncate } from "./format";

describe("formatBRL", () => {
  it("formats cents as a BRL currency string", () => {
    // R$ 12,34 — the non-breaking space between symbol and number is what
    // pt-BR uses; we assert with includes() so the exact whitespace flavour
    // doesn't matter across ICU versions.
    const out = formatBRL(1234);
    expect(out).toContain("R$");
    expect(out).toContain("12,34");
  });

  it("formats zero", () => {
    const out = formatBRL(0);
    expect(out).toContain("0,00");
  });
});

describe("formatRelative", () => {
  it("returns 'agora' for a timestamp under a minute old", () => {
    const now = new Date("2026-05-21T12:00:00.000Z");
    const past = new Date(now.getTime() - 10_000).toISOString();
    expect(formatRelative(past, now)).toBe("agora");
  });

  it("returns a minutes-based string for recent timestamps", () => {
    const now = new Date("2026-05-21T12:00:00.000Z");
    const past = new Date(now.getTime() - 5 * 60_000).toISOString();
    // Intl normalises the output; we just confirm the unit is minutes.
    expect(formatRelative(past, now)).toMatch(/min/v);
  });
});

describe("truncate", () => {
  it("returns short strings unchanged", () => {
    expect(truncate("hello", 100)).toBe("hello");
  });

  it("truncates and appends an ellipsis past the limit", () => {
    const out = truncate("a".repeat(200), 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith("…")).toBe(true);
  });
});
