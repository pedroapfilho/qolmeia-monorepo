import { describe, expect, it } from "vitest";

import { runAgent } from "./extract";

describe("soul/extract re-exports", () => {
  it("re-exports runAgent from lib/ai", () => {
    expect(typeof runAgent).toBe("function");
  });
});
