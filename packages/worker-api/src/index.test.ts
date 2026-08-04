import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, createBrowserApi, createServerApi, handleResponse } from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createBrowserApi", () => {
  it("prefixes agentsUrl + basePath and parses JSON on apiGet", async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(Response.json({ ok: true })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const api = createBrowserApi("https://w.example", "/api/backoffice");
    const out = await api.apiGet<{ ok: boolean }>("/actions");

    expect(out).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://w.example/api/backoffice/actions",
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );
  });

  it("throws ApiError carrying status + body on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("nope", { status: 403 }))),
    );

    const api = createBrowserApi("");
    await expect(api.apiGet("/x")).rejects.toMatchObject({ body: "nope", status: 403 });
    await expect(api.apiGet("/x")).rejects.toBeInstanceOf(ApiError);
  });

  it("returns null on 204", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );

    const api = createBrowserApi("");
    expect(await api.apiSend("DELETE", "/x")).toBeNull();
  });

  it("serializes a JSON body and sets Content-Type on apiSend", async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(Response.json({ id: 1 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const api = createBrowserApi("", "/api/backoffice");
    await api.apiSend("POST", "/templates", { name: "x" });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBe(JSON.stringify({ name: "x" }));
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
  });

  it("lets FormData set its own Content-Type on apiSendForm", async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(Response.json({ ok: true })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const api = createBrowserApi("");
    await api.apiSendForm("/uploads", new FormData());

    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
  });
});

describe("createServerApi", () => {
  it("prefixes baseUrl + basePath and forwards the request cookie", async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(Response.json({ items: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { apiGetServer } = createServerApi({
      basePath: "/api/backoffice",
      baseUrl: "https://w.example",
      readCookieHeader: () => Promise.resolve("session=abc"),
      readOrgId: () => Promise.resolve("org_1"),
    });
    const out = await apiGetServer<{ items: ReadonlyArray<string> }>("/tickets");

    expect(out).toEqual({ items: [] });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://w.example/api/backoffice/tickets");
    expect(new Headers(init?.headers).get("Cookie")).toBe("session=abc");
    expect(init?.cache).toBe("no-store");
  });

  it("names the tenant with X-Org-Id on every server read", async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(Response.json({ ok: true })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { apiGetServer } = createServerApi({
      baseUrl: "https://w.example",
      readCookieHeader: () => Promise.resolve("session=abc"),
      readOrgId: () => Promise.resolve("org_2"),
    });
    await apiGetServer("/me/company");

    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("X-Org-Id")).toBe("org_2");
  });

  it("omits the Cookie header when the request carries none", async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(Response.json({ ok: true })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { apiGetServer } = createServerApi({
      baseUrl: "",
      readCookieHeader: () => Promise.resolve(""),
      readOrgId: () => Promise.resolve("org_1"),
    });
    await apiGetServer("/me");

    const init = fetchMock.mock.calls[0]?.[1];
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/me");
    expect(new Headers(init?.headers).has("Cookie")).toBe(false);
  });
});

describe("handleResponse", () => {
  it("parses JSON on ok, returns null on 204, and throws ApiError otherwise", async () => {
    expect(await handleResponse<{ a: number }>(Response.json({ a: 1 }))).toEqual({ a: 1 });
    expect(await handleResponse(new Response(null, { status: 204 }))).toBeNull();
    await expect(handleResponse(new Response("bad", { status: 500 }))).rejects.toMatchObject({
      body: "bad",
      status: 500,
    });
    await expect(handleResponse(new Response("bad", { status: 500 }))).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
