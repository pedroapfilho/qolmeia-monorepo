import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  gateway: vi.fn(() => ({})),
  generateObject: vi.fn(),
}));

// vi.mock must precede import of module under test
import { generateObject } from "ai";

import { extractSoul, type Input } from "./ai";

const mockedGenerateObject = vi.mocked(generateObject);

const stubGenerate = (object: unknown) => {
  mockedGenerateObject.mockResolvedValue({
    object,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  } as never);
};

describe("extractSoul", () => {
  it("calls generateObject with the model, schema, system prompt, and text input", async () => {
    stubGenerate({
      competitors: null,
      contextLinks: null,
      targetAudience: null,
      whatYouDeliver: null,
      whatYouDo: "Salão de cabelo",
    });

    const input: Input = { kind: "text", text: "Sou um salão de cabelo" };
    const result = await extractSoul(input, "(perfil vazio)");

    expect(mockedGenerateObject).toHaveBeenCalledOnce();
    const args = mockedGenerateObject.mock.calls[0]![0] as {
      messages: Array<{ content: Array<{ text?: string; type: string }>; role: string }>;
      system: string;
    };
    expect(args.system).toContain("(perfil vazio)");
    expect(args.system).toContain("não invente");
    expect(args.messages[0]!.role).toBe("user");
    expect(args.messages[0]!.content[0]!.type).toBe("text");
    expect(args.messages[0]!.content[0]!.text).toBe("Sou um salão de cabelo");

    expect(result.partial.whatYouDo).toBe("Salão de cabelo");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
  });

  it("sends audio bytes as a file content part", async () => {
    stubGenerate({
      competitors: null,
      contextLinks: null,
      targetAudience: null,
      whatYouDeliver: null,
      whatYouDo: null,
    });
    const bytes = new Uint8Array([1, 2, 3]);

    await extractSoul(
      { bytes, kind: "audio", mediaType: "audio/ogg" },
      "# Business Context\n\nwhatYouDo: salão",
    );

    const args = mockedGenerateObject.mock.calls.at(-1)![0] as {
      messages: Array<{ content: Array<{ data?: Uint8Array; mediaType?: string; type: string }> }>;
      system: string;
    };
    expect(args.system).toContain("whatYouDo: salão");
    expect(args.messages[0]!.content[0]!.type).toBe("file");
    expect(args.messages[0]!.content[0]!.data).toBe(bytes);
    expect(args.messages[0]!.content[0]!.mediaType).toBe("audio/ogg");
  });
});
