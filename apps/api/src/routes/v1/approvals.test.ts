import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthSession, StaffContextVars } from "@/middleware/require-staff";

import { buildApprovalsRoutes } from "./approvals";

const session: AuthSession = {
  session: { id: "sess_1", userId: "user_1" },
  user: { email: "u@example.com", id: "user_1", name: "U" },
};

const buildAction = (overrides: { id?: string; orgId?: string } = {}) => ({
  agentInstance: {
    orgId: overrides.orgId ?? "org_a",
    template: { displayName: "Marketing Strategist" },
  },
  agentInstanceId: "ag_1",
  createdAt: new Date("2026-01-15T00:00:00.000Z"),
  id: overrides.id ?? "act_1",
  proposedInput: { foo: "bar" },
  proposedSummary: "Send brand image",
  skill: { displayName: "Generate Brand Image", id: "generateBrandImage" },
  skillId: "generateBrandImage",
  status: "DRAFTED",
});

const buildAppWithGuard = (
  vars: StaffContextVars,
  routes: ReturnType<typeof buildApprovalsRoutes>,
) => {
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

describe("GET /approvals", () => {
  it("lists DRAFTED actions for the current org", async () => {
    const findMany = vi.fn().mockResolvedValue([buildAction()]);
    const prisma = {
      activityLog: { create: vi.fn() },
      agentAction: { findMany, findUnique: vi.fn(), update: vi.fn() },
      agentInstance: { findUniqueOrThrow: vi.fn() },
    } as never;

    const routes = buildApprovalsRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);
    const res = await app.fetch(new Request("http://localhost/"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: ReadonlyArray<{
        agentTemplateDisplayName: string;
        id: string;
        proposedSummary: string;
      }>;
      nextCursor: string | null;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe("act_1");
    expect(body.items[0]!.agentTemplateDisplayName).toBe("Marketing Strategist");
    expect(body.nextCursor).toBeNull();
    expect(findMany.mock.calls[0]![0].where).toMatchObject({
      agentInstance: { orgId: "org_a" },
      status: "DRAFTED",
    });
  });

  it("emits a nextCursor when more rows exist", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        buildAction({ id: "a" }),
        buildAction({ id: "b" }),
        buildAction({ id: "c" }),
      ]);
    const prisma = {
      activityLog: { create: vi.fn() },
      agentAction: { findMany, findUnique: vi.fn(), update: vi.fn() },
      agentInstance: { findUniqueOrThrow: vi.fn() },
    } as never;

    const routes = buildApprovalsRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);
    const res = await app.fetch(new Request("http://localhost/?limit=2"));
    const body = (await res.json()) as { items: ReadonlyArray<unknown>; nextCursor: string | null };
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).not.toBeNull();
  });
});

const buildDetailRow = (overrides: { id?: string; orgId?: string } = {}) => ({
  agentInstance: {
    displayName: "Marketing Bot",
    id: "ag_1",
    orgId: overrides.orgId ?? "org_a",
    templateSlug: "marketing-strategist",
  },
  agentInstanceId: "ag_1",
  createdAt: new Date("2026-01-15T00:00:00.000Z"),
  id: overrides.id ?? "act_1",
  proposedInput: { tone: "warm" },
  proposedSummary: "Send brand image",
  skill: {
    description: "Generate a brand image",
    displayName: "Generate Brand Image",
    id: "generateBrandImage",
    parametersJsonSchema: {
      properties: { tone: { type: "string" } },
      type: "object",
    },
  },
  skillId: "generateBrandImage",
  status: "DRAFTED",
});

describe("GET /approvals/:id", () => {
  it("returns the action plus skill schema for the caller's org", async () => {
    const findUnique = vi.fn().mockResolvedValue(buildDetailRow());
    const prisma = {
      activityLog: { create: vi.fn() },
      agentAction: { findMany: vi.fn(), findUnique, update: vi.fn() },
      agentInstance: { findUniqueOrThrow: vi.fn() },
    } as never;

    const routes = buildApprovalsRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);
    const res = await app.fetch(new Request("http://localhost/act_1"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      action: {
        agentInstance: { displayName: string; templateSlug: string };
        id: string;
        proposedInput: unknown;
        skill: { id: string; parametersJsonSchema: unknown };
        status: string;
      };
    };
    expect(body.action.id).toBe("act_1");
    expect(body.action.skill.id).toBe("generateBrandImage");
    expect(body.action.skill.parametersJsonSchema).toEqual({
      properties: { tone: { type: "string" } },
      type: "object",
    });
    expect(body.action.agentInstance.displayName).toBe("Marketing Bot");
    expect(body.action.agentInstance.templateSlug).toBe("marketing-strategist");
    expect(body.action.status).toBe("DRAFTED");
  });

  it("returns 404 when the action belongs to a different org", async () => {
    const findUnique = vi.fn().mockResolvedValue(buildDetailRow({ orgId: "org_other" }));
    const prisma = {
      activityLog: { create: vi.fn() },
      agentAction: { findMany: vi.fn(), findUnique, update: vi.fn() },
      agentInstance: { findUniqueOrThrow: vi.fn() },
    } as never;

    const routes = buildApprovalsRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);
    const res = await app.fetch(new Request("http://localhost/act_1"));

    expect(res.status).toBe(404);
  });

  it("returns 404 when the action does not exist", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = {
      activityLog: { create: vi.fn() },
      agentAction: { findMany: vi.fn(), findUnique, update: vi.fn() },
      agentInstance: { findUniqueOrThrow: vi.fn() },
    } as never;

    const routes = buildApprovalsRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);
    const res = await app.fetch(new Request("http://localhost/missing"));

    expect(res.status).toBe(404);
  });
});

