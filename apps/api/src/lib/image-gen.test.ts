import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateBrandImageBytes } from "./image-gen";

const mkResponse = (status: number, body: unknown): Response =>
  ({
    json: () => Promise.resolve(body),
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  }) as unknown as Response;

describe("generateBrandImageBytes", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to the OpenRouter images endpoint with the Nano Banana Pro model + OpenRouter bearer + attribution headers", async () => {
    const png = Buffer.from([1, 2, 3, 4]);
    fetchMock.mockResolvedValue(
      mkResponse(200, { data: [{ b64_json: png.toString("base64") }] }),
    );

    const result = await generateBrandImageBytes({
      aspectRatio: "1:1",
      prompt: "Salão de cabelo moderno, paleta minimalista",
    });

    expect([...result]).toEqual([1, 2, 3, 4]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/images/generations");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^Bearer /v);
    expect(headers["X-Title"]).toBe("Qolmeia");
    expect(headers["HTTP-Referer"]).toBeDefined();
    const body = JSON.parse(init.body as string) as {
      model: string;
      n: number;
      prompt: string;
      size: string;
    };
    // Default from env schema = Nano Banana Pro. Operators can swap via
    // env.IMAGE_GEN_MODEL — this assertion locks the locked default.
    expect(body.model).toBe("google/gemini-3-pro-image-preview");
    expect(body.prompt).toBe("Salão de cabelo moderno, paleta minimalista");
    expect(body.n).toBe(1);
    expect(body.size).toBe("1024x1024");
  });

  it("maps aspect ratios to sizes (16:9 -> 1536x1024, 9:16 -> 1024x1536, 4:3 -> square fallback)", async () => {
    fetchMock.mockResolvedValue(
      mkResponse(200, { data: [{ b64_json: Buffer.from([0]).toString("base64") }] }),
    );

    await generateBrandImageBytes({ aspectRatio: "16:9", prompt: "x" });
    expect((JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string) as { size: string }).size).toBe(
      "1536x1024",
    );

    await generateBrandImageBytes({ aspectRatio: "9:16", prompt: "x" });
    expect((JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string) as { size: string }).size).toBe(
      "1024x1536",
    );

    await generateBrandImageBytes({ aspectRatio: "4:3", prompt: "x" });
    expect((JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string) as { size: string }).size).toBe(
      "1024x1024",
    );
  });

  it("throws with HTTP status + body when OpenRouter returns non-200", async () => {
    fetchMock.mockResolvedValue(mkResponse(500, "Internal model error"));

    await expect(
      generateBrandImageBytes({ aspectRatio: "1:1", prompt: "x" }),
    ).rejects.toThrow(/HTTP 500.*Internal model error/iv);
  });

  it("throws when the response body has no data[0].b64_json", async () => {
    fetchMock.mockResolvedValue(mkResponse(200, { data: [] }));

    await expect(
      generateBrandImageBytes({ aspectRatio: "1:1", prompt: "x" }),
    ).rejects.toThrow(/missing data/iv);
  });
});
