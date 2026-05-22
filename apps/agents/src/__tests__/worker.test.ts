import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("worker routing", () => {
  it("healthz returns 200", async () => {
    const response = await SELF.fetch("https://agents.test/healthz");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("rejects an unauthenticated agent connection with 401", async () => {
    const response = await SELF.fetch(
      "https://agents.test/agents/correspondent/p1-demo-company",
    );
    expect(response.status).toBe(401);
  });

  it("returns 404 for an unknown route", async () => {
    const response = await SELF.fetch("https://agents.test/nope");
    expect(response.status).toBe(404);
  });
});
