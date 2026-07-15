import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchCatalogue, fetchTeam, hireMember, patchMember, setPaused } from "@/lib/team";

const okJson = (body: unknown): Response =>
  ({ json: () => Promise.resolve(body), ok: true, status: 200 }) as unknown as Response;

const errorResponse = (status: number): Response =>
  ({ json: () => Promise.resolve({}), ok: false, status }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchTeam", () => {
  it("GETs /api/me/team with credentials and returns members", async () => {
    const members = [{ id: "m1" }];
    fetchMock.mockResolvedValueOnce(okJson({ members }));

    const result = await fetchTeam();

    expect(fetchMock).toHaveBeenCalledWith("/api/me/team", { credentials: "include" });
    expect(result).toBe(members);
  });

  it("throws with the request label and status on failure", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(503));
    await expect(fetchTeam()).rejects.toThrow("GET /api/me/team failed (503)");
  });
});

describe("fetchCatalogue", () => {
  it("GETs /api/me/catalogue with credentials and returns templates", async () => {
    const templates = [{ id: "t1" }];
    fetchMock.mockResolvedValueOnce(okJson({ templates }));

    const result = await fetchCatalogue();

    expect(fetchMock).toHaveBeenCalledWith("/api/me/catalogue", { credentials: "include" });
    expect(result).toBe(templates);
  });

  it("throws on failure", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(500));
    await expect(fetchCatalogue()).rejects.toThrow("GET /api/me/catalogue failed (500)");
  });
});

describe("hireMember", () => {
  it("POSTs the input as JSON and returns the member", async () => {
    const member = { id: "m2" };
    fetchMock.mockResolvedValueOnce(okJson({ member }));

    const result = await hireMember({ displayName: "Ana", templateId: "tpl-1" });

    expect(fetchMock).toHaveBeenCalledWith("/api/me/team/hire", {
      body: JSON.stringify({ displayName: "Ana", templateId: "tpl-1" }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(result).toBe(member);
  });

  it("throws on failure", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(400));
    await expect(hireMember({ templateId: "tpl-1" })).rejects.toThrow(
      "POST /api/me/team/hire failed (400)",
    );
  });
});

describe("patchMember", () => {
  it("PATCHes the member path as JSON and returns the member", async () => {
    const member = { id: "m3" };
    fetchMock.mockResolvedValueOnce(okJson({ member }));

    const result = await patchMember("m3", { displayName: "Novo nome" });

    expect(fetchMock).toHaveBeenCalledWith("/api/me/team/members/m3", {
      body: JSON.stringify({ displayName: "Novo nome" }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    expect(result).toBe(member);
  });

  it("throws with the member id in the label on failure", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(404));
    await expect(patchMember("m3", {})).rejects.toThrow(
      "PATCH /api/me/team/members/m3 failed (404)",
    );
  });
});

describe("setPaused", () => {
  it("POSTs to the pause path when paused is true", async () => {
    const member = { id: "m4" };
    fetchMock.mockResolvedValueOnce(okJson({ member }));

    const result = await setPaused("m4", true);

    expect(fetchMock).toHaveBeenCalledWith("/api/me/team/members/m4/pause", {
      credentials: "include",
      method: "POST",
    });
    expect(result).toBe(member);
  });

  it("POSTs to the resume path when paused is false", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ member: { id: "m4" } }));

    await setPaused("m4", false);

    expect(fetchMock).toHaveBeenCalledWith("/api/me/team/members/m4/resume", {
      credentials: "include",
      method: "POST",
    });
  });

  it("throws on failure", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(400));
    await expect(setPaused("m4", true)).rejects.toThrow("pause/resume failed (400)");
  });
});
