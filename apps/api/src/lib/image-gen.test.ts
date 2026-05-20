import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  gateway: vi.fn((id: string) => ({ modelId: id })),
  generateText: vi.fn(),
  tool: vi.fn((t: unknown) => t),
}));

// eslint-disable-next-line import/order -- vi.mock hoist
import { generateText } from "ai";

import { generateBrandImageBytes } from "./image-gen";

const mockedGenerateText = vi.mocked(generateText);

describe("generateBrandImageBytes", () => {
  it("calls generateText with the Gemini image model + IMAGE responseModality and returns bytes", async () => {
    const expectedBytes = new Uint8Array([5, 6, 7, 8]);
    mockedGenerateText.mockResolvedValue({
      files: [{ mediaType: "image/png", uint8Array: expectedBytes }],
      text: "",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    } as never);

    const result = await generateBrandImageBytes({
      aspectRatio: "1:1",
      prompt: "Salão de cabelo moderno, paleta minimalista",
    });

    expect(result).toBe(expectedBytes);
    expect(mockedGenerateText).toHaveBeenCalledOnce();
    const args = mockedGenerateText.mock.calls[0]![0] as {
      messages: Array<{ content: Array<{ text?: string; type: string }>; role: string }>;
      model: { modelId: string };
      providerOptions?: { google?: { responseModalities?: Array<string> } };
    };
    expect(args.model.modelId).toBe("google/gemini-2.5-flash-image");
    expect(args.providerOptions?.google?.responseModalities).toEqual(["IMAGE", "TEXT"]);
    expect(args.messages[0]!.content.some((p) => p.type === "text" && p.text === "Salão de cabelo moderno, paleta minimalista")).toBe(true);
  });

  it("forwards reference images as file content parts before the prompt text", async () => {
    mockedGenerateText.mockResolvedValue({
      files: [{ mediaType: "image/png", uint8Array: new Uint8Array([1]) }],
      text: "",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    } as never);
    const refBytes = new Uint8Array([9, 9, 9]);

    await generateBrandImageBytes({
      aspectRatio: "1:1",
      prompt: "prompt",
      referenceImages: [{ bytes: refBytes, mimeType: "image/jpeg" }],
    });

    const args = mockedGenerateText.mock.calls.at(-1)![0] as {
      messages: Array<{ content: Array<{ data?: Uint8Array; mediaType?: string; text?: string; type: string }> }>;
    };
    const parts = args.messages[0]!.content;
    expect(parts[0]!.type).toBe("file");
    expect(parts[0]!.data).toBe(refBytes);
    expect(parts[0]!.mediaType).toBe("image/jpeg");
    expect(parts.at(-1)!.type).toBe("text");
  });

  it("decodes base64-only file output", async () => {
    const original = new Uint8Array([1, 2, 3, 4]);
    const base64 = Buffer.from(original).toString("base64");
    mockedGenerateText.mockResolvedValue({
      files: [{ base64, mediaType: "image/png" }],
      text: "",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    } as never);

    const result = await generateBrandImageBytes({ aspectRatio: "1:1", prompt: "x" });
    expect([...result]).toEqual([1, 2, 3, 4]);
  });

  it("throws when no file is returned", async () => {
    mockedGenerateText.mockResolvedValue({
      files: [],
      text: "no image",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    } as never);

    await expect(
      generateBrandImageBytes({ aspectRatio: "1:1", prompt: "x" }),
    ).rejects.toThrow(/no image/iv);
  });
});
