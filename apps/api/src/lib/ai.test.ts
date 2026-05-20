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
  it("calls generateText with three tools + stopWhen + system prompt + user content parts", async () => {
    generateTextMock.mockResolvedValue({
      text: "Recebi sua logo! Cores principais: #112233.",
      toolCalls: [],
      toolResults: [],
      usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
    } as never);

    const prisma = { brandAsset: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() } } as never;

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
    expect(Object.keys(args.tools).toSorted()).toEqual(["extractSoul", "generateBrandImage", "labelBrandAsset"]);
    expect(args.system).toContain("Você é um assistente onboarding");
    expect(args.system).toContain("asset_1");
    expect(args.system).toContain("whatYouDo: salão");
    const userContent = args.messages[0]!.content;
    expect(userContent.some((p) => p.type === "text" && p.text === "Aqui está minha logo")).toBe(true);
    expect(userContent.some((p) => p.type === "file" && p.mediaType === "image/jpeg")).toBe(true);
    expect(result.text).toBe("Recebi sua logo! Cores principais: #112233.");
    expect(result.usage.inputTokens).toBe(50);
    expect(result.generatedAssetIds).toEqual([]);
    expect(result.toolCallSummary.generateBrandImage).toBe(0);
  });

  it("counts toolCalls across all agent steps in toolCallSummary", async () => {
    generateTextMock.mockResolvedValue({
      steps: [
        {
          content: [
            { toolName: "extractSoul", type: "tool-call" },
            { toolName: "labelBrandAsset", type: "tool-call" },
          ],
        },
        {
          content: [{ toolName: "labelBrandAsset", type: "tool-call" }],
        },
      ],
      text: "Done.",
      toolCalls: [],
      toolResults: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    } as never);

    const prisma = { brandAsset: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() } } as never;

    const result = await runAgent({
      currentContext: "",
      existingAssets: [],
      input: { audioBytes: undefined, audioMime: undefined, imageBytes: [], text: "oi" },
      newAssets: [],
      orgId: "org_1",
      oversizeCount: 0,
      prisma,
    });

    // 1 extractSoul + 2 labelBrandAsset (1 in step 1, 1 in step 2)
    expect(result.toolCallSummary).toEqual({ extractSoul: 1, generateBrandImage: 0, labelBrandAsset: 2 });
  });

  it("when generateBrandImage tool is called in an earlier step, generatedAssetIds collects the asset ids", async () => {
    // AI SDK v6: result.toolCalls/toolResults only show the LAST step; we
    // walk result.steps for the true total. Model called the tool in step 1,
    // then produced text in step 2.
    generateTextMock.mockResolvedValue({
      files: [],
      steps: [
        {
          content: [
            { toolName: "generateBrandImage", type: "tool-call" },
            { output: { assetId: "asset_gen_1", ok: true }, toolName: "generateBrandImage", type: "tool-result" },
          ],
        },
        { content: [] },
      ],
      text: "Pronto! Gerei a imagem.",
      toolCalls: [],
      toolResults: [],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    } as never);

    const prisma = {
      brandAsset: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    } as never;

    const result = await runAgent({
      currentContext: "",
      existingAssets: [],
      input: { audioBytes: undefined, audioMime: undefined, imageBytes: [], text: "gera uma imagem" },
      newAssets: [],
      orgId: "org_1",
      oversizeCount: 0,
      prisma,
    });

    expect(result.generatedAssetIds).toEqual(["asset_gen_1"]);
    expect(result.toolCallSummary.generateBrandImage).toBe(1);
  });
});
