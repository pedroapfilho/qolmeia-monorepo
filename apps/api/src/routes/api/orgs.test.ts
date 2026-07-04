import { Prisma } from "@repo/db";
import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/middleware/require-staff";

import { buildOrgsRoutes } from "./orgs";

const sessionA: AuthSession = {
  session: { id: "sess_a", userId: "user_a" },
  user: { email: "a@example.com", id: "user_a", name: "A" },
};

const buildAuth = (session: AuthSession | null) => ({
  api: { getSession: vi.fn().mockResolvedValue(session) },
});

const buildPrisma = () => {
  const prisma = {
    $transaction: vi.fn((callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma)),
    organization: {
      create: vi
        .fn()
        .mockImplementation((args: { data: { name: string; slug: string } }) =>
          Promise.resolve({ id: "new_org_id", name: args.data.name, slug: args.data.slug }),
        ),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    orgMembership: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
  return prisma;
};

const DEFAULT_HEADERS: Record<string, string> = { "Content-Type": "application/json" };

const postOrgs = (
  app: ReturnType<typeof buildOrgsRoutes>,
  body: unknown,
  headers: Record<string, string> = DEFAULT_HEADERS,
): Promise<Response> => {
  const request = new Request("http://localhost/", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers,
    method: "POST",
  });

  return Promise.resolve(app.fetch(request));
};

describe("POST /api/orgs", () => {
  it("401 when no session", async () => {
    const app = buildOrgsRoutes({
      auth: buildAuth(null),
      fetch: vi.fn(),
      prisma: buildPrisma() as never,
    });
    const res = await postOrgs(app, { name: "X", slug: "x" });
    expect(res.status).toBe(401);
  });

  it("400 on invalid JSON", async () => {
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      fetch: vi.fn(),
      prisma: buildPrisma() as never,
    });
    const res = await postOrgs(app, "not json");
    expect(res.status).toBe(400);
  });

  it("400 on invalid slug (uppercase letters)", async () => {
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      fetch: vi.fn(),
      prisma: buildPrisma() as never,
    });
    const res = await postOrgs(app, { name: "X", slug: "BAD-SLUG" });
    expect(res.status).toBe(400);
  });

  it("400 on invalid slug (whitespace)", async () => {
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      fetch: vi.fn(),
      prisma: buildPrisma() as never,
    });
    const res = await postOrgs(app, { name: "X", slug: "bad slug" });
    expect(res.status).toBe(400);
  });

  it("400 on empty slug", async () => {
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      fetch: vi.fn(),
      prisma: buildPrisma() as never,
    });
    const res = await postOrgs(app, { name: "X", slug: "" });
    expect(res.status).toBe(400);
  });

  it("409 when slug is already taken", async () => {
    const prisma = buildPrisma();
    prisma.organization.findUnique.mockResolvedValueOnce({
      id: "existing",
      name: "Existing",
      slug: "taken",
    });
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      fetch: vi.fn(),
      prisma: prisma as never,
    });
    const res = await postOrgs(app, { name: "X", slug: "taken" });
    expect(res.status).toBe(409);
  });

  it("201 happy path: creates org + OWNER membership + relays to agents", async () => {
    const prisma = buildPrisma();
    const fetchMock = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      fetch: fetchMock,
      prisma: prisma as never,
    });
    const res = await postOrgs(app, { name: "Fresh Co", slug: "fresh-co" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      currentOrg: { id: string; role: string };
      d1Provisioned: boolean;
    };
    expect(body.currentOrg.id).toBe("new_org_id");
    expect(body.currentOrg.role).toBe("OWNER");
    expect(body.d1Provisioned).toBe(true);
    expect(prisma.organization.create).toHaveBeenCalledWith({
      data: { name: "Fresh Co", slug: "fresh-co" },
    });
    expect(prisma.orgMembership.create).toHaveBeenCalledWith({
      data: { orgId: "new_org_id", role: "OWNER", userId: "user_a" },
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("creates org + OWNER membership inside one transaction", async () => {
    const prisma = buildPrisma();
    const fetchMock = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      fetch: fetchMock,
      prisma: prisma as never,
    });
    const res = await postOrgs(app, { name: "Fresh Co", slug: "fresh-co" });
    expect(res.status).toBe(201);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.organization.create).toHaveBeenCalled();
    expect(prisma.orgMembership.create).toHaveBeenCalled();
  });

  it("rolls back (no 201) when the OWNER membership write fails inside the transaction", async () => {
    const prisma = buildPrisma();
    prisma.orgMembership.create.mockRejectedValueOnce(new Error("membership insert blew up"));
    const fetchMock = vi.fn();
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      fetch: fetchMock,
      prisma: prisma as never,
    });
    const res = await postOrgs(app, { name: "Fresh Co", slug: "fresh-co" });
    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("409 when the create transaction loses the slug race (P2002)", async () => {
    const prisma = buildPrisma();
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        clientVersion: "test",
        code: "P2002",
        meta: { target: ["slug"] },
      }),
    );
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      fetch: vi.fn(),
      prisma: prisma as never,
    });
    const res = await postOrgs(app, { name: "X", slug: "raced" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SLUG_TAKEN");
  });

  it("201 with d1Provisioned=false when the agents relay fails (org row still created)", async () => {
    const prisma = buildPrisma();
    const fetchMock = vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }));
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      fetch: fetchMock,
      prisma: prisma as never,
    });
    const res = await postOrgs(app, { name: "Fresh Co", slug: "fresh-co" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { d1Provisioned: boolean };
    expect(body.d1Provisioned).toBe(false);
    expect(prisma.organization.create).toHaveBeenCalled();
    expect(prisma.orgMembership.create).toHaveBeenCalled();
  });

  it("201 with d1Provisioned=false when the agents Worker is unreachable", async () => {
    const prisma = buildPrisma();
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      fetch: fetchMock,
      prisma: prisma as never,
    });
    const res = await postOrgs(app, { name: "Fresh Co", slug: "fresh-co" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { d1Provisioned: boolean };
    expect(body.d1Provisioned).toBe(false);
  });
});
