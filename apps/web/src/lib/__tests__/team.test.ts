import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as TeamModule from "@/lib/team";

const ORG_ID = "co_1";
const ORG_HEADERS = { "x-org-id": ORG_ID };
const JSON_HEADERS = { "content-type": "application/json", ...ORG_HEADERS };

const okJson = (body: unknown): Response =>
  ({ json: () => Promise.resolve(body), ok: true, status: 200 }) as unknown as Response;

const errorResponse = (status: number): Response =>
  ({ json: () => Promise.resolve({}), ok: false, status }) as unknown as Response;

const ME = okJson({ currentOrg: { id: ORG_ID, role: "CUSTOMER" }, orgs: [] });

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn<FetchLike>>;
let team: typeof TeamModule;

const respondWith = (responses: Record<string, Response>): void => {
  fetchMock.mockImplementation((url: string) => {
    const response = responses[url];
    if (response === undefined) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    return Promise.resolve(response);
  });
};

beforeEach(async () => {
  vi.resetModules();
  fetchMock = vi.fn<FetchLike>();
  vi.stubGlobal("fetch", fetchMock);
  team = await import("@/lib/team");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("org discovery", () => {
  it("names the org on every call after learning it once from /api/me", async () => {
    respondWith({ "/api/me": ME, "/api/me/team": okJson({ members: [] }) });

    await team.fetchTeam();
    await team.fetchTeam();

    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/me")).toHaveLength(1);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/me/team", {
      credentials: "include",
      headers: ORG_HEADERS,
    });
  });

  it("falls back to the first CUSTOMER org when no org is current", async () => {
    respondWith({
      "/api/me": okJson({
        currentOrg: null,
        orgs: [
          { id: "co_staff", role: "STAFF" },
          { id: "co_customer", role: "CUSTOMER" },
        ],
      }),
      "/api/me/team": okJson({ members: [] }),
    });

    await team.fetchTeam();

    expect(fetchMock).toHaveBeenLastCalledWith("/api/me/team", {
      credentials: "include",
      headers: { "x-org-id": "co_customer" },
    });
  });

  it("surfaces a failed discovery instead of calling on with no org", async () => {
    respondWith({ "/api/me": errorResponse(502) });

    await expect(team.fetchTeam()).rejects.toThrow("GET /api/me failed (502)");
  });
});

describe("fetchTeam", () => {
  it("GETs /api/me/team with credentials and returns members", async () => {
    const members = [{ id: "m1" }];
    respondWith({ "/api/me": ME, "/api/me/team": okJson({ members }) });

    const result = await team.fetchTeam();

    expect(fetchMock).toHaveBeenCalledWith("/api/me/team", {
      credentials: "include",
      headers: ORG_HEADERS,
    });
    expect(result).toBe(members);
  });

  it("throws with the request label and status on failure", async () => {
    respondWith({ "/api/me": ME, "/api/me/team": errorResponse(503) });
    await expect(team.fetchTeam()).rejects.toThrow("GET /api/me/team failed (503)");
  });
});

describe("fetchCatalogue", () => {
  it("GETs /api/me/catalogue with credentials and returns templates", async () => {
    const templates = [{ id: "t1" }];
    respondWith({ "/api/me": ME, "/api/me/catalogue": okJson({ templates }) });

    const result = await team.fetchCatalogue();

    expect(fetchMock).toHaveBeenCalledWith("/api/me/catalogue", {
      credentials: "include",
      headers: ORG_HEADERS,
    });
    expect(result).toBe(templates);
  });

  it("throws on failure", async () => {
    respondWith({ "/api/me": ME, "/api/me/catalogue": errorResponse(500) });
    await expect(team.fetchCatalogue()).rejects.toThrow("GET /api/me/catalogue failed (500)");
  });
});

describe("hireMember", () => {
  it("POSTs the input as JSON and returns the member", async () => {
    const member = { id: "m2" };
    respondWith({ "/api/me": ME, "/api/me/team/hire": okJson({ member }) });

    const result = await team.hireMember({ displayName: "Ana", templateId: "tpl-1" });

    expect(fetchMock).toHaveBeenCalledWith("/api/me/team/hire", {
      body: JSON.stringify({ displayName: "Ana", templateId: "tpl-1" }),
      credentials: "include",
      headers: JSON_HEADERS,
      method: "POST",
    });
    expect(result).toBe(member);
  });

  it("throws on failure", async () => {
    respondWith({ "/api/me": ME, "/api/me/team/hire": errorResponse(400) });
    await expect(team.hireMember({ templateId: "tpl-1" })).rejects.toThrow(
      "POST /api/me/team/hire failed (400)",
    );
  });
});

describe("patchMember", () => {
  it("PATCHes the member path as JSON and returns the member", async () => {
    const member = { id: "m3" };
    respondWith({ "/api/me": ME, "/api/me/team/members/m3": okJson({ member }) });

    const result = await team.patchMember("m3", { displayName: "Novo nome" });

    expect(fetchMock).toHaveBeenCalledWith("/api/me/team/members/m3", {
      body: JSON.stringify({ displayName: "Novo nome" }),
      credentials: "include",
      headers: JSON_HEADERS,
      method: "PATCH",
    });
    expect(result).toBe(member);
  });

  it("throws with the member id in the label on failure", async () => {
    respondWith({ "/api/me": ME, "/api/me/team/members/m3": errorResponse(404) });
    await expect(team.patchMember("m3", {})).rejects.toThrow(
      "PATCH /api/me/team/members/m3 failed (404)",
    );
  });
});

describe("setPaused", () => {
  it("POSTs to the pause path when paused is true", async () => {
    const member = { id: "m4" };
    respondWith({ "/api/me": ME, "/api/me/team/members/m4/pause": okJson({ member }) });

    const result = await team.setPaused("m4", true);

    expect(fetchMock).toHaveBeenCalledWith("/api/me/team/members/m4/pause", {
      credentials: "include",
      headers: ORG_HEADERS,
      method: "POST",
    });
    expect(result).toBe(member);
  });

  it("POSTs to the resume path when paused is false", async () => {
    respondWith({
      "/api/me": ME,
      "/api/me/team/members/m4/resume": okJson({ member: { id: "m4" } }),
    });

    await team.setPaused("m4", false);

    expect(fetchMock).toHaveBeenCalledWith("/api/me/team/members/m4/resume", {
      credentials: "include",
      headers: ORG_HEADERS,
      method: "POST",
    });
  });

  it("throws on failure", async () => {
    respondWith({ "/api/me": ME, "/api/me/team/members/m4/pause": errorResponse(400) });
    await expect(team.setPaused("m4", true)).rejects.toThrow("pause/resume failed (400)");
  });
});
