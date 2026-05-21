import { describe, expect, it } from "vitest";

import { auth } from "./auth";

describe("apps/api auth singleton", () => {
  it("exposes a Fetch-style handler", () => {
    expect(typeof auth.handler).toBe("function");
  });

  it("has the magic-link plugin enabled", () => {
    const plugins = auth.options.plugins ?? [];
    const ids = plugins.map((plugin: { id: string }) => plugin.id);
    expect(ids).toContain("magic-link");
  });

  it("has the username plugin enabled", () => {
    const plugins = auth.options.plugins ?? [];
    const ids = plugins.map((plugin: { id: string }) => plugin.id);
    expect(ids).toContain("username");
  });
});
