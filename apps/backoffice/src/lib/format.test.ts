import { describe, expect, it } from "vitest";

import { formatDurationSeconds, formatRelative, truncate } from "./format";

describe("formatRelative", () => {
  it("returns 'agora' for a timestamp under a minute old", () => {
    const now = new Date("2026-05-21T12:00:00.000Z");
    const past = now.getTime() - 10_000;
    expect(formatRelative(past, now)).toBe("agora");
  });

  it("returns a minutes-based string for recent timestamps", () => {
    const now = new Date("2026-05-21T12:00:00.000Z");
    const past = now.getTime() - 5 * 60_000;
    expect(formatRelative(past, now)).toMatch(/min/v);
  });
});

describe("formatDurationSeconds", () => {
  it("formats sub-minute durations in seconds", () => {
    expect(formatDurationSeconds(30)).toBe("30s");
  });
  it("formats sub-hour durations in minutes", () => {
    expect(formatDurationSeconds(120)).toBe("2min");
  });
  it("formats multi-hour durations as Hh[Mmin]", () => {
    expect(formatDurationSeconds(3600)).toBe("1h");
    expect(formatDurationSeconds(3 * 3600 + 5 * 60)).toBe("3h5min");
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
