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

// Creates a Drizzle-shaped mock db. The `insert` mock uses call-order tracking
// so the first call (organization) returns a row; the second (orgMembership) returns {}.
const buildDb = () => {
  let insertCallCount = 0;

  const makeInsertMock = () =>
    vi.fn().mockImplementation((_table: unknown) => {
      insertCallCount++;
      const idx = insertCallCount;
      return {
        values: (data: unknown) => ({
          returning: (): Promise<ReadonlyArray<unknown>> => {
            if (idx === 1) {
              const d = data as { name: string; slug: string };
              return Promise.resolve([{ id: "new_org_id", name: d.name, slug: d.slug }]);
            }
            return Promise.resolve([{}]);
          },
        }),
      };
    });

  const insert = makeInsertMock();

  const db = {
    insert,
    query: {
      organization: {
        findFirst: vi.fn().mockResolvedValue(undefined),
      },
    },
    transaction: vi.fn((callback: (tx: typeof db) => Promise<unknown>) => {
      insertCallCount = 0;
      return callback(db);
    }),
  };

  return db;
};

const DEFAULT_HEADERS: Record<string, string> = { "Content-Type": "application/json" };

const postOrgs = (
  app: ReturnType<typeof buildOrgsRoutes>,
  body: unknown,
  headers: Record<string, string> = DEFAULT_HEADERS,
): Promise<Response> =>
  Promise.resolve(
    app.fetch(
      new Request("http://localhost/", {
        body: typeof body === "string" ? body : JSON.stringify(body),
        headers,
        method: "POST",
      }),
    ),
  );

describe("POST /api/orgs", () => {
  it("401 when no session", async () => {
    const app = buildOrgsRoutes({
      auth: buildAuth(null),
      db: buildDb() as never,
      fetch: vi.fn(),
    });
    const res = await postOrgs(app, { name: "X", slug: "x" });
    expect(res.status).toBe(401);
  });

  it("400 on invalid JSON", async () => {
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      db: buildDb() as never,
      fetch: vi.fn(),
    });
    const res = await postOrgs(app, "not json");
    expect(res.status).toBe(400);
  });

  it("400 on invalid slug (uppercase letters)", async () => {
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      db: buildDb() as never,
      fetch: vi.fn(),
    });
    const res = await postOrgs(app, { name: "X", slug: "BAD-SLUG" });
    expect(res.status).toBe(400);
  });

  it("400 on invalid slug (whitespace)", async () => {
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      db: buildDb() as never,
      fetch: vi.fn(),
    });
    const res = await postOrgs(app, { name: "X", slug: "bad slug" });
    expect(res.status).toBe(400);
  });

  it("400 on empty slug", async () => {
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      db: buildDb() as never,
      fetch: vi.fn(),
    });
    const res = await postOrgs(app, { name: "X", slug: "" });
    expect(res.status).toBe(400);
  });

  it("409 when slug is already taken", async () => {
    const db = buildDb();
    db.query.organization.findFirst.mockResolvedValueOnce({
      id: "existing",
      name: "Existing",
      slug: "taken",
    });
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      db: db as never,
      fetch: vi.fn(),
    });
    const res = await postOrgs(app, { name: "X", slug: "taken" });
    expect(res.status).toBe(409);
  });

  it("201 happy path: creates org + OWNER membership + relays to agents", async () => {
    const db = buildDb();
    const fetchMock = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      db: db as never,
      fetch: fetchMock,
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
    expect(db.insert).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("creates org + OWNER membership inside one transaction", async () => {
    const db = buildDb();
    const fetchMock = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      db: db as never,
      fetch: fetchMock,
    });
    const res = await postOrgs(app, { name: "Fresh Co", slug: "fresh-co" });
    expect(res.status).toBe(201);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.insert).toHaveBeenCalled();
  });

  it("rolls back (no 201) when the OWNER membership write fails inside the transaction", async () => {
    const db = buildDb();
    // Override transaction to simulate a failure on the second insert (membership)
    db.transaction.mockImplementationOnce((callback: (tx: typeof db) => Promise<unknown>) => {
      let callCount = 0;
      const failingDb = {
        ...db,
        insert: vi.fn((_table: unknown) => ({
          values: (data: unknown) => ({
            returning: (): Promise<ReadonlyArray<unknown>> => {
              callCount++;
              if (callCount === 1) {
                const d = data as { name: string; slug: string };
                return Promise.resolve([{ id: "new_org_id", name: d.name, slug: d.slug }]);
              }
              return Promise.reject(new Error("membership insert blew up"));
            },
          }),
        })),
      };
      return callback(failingDb as never);
    });
    const fetchMock = vi.fn();
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      db: db as never,
      fetch: fetchMock,
    });
    // The membership failure must surface as an error (Hono → 500) rather than
    // returning 201 with a half-created tenant. No relay should fire.
    const res = await postOrgs(app, { name: "Fresh Co", slug: "fresh-co" });
    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("409 when the create transaction loses the slug race (unique constraint)", async () => {
    const db = buildDb();
    // Pre-check passes (findFirst → undefined) but the concurrent winner already
    // committed, so the create transaction trips the unique constraint.
    const postgresUniqueError = Object.assign(new Error("Unique constraint failed"), {
      code: "23505",
    });
    db.transaction.mockRejectedValueOnce(postgresUniqueError);
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      db: db as never,
      fetch: vi.fn(),
    });
    const res = await postOrgs(app, { name: "X", slug: "raced" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SLUG_TAKEN");
  });

  it("201 with d1Provisioned=false when the agents relay fails (org row still created)", async () => {
    const db = buildDb();
    const fetchMock = vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }));
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      db: db as never,
      fetch: fetchMock,
    });
    const res = await postOrgs(app, { name: "Fresh Co", slug: "fresh-co" });
    // Postgres rows still got created — relay is best-effort.
    expect(res.status).toBe(201);
    const body = (await res.json()) as { d1Provisioned: boolean };
    expect(body.d1Provisioned).toBe(false);
    expect(db.insert).toHaveBeenCalled();
  });

  it("201 with d1Provisioned=false when the agents Worker is unreachable", async () => {
    const db = buildDb();
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const app = buildOrgsRoutes({
      auth: buildAuth(sessionA),
      db: db as never,
      fetch: fetchMock,
    });
    const res = await postOrgs(app, { name: "Fresh Co", slug: "fresh-co" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { d1Provisioned: boolean };
    expect(body.d1Provisioned).toBe(false);
  });
});
