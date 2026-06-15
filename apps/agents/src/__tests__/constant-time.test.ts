import { describe, expect, it } from "vitest";

import { constantTimeEqual } from "@/lib/constant-time";

describe("constantTimeEqual", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEqual("super-secret-token", "super-secret-token")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(constantTimeEqual("super-secret-token", "super-secret-toben")).toBe(false);
  });

  it("returns false for different lengths (no length-based early return to true)", () => {
    expect(constantTimeEqual("short", "short-and-then-some")).toBe(false);
    expect(constantTimeEqual("", "x")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(constantTimeEqual("", "")).toBe(true);
  });

  it("handles multi-byte UTF-8 content", () => {
    expect(constantTimeEqual("piñata-segredo", "piñata-segredo")).toBe(true);
    expect(constantTimeEqual("piñata-segredo", "pinata-segredo")).toBe(false);
  });
});
