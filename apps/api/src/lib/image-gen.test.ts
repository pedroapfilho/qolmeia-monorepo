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

  it("POSTs to the AI Gateway images endpoint with the openai/gpt-image-1 model and bearer auth", async () => {
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
    expect(url).toBe("https://ai-gateway.vercel.sh/v1/images/generations");
    expect((init.headers as Record<string, string>).authorization).toMatch(/^Bearer /v);
    const body = JSON.parse(init.body as string) as {
      model: string;
      n: number;
      prompt: string;
      size: string;
    };
    expect(body.model).toBe("openai/gpt-image-1");
    expect(body.prompt).toBe("Salão de cabelo moderno, paleta minimalista");
    expect(body.n).toBe(1);
    expect(body.size).toBe("1024x1024");
  });

  it("maps aspect ratios to gpt-image-1 sizes (16:9 -> 1536x1024, 9:16 -> 1024x1536)", async () => {
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

  it("throws with HTTP status + body when the Gateway returns non-200", async () => {
    fetchMock.mockResolvedValue(mkResponse(500, "Free credits restricted"));

    await expect(
      generateBrandImageBytes({ aspectRatio: "1:1", prompt: "x" }),
    ).rejects.toThrow(/HTTP 500.*Free credits restricted/iv);
  });

  it("throws when the response body has no data[0].b64_json", async () => {
    fetchMock.mockResolvedValue(mkResponse(200, { data: [] }));

    await expect(
      generateBrandImageBytes({ aspectRatio: "1:1", prompt: "x" }),
    ).rejects.toThrow(/missing data/iv);
  });
});
