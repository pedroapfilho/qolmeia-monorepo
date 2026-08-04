import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "co_write_guard_test";
const ORIGINAL_FETCH = globalThis.fetch;

const meStaff = {
  currentOrg: { id: COMPANY_ID, role: "STAFF" },
  user: { id: "staff-1" },
};

type WriteRoute = { body?: BodyInit; method: string; path: string };

const WRITE_ROUTES: Array<WriteRoute> = [
  { body: JSON.stringify({}), method: "PATCH", path: "/api/me/company" },
  {
    body: JSON.stringify({ templateId: "tpl-designer" }),
    method: "POST",
    path: "/api/me/team/hire",
  },
  { body: JSON.stringify({}), method: "PATCH", path: "/api/me/team/members/ai_1" },
  { method: "POST", path: "/api/me/team/members/ai_1/pause" },
  { method: "POST", path: "/api/me/team/members/ai_1/resume" },
  { body: new FormData(), method: "POST", path: "/api/me/uploads" },
  { body: new FormData(), method: "POST", path: "/api/me/brand-assets" },
  { method: "DELETE", path: "/api/me/brand-assets/asset_1" },
  { body: JSON.stringify({ ids: ["asset_1"] }), method: "POST", path: "/api/me/assets/delete" },
  {
    body: JSON.stringify({ templateIds: ["tpl-designer"] }),
    method: "POST",
    path: `/api/teams/${COMPANY_ID}/confirm`,
  },
];

const callAs = (role: typeof meStaff, route: WriteRoute, token: string): Promise<Response> => {
  globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(role)));
  return exports.default.fetch(`https://agents.test${route.path}?cf_session=${token}`, {
    body: route.body,
    method: route.method,
  });
};

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("customer write guard", () => {
  it.each(WRITE_ROUTES)("rejects a STAFF session on $method $path", async (route) => {
    const res = await callAs(meStaff, route, `staff-${route.method}-${route.path}`);
    expect(res.status).toBe(403);
  });

  it("still lets a STAFF session read", async () => {
    const res = await callAs(meStaff, { method: "GET", path: "/api/me/company" }, "staff-read");
    expect(res.status).not.toBe(403);
  });
});

// The asset routes gave up their own session guard when they moved inside
// meRoutes, so their reads are guarded only if that single mount holds.
describe("session guard on the merged /api/me mount", () => {
  it("returns 401 for a credential-less read of /api/me/assets", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const res = await exports.default.fetch("https://agents.test/api/me/assets");

    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
