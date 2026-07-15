import { describe, expect, it } from "vitest";

import { parsePositiveInt } from "#/lib/pagination";

describe("parsePositiveInt", () => {
  it("returns the fallback when the raw value is undefined or empty", () => {
    expect(parsePositiveInt(undefined, 50, 200)).toBe(50);
    expect(parsePositiveInt("", 50, 200)).toBe(50);
  });

  it("parses a valid positive integer within range", () => {
    expect(parsePositiveInt("25", 50, 200)).toBe(25);
  });

  it("clamps to max when the value exceeds it", () => {
    expect(parsePositiveInt("500", 50, 200)).toBe(200);
  });

  it("truncates fractional input toward zero", () => {
    expect(parsePositiveInt("12.9", 50, 200)).toBe(12);
  });

  it("returns the fallback for non-positive or non-finite input", () => {
    expect(parsePositiveInt("0", 50, 200)).toBe(50);
    expect(parsePositiveInt("-3", 50, 200)).toBe(50);
    expect(parsePositiveInt("abc", 50, 200)).toBe(50);
    expect(parsePositiveInt("Infinity", 50, 200)).toBe(50);
  });
});
