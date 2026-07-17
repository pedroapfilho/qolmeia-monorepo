import { describe, expect, it } from "vitest";

import { parsePositiveInt, parseTimestamp } from "#/lib/pagination";

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

describe("parseTimestamp", () => {
  it("returns undefined when the raw value is undefined or empty", () => {
    expect(parseTimestamp(undefined)).toBeUndefined();
    expect(parseTimestamp("")).toBeUndefined();
  });

  it("parses a valid epoch-millisecond timestamp", () => {
    expect(parseTimestamp("1752600000000")).toBe(1_752_600_000_000);
    expect(parseTimestamp("0")).toBe(0);
  });

  it("truncates fractional input toward zero", () => {
    expect(parseTimestamp("1000.9")).toBe(1000);
  });

  it("returns undefined for negative or non-finite input", () => {
    expect(parseTimestamp("-1")).toBeUndefined();
    expect(parseTimestamp("abc")).toBeUndefined();
    expect(parseTimestamp("Infinity")).toBeUndefined();
    expect(parseTimestamp("NaN")).toBeUndefined();
  });
});