describe("POST /approvals/:id/approve", () => {
  it("calls approveAction with the session user", async () => {
    const approveAction = vi.fn().mockResolvedValue({ id: "act_1", status: "APPROVED" });
    const findUnique = vi.fn().mockResolvedValue({
      agentInstance: { orgId: "org_a" },
      id: "act_1",
    });
    const prisma = {
      activityLog: { create: vi.fn() },
      agentAction: { findMany: vi.fn(), findUnique, update: vi.fn() },
      agentInstance: { findUniqueOrThrow: vi.fn() },
    } as never;

    const routes = buildApprovalsRoutes({ approveAction, prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);
    const res = await app.fetch(new Request("http://localhost/act_1/approve", { method: "POST" }));

    expect(res.status).toBe(200);
    expect(approveAction).toHaveBeenCalledWith({
      actionId: "act_1",
      decidedByUserId: "user_1",
      prisma,
    });
  });

  it("returns 404 when the action belongs to a different org", async () => {
    const approveAction = vi.fn();
    const findUnique = vi.fn().mockResolvedValue({
      agentInstance: { orgId: "org_other" },
      id: "act_1",
    });
    const prisma = {
      activityLog: { create: vi.fn() },
      agentAction: { findMany: vi.fn(), findUnique, update: vi.fn() },
      agentInstance: { findUniqueOrThrow: vi.fn() },
    } as never;

    const routes = buildApprovalsRoutes({ approveAction, prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);
    const res = await app.fetch(new Request("http://localhost/act_1/approve", { method: "POST" }));

    expect(res.status).toBe(404);
    expect(approveAction).not.toHaveBeenCalled();
  });
});

describe("POST /approvals/:id/reject", () => {
  it("forwards the reason to rejectAction", async () => {
    const rejectAction = vi.fn().mockResolvedValue({ id: "act_1", status: "REJECTED" });
    const findUnique = vi.fn().mockResolvedValue({
      agentInstance: { orgId: "org_a" },
      id: "act_1",
    });
    const prisma = {
      activityLog: { create: vi.fn() },
      agentAction: { findMany: vi.fn(), findUnique, update: vi.fn() },
      agentInstance: { findUniqueOrThrow: vi.fn() },
    } as never;

    const routes = buildApprovalsRoutes({ prisma, rejectAction });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);
    const res = await app.fetch(
      new Request("http://localhost/act_1/reject", {
        body: JSON.stringify({ reason: "off-brand" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(res.status).toBe(200);
    expect(rejectAction).toHaveBeenCalledWith({
      actionId: "act_1",
      decidedByUserId: "user_1",
      prisma,
      reason: "off-brand",
    });
  });

  it("accepts an empty body (no reason)", async () => {
    const rejectAction = vi.fn().mockResolvedValue({ id: "act_1", status: "REJECTED" });
    const findUnique = vi.fn().mockResolvedValue({
      agentInstance: { orgId: "org_a" },
      id: "act_1",
    });
    const prisma = {
      activityLog: { create: vi.fn() },
      agentAction: { findMany: vi.fn(), findUnique, update: vi.fn() },
      agentInstance: { findUniqueOrThrow: vi.fn() },
    } as never;

    const routes = buildApprovalsRoutes({ prisma, rejectAction });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);
    const res = await app.fetch(new Request("http://localhost/act_1/reject", { method: "POST" }));

    expect(res.status).toBe(200);
    expect(rejectAction).toHaveBeenCalledWith({
      actionId: "act_1",
      decidedByUserId: "user_1",
      prisma,
      reason: undefined,
    });
  });
});

describe("POST /approvals/:id/edit", () => {
  it("forwards newInput to editAction", async () => {
    const editAction = vi.fn().mockResolvedValue({ id: "act_1", status: "EDITED" });
    const findUnique = vi.fn().mockResolvedValue({
      agentInstance: { orgId: "org_a" },
      id: "act_1",
    });
    const prisma = {
      activityLog: { create: vi.fn() },
      agentAction: { findMany: vi.fn(), findUnique, update: vi.fn() },
      agentInstance: { findUniqueOrThrow: vi.fn() },
    } as never;

    const routes = buildApprovalsRoutes({ editAction, prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);
    const res = await app.fetch(
      new Request("http://localhost/act_1/edit", {
        body: JSON.stringify({ newInput: { foo: "baz" } }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(res.status).toBe(200);
    expect(editAction).toHaveBeenCalledWith({
      actionId: "act_1",
      decidedByUserId: "user_1",
      newInput: { foo: "baz" },
      prisma,
    });
  });

  it("returns 422 when newInput is missing", async () => {
    const editAction = vi.fn();
    const prisma = {
      activityLog: { create: vi.fn() },
      agentAction: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      agentInstance: { findUniqueOrThrow: vi.fn() },
    } as never;

    const routes = buildApprovalsRoutes({ editAction, prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);
    const res = await app.fetch(
      new Request("http://localhost/act_1/edit", {
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(res.status).toBe(422);
    expect(editAction).not.toHaveBeenCalled();
  });
});
