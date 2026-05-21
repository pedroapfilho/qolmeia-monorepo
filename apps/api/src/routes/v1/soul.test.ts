import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthSession, StaffContextVars } from "@/middleware/require-staff";

import { buildSoulRoutes } from "./soul";

const session: AuthSession = {
  session: { id: "sess_1", userId: "user_1" },
  user: { email: "owner@example.com", id: "user_1", name: "Owner" },
};

const buildAppWithGuard = (vars: StaffContextVars, routes: ReturnType<typeof buildSoulRoutes>) => {
  const app = new Hono<{ Variables: StaffContextVars }>();
  app.use("*", async (c, next) => {
    c.set("session", vars.session);
    c.set("orgId", vars.orgId);
    c.set("role", vars.role);
    await next();
  });
  app.route("/", routes);
  return app;
};

describe("GET /soul", () => {
  it("returns the three soul fields", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      agentInstructions: "Use pt-BR",
      businessIdea: "Salon in SP",
      businessProfile: { tone: "warm" },
    });
    const prisma = {
      activityLog: { create: vi.fn() },
      organization: { findUnique, update: vi.fn() },
    } as never;

    const routes = buildSoulRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);
    const res = await app.fetch(new Request("http://localhost/"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      agentInstructions: "Use pt-BR",
      businessIdea: "Salon in SP",
      businessProfile: { tone: "warm" },
    });
    expect(findUnique).toHaveBeenCalledWith({
      select: { agentInstructions: true, businessIdea: true, businessProfile: true },
      where: { id: "org_a" },
    });
  });
});

describe("PUT /soul", () => {
  it("updates agentInstructions and emits an ActivityLog row", async () => {
    const update = vi.fn().mockResolvedValue({
      agentInstructions: "Be concise",
      businessIdea: null,
      businessProfile: null,
    });
    const activityCreate = vi.fn().mockResolvedValue({});
    const prisma = {
      activityLog: { create: activityCreate },
      organization: { findUnique: vi.fn(), update },
    } as never;

    const routes = buildSoulRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "STAFF", session }, routes);

    const res = await app.fetch(
      new Request("http://localhost/", {
        body: JSON.stringify({ agentInstructions: "Be concise" }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      }),
    );

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { agentInstructions: "Be concise" } }),
    );
    expect(activityCreate).toHaveBeenCalledOnce();
    const arg = activityCreate.mock.calls[0]![0] as { data: { type: string } };
    expect(arg.data.type).toBe("INSTRUCTIONS_UPDATED");
  });

  it("rejects businessProfile edits from STAFF (OWNER-only)", async () => {
    const update = vi.fn();
    const prisma = {
      activityLog: { create: vi.fn() },
      organization: { findUnique: vi.fn(), update },
    } as never;

    const routes = buildSoulRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "STAFF", session }, routes);

    const res = await app.fetch(
      new Request("http://localhost/", {
        body: JSON.stringify({ businessProfile: { tone: "warm" } }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      }),
    );

    expect(res.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("allows businessProfile edits from OWNER", async () => {
    const update = vi.fn().mockResolvedValue({
      agentInstructions: null,
      businessIdea: null,
      businessProfile: { tone: "warm" },
    });
    const prisma = {
      activityLog: { create: vi.fn() },
      organization: { findUnique: vi.fn(), update },
    } as never;

    const routes = buildSoulRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(
      new Request("http://localhost/", {
        body: JSON.stringify({ businessProfile: { tone: "warm" } }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      }),
    );

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalled();
  });

  it("returns 422 for an empty body", async () => {
    const prisma = {
      activityLog: { create: vi.fn() },
      organization: { findUnique: vi.fn(), update: vi.fn() },
    } as never;
    const routes = buildSoulRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(
      new Request("http://localhost/", {
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      }),
    );

    expect(res.status).toBe(422);
  });

  it("rejects an array as businessProfile (must be a plain object)", async () => {
    const prisma = {
      activityLog: { create: vi.fn() },
      organization: { findUnique: vi.fn(), update: vi.fn() },
    } as never;

    const routes = buildSoulRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(
      new Request("http://localhost/", {
        body: JSON.stringify({ businessProfile: ["nope"] }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      }),
    );

    expect(res.status).toBe(422);
  });
});
