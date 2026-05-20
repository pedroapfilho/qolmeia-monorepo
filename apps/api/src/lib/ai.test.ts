import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  gateway: vi.fn(() => ({})),
  generateText: vi.fn(),
  stepCountIs: vi.fn((n: number) => ({ steps: n })),
  tool: vi.fn((t: unknown) => t),
}));

// vi.mock must precede import of module under test
import { generateText } from "ai";

import { runAgent } from "./ai";

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
