import { env, SELF } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Exercises POST /api/internal/companies — the auth → agents relay that
// provisions a D1 company row when an Organization is created in Postgres.
// The internal route is gated by INTERNAL_SHARED_SECRET; the test installs
// a known secret via env stubbing for the duration of the suite.

const SECRET = "test-internal-secret-rotate-me";
let originalSecret: string | undefined;

beforeAll(() => {
  originalSecret = env.INTERNAL_SHARED_SECRET;
  env.INTERNAL_SHARED_SECRET = SECRET;
});

afterAll(() => {
  env.INTERNAL_SHARED_SECRET = originalSecret as string;
});

const post = (body: unknown, init: { authorization?: string } = {}) =>
  SELF.fetch("https://agents.test/api/internal/companies", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(init.authorization ? { Authorization: init.authorization } : {}),
    },
    method: "POST",
  });

describe("POST /api/internal/companies", () => {
  it("503 when the shared secret is missing on the receiver", async () => {
    env.INTERNAL_SHARED_SECRET = "";
    const res = await post(
      { id: "co_no_secret", name: "X", slug: "x" },
      { authorization: `Bearer ${SECRET}` },
    );
    expect(res.status).toBe(503);
    env.INTERNAL_SHARED_SECRET = SECRET;
  });

  it("403 when the bearer token doesn't match", async () => {
    const res = await post(
      { id: "co_bad", name: "X", slug: "x" },
      { authorization: "Bearer wrong-secret" },
    );
    expect(res.status).toBe(403);
  });

  it("403 when the Authorization header is missing entirely", async () => {
    const res = await post({ id: "co_no_auth", name: "X", slug: "x" });
    expect(res.status).toBe(403);
  });

  it("400 when the slug fails the lowercase-alphanumeric rule", async () => {
    const res = await post(
      { id: "co_bad_slug", name: "Bad", slug: "BAD SLUG" },
      { authorization: `Bearer ${SECRET}` },
    );
    expect(res.status).toBe(400);
  });

  it("400 on invalid JSON body", async () => {
    const res = await SELF.fetch("https://agents.test/api/internal/companies", {
      body: "{not json",
      headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(400);
  });

  it("happy path: inserts the company row + both Correspondent and Planner agent_instance rows", async () => {
    const id = `co_${crypto.randomUUID()}`;
    const res = await post(
      { id, name: "Provisioned Org", slug: "provisioned-org" },
      { authorization: `Bearer ${SECRET}` },
    );
    expect(res.status).toBe(200);

    const company = await env.DB.prepare("SELECT id, name, slug, status FROM company WHERE id = ?")
      .bind(id)
      .first<{ id: string; name: string; slug: string; status: string }>();
    expect(company).toBeTruthy();
    expect(company?.status).toBe("onboarding");
    expect(company?.name).toBe("Provisioned Org");

    const { results } = await env.DB.prepare(
      "SELECT id, role FROM agent_instance WHERE company_id = ? ORDER BY role",
    )
      .bind(id)
      .all<{ id: string; role: string }>();
    expect(results.map((r) => r.role).toSorted()).toEqual(["correspondent", "planner"]);
    expect(results.find((r) => r.role === "correspondent")?.id).toBe(`corr-${id}`);
    expect(results.find((r) => r.role === "planner")?.id).toBe(`planner-${id}`);
  });

  it("happy path is idempotent — re-calling with the same id is a no-op", async () => {
    const id = `co_idem_${crypto.randomUUID()}`;
    const body = { id, name: "Idempotent", slug: `idem-${crypto.randomUUID().slice(0, 8)}` };
    const headers = { authorization: `Bearer ${SECRET}` };

    const first = await post(body, headers);
    expect(first.status).toBe(200);
    const second = await post(body, headers);
    expect(second.status).toBe(200);

    const { results } = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM agent_instance WHERE company_id = ?",
    )
      .bind(id)
      .all<{ c: number }>();
    expect(results[0]?.c).toBe(2);
  });
});
