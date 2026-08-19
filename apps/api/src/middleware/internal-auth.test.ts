import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { requireInternalAuth } from "./internal-auth";

const buildApp = (): Hono => {
  const app = new Hono();
  app.use("*", requireInternalAuth);
  app.post("/operation", (c) => c.json({ ok: true }));
  return app;
};

describe("requireInternalAuth", () => {
  it("rejects a missing bearer token", async () => {
    const response = await buildApp().request("/operation", { method: "POST" });
    expect(response.status).toBe(403);
  });

  it("rejects an invalid bearer token", async () => {
    const response = await buildApp().request("/operation", {
      headers: { Authorization: "Bearer invalid-secret" },
      method: "POST",
    });
    expect(response.status).toBe(403);
  });

  it("accepts the configured bearer token", async () => {
    const response = await buildApp().request("/operation", {
      headers: { Authorization: `Bearer ${process.env.INTERNAL_SHARED_SECRET}` },
      method: "POST",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
