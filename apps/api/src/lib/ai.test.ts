import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  gateway: vi.fn(() => ({})),
  generateObject: vi.fn(),
  generateText: vi.fn(),
  stepCountIs: vi.fn((n: number) => ({ steps: n })),
  tool: vi.fn((t: unknown) => t),
}));

// vi.mock must precede import of module under test
import { generateObject, generateText } from "ai";

import { extractSoul, runAgent, type Input } from "./ai";

const mockedGenerateObject = vi.mocked(generateObject);

const stubGenerate = (partial: unknown, reply: string) => {
  mockedGenerateObject.mockResolvedValue({
    object: { partial, reply },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  } as never);
};

describe("extractSoul", () => {
  it("calls generateObject with the model, schema, system prompt, and text input", async () => {
    stubGenerate(
      {
        brandVoice: null,
        differentiator: null,
        location: null,
        targetAudience: null,
        whatYouDo: "Salão de cabelo",
      },
      "Anotei que vocês são um salão! Qual seu público-alvo?",
    );

    const input: Input = { kind: "text", text: "Sou um salão de cabelo" };
    const result = await extractSoul(input, "(perfil vazio)");

    expect(mockedGenerateObject).toHaveBeenCalledOnce();
    const args = mockedGenerateObject.mock.calls[0]![0] as {
      messages: Array<{ content: Array<{ text?: string; type: string }>; role: string }>;
      system: string;
    };
    expect(args.system).toContain("(perfil vazio)");
    expect(args.system).toContain("Você é um assistente onboarding");
    expect(args.system).toContain("brandVoice");
    expect(args.messages[0]!.role).toBe("user");
    expect(args.messages[0]!.content[0]!.type).toBe("text");
    expect(args.messages[0]!.content[0]!.text).toBe("Sou um salão de cabelo");

    expect(result.partial.whatYouDo).toBe("Salão de cabelo");
    expect(result.reply).toBe("Anotei que vocês são um salão! Qual seu público-alvo?");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
  });

  it("sends audio bytes as a file content part", async () => {
    stubGenerate(
      {
        brandVoice: null,
        differentiator: null,
        location: null,
        targetAudience: null,
        whatYouDo: null,
      },
      "Recebi seu áudio.",
    );
    const bytes = new Uint8Array([1, 2, 3]);

    const result = await extractSoul(
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
    expect(result.reply).toBe("Recebi seu áudio.");
  });
});

const generateTextMock = vi.mocked(generateText as unknown as ReturnType<typeof vi.fn>);

describe("runAgent", () => {
  it("calls generateText with two tools + stopWhen + system prompt + user content parts", async () => {
    generateTextMock.mockResolvedValue({
      text: "Recebi sua logo! Cores principais: #112233.",
      toolCalls: [],
      usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
    } as never);

    const prisma = { brandAsset: { update: vi.fn() } } as never;

    const result = await runAgent({
      currentContext: "# Business Context\n\nwhatYouDo: salão",
      existingAssets: [],
      input: {
        audioBytes: undefined,
        audioMime: undefined,
        imageBytes: [
          { assetId: "asset_1", bytes: new Uint8Array([7, 7]), mimeType: "image/jpeg" },
        ],
        text: "Aqui está minha logo",
      },
      newAssets: [{ assetId: "asset_1", deduped: false, mimeType: "image/jpeg" }],
      orgId: "org_1",
      oversizeCount: 0,
      prisma,
    });

    expect(generateTextMock).toHaveBeenCalledOnce();
    const args = generateTextMock.mock.calls[0]![0] as {
      messages: Array<{ content: Array<{ data?: Uint8Array; mediaType?: string; text?: string; type: string }>; role: string }>;
      system: string;
      tools: Record<string, unknown>;
    };
    expect(Object.keys(args.tools).toSorted()).toEqual(["extractSoul", "labelBrandAsset"]);
    expect(args.system).toContain("Você é um assistente onboarding");
    expect(args.system).toContain("asset_1");
    expect(args.system).toContain("whatYouDo: salão");
    const userContent = args.messages[0]!.content;
    expect(userContent.some((p) => p.type === "text" && p.text === "Aqui está minha logo")).toBe(true);
    expect(userContent.some((p) => p.type === "file" && p.mediaType === "image/jpeg")).toBe(true);
    expect(result.text).toBe("Recebi sua logo! Cores principais: #112233.");
    expect(result.usage.inputTokens).toBe(50);
  });

  it("counts toolCalls in toolCallSummary", async () => {
    generateTextMock.mockResolvedValue({
      text: "Done.",
      toolCalls: [
        { toolName: "extractSoul" },
        { toolName: "labelBrandAsset" },
        { toolName: "labelBrandAsset" },
      ],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    } as never);

    const prisma = { brandAsset: { update: vi.fn() } } as never;

    const result = await runAgent({
      currentContext: "",
      existingAssets: [],
      input: { audioBytes: undefined, audioMime: undefined, imageBytes: [], text: "oi" },
      newAssets: [],
      orgId: "org_1",
      oversizeCount: 0,
      prisma,
    });

    expect(result.toolCallSummary).toEqual({ extractSoul: 1, labelBrandAsset: 2 });
  });
});
