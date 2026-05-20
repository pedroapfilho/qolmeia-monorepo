import { describe, expect, it, vi } from "vitest";

import { handleIncomingMessage, type HandlerDeps } from "./handler";

const makeThread = () => ({ id: "tg_chat_42", post: vi.fn().mockResolvedValue(undefined) });

const makeMessage = (
  over: Partial<{
    attachments: Array<{ fetchData?: () => Promise<Uint8Array>; mimeType?: string; name?: string }>;
    id: string;
    text: string;
  }> = {},
) => ({
  attachments: over.attachments ?? [],
  id: over.id ?? "msg_1",
  text: over.text ?? "olá",
});

const makePrisma = () => {
  const org = { id: "org_1" };
  const conversation = { id: "conv_1" };
  return {
    agentInstance: {
      upsert: vi.fn().mockResolvedValue({
        displayName: "Designer",
        enabledSkillIds: null,
        id: "ai_test",
        mission: "",
        orgId: "org_1",
        templateSlug: "designer",
      }),
    },
    brandAsset: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    conversation: {
      create: vi.fn().mockResolvedValue(conversation),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    message: { create: vi.fn().mockResolvedValue({ id: "m_1" }) },
    organization: { create: vi.fn().mockResolvedValue(org) },
    telegramLink: { findUnique: vi.fn().mockResolvedValue(null) },
    webhookEvent: {
      create: vi.fn().mockResolvedValue({ id: "wh_1" }),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  } as never;
};

const makeDispatcher = (
  enqueueAndAwait = vi.fn().mockResolvedValue({
    generatedAssetIds: [],
    text: "Anotei!",
    toolCallSummary: { extractSoul: 1, generateBrandImage: 0, labelBrandAsset: 0 },
    usage: { inputTokens: 1, outputTokens: 1 },
  }),
) => ({ enqueueAndAwait });

const makeDeps = (
  over: Partial<{
    dispatcher: ReturnType<typeof makeDispatcher>;
    fetchAsset: ReturnType<typeof vi.fn>;
    getBusinessContext: ReturnType<typeof vi.fn>;
    ingestBrandAsset: ReturnType<typeof vi.fn>;
    prisma: ReturnType<typeof makePrisma>;
  }> = {},
): HandlerDeps => {
  const prisma = over.prisma ?? makePrisma();
  return {
    dispatcher: (over.dispatcher ?? makeDispatcher()) as unknown as HandlerDeps["dispatcher"],
    fetchAsset: over.fetchAsset as unknown as HandlerDeps["fetchAsset"],
    getBusinessContext: (over.getBusinessContext ??
      vi.fn().mockResolvedValue("")) as unknown as HandlerDeps["getBusinessContext"],
    ingestBrandAsset: (over.ingestBrandAsset ??
      vi
        .fn()
        .mockImplementation((a: { mimeType: string }) =>
          Promise.resolve({ assetId: `asset_${a.mimeType}`, deduped: false }),
        )) as unknown as HandlerDeps["ingestBrandAsset"],
    prisma: prisma as unknown as HandlerDeps["prisma"],
  };
};

describe("handleIncomingMessage", () => {
  it("creates org+conversation+message and posts the agent's text on text input", async () => {
    const deps = makeDeps();
    const thread = makeThread();

    await handleIncomingMessage(deps, thread, makeMessage({ text: "sou um salão" }));

    expect(
      (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait,
    ).toHaveBeenCalledOnce();
    expect(thread.post).toHaveBeenCalledWith("Anotei!");
  });

  it("is idempotent — duplicate message id is a no-op", async () => {
    const prisma = makePrisma();
    (
      prisma as never as { webhookEvent: { findUnique: ReturnType<typeof vi.fn> } }
    ).webhookEvent.findUnique.mockResolvedValue({ id: "wh_1" });
    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleIncomingMessage(deps, thread, makeMessage());

    expect(
      (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait,
    ).not.toHaveBeenCalled();
    expect(thread.post).not.toHaveBeenCalled();
  });

  it("downloads audio attachments and forwards bytes to the dispatcher", async () => {
    const bytes = new Uint8Array([7, 7, 7]);
    const fetchData = vi.fn().mockResolvedValue(bytes);
    const deps = makeDeps();
    const thread = makeThread();

    await handleIncomingMessage(
      deps,
      thread,
      makeMessage({
        attachments: [{ fetchData, mimeType: "audio/ogg", name: "voice.ogg" }],
        text: "",
      }),
    );

    expect(fetchData).toHaveBeenCalledOnce();
    const call = (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait.mock
      .calls[0]![0] as { input: { audioBytes?: Uint8Array; audioMime?: string } };
    expect(call.input.audioBytes).toBe(bytes);
    expect(call.input.audioMime).toBe("audio/ogg");
  });

  it("ingests image attachments and passes new assets + image bytes to the dispatcher", async () => {
    const imageBytes = new Uint8Array([1, 2, 3]);
    const fetchData = vi.fn().mockResolvedValue(imageBytes);
    const ingestBrandAsset = vi.fn().mockResolvedValue({ assetId: "asset_logo", deduped: false });
    const deps = makeDeps({ ingestBrandAsset });
    const thread = makeThread();

    await handleIncomingMessage(
      deps,
      thread,
      makeMessage({
        attachments: [{ fetchData, mimeType: "image/png", name: "logo.png" }],
        text: "minha logo",
      }),
    );

    expect(fetchData).toHaveBeenCalledOnce();
    expect(ingestBrandAsset).toHaveBeenCalledWith(
      expect.objectContaining({ bytes: imageBytes, mimeType: "image/png", orgId: "org_1" }),
    );
    const call = (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait.mock
      .calls[0]![0] as {
      input: { imageBytes: Array<{ assetId: string; bytes: Uint8Array; mimeType: string }> };
      newAssets: Array<{ assetId: string; deduped: boolean; mimeType: string }>;
    };
    expect(call.newAssets).toEqual([
      { assetId: "asset_logo", deduped: false, mimeType: "image/png" },
    ]);
    expect(call.input.imageBytes).toEqual([
      { assetId: "asset_logo", bytes: imageBytes, mimeType: "image/png" },
    ]);
  });

  it("on dedup hit does NOT include bytes in input.imageBytes but does flag in newAssets", async () => {
    const bytes = new Uint8Array([5]);
    const fetchData = vi.fn().mockResolvedValue(bytes);
    const ingestBrandAsset = vi
      .fn()
      .mockResolvedValue({ assetId: "asset_existing", deduped: true });
    const deps = makeDeps({ ingestBrandAsset });
    const thread = makeThread();

    await handleIncomingMessage(
      deps,
      thread,
      makeMessage({
        attachments: [{ fetchData, mimeType: "image/jpeg" }],
        text: "",
      }),
    );

    const call = (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait.mock
      .calls[0]![0] as {
      input: { imageBytes: Array<unknown> };
      newAssets: Array<{ deduped: boolean }>;
    };
    expect(call.newAssets[0]!.deduped).toBe(true);
    expect(call.input.imageBytes).toEqual([]);
  });

  it("skips images larger than 20MB and reports oversizeCount", async () => {
    const bigBytes = new Uint8Array(21_000_000);
    const fetchData = vi.fn().mockResolvedValue(bigBytes);
    const ingestBrandAsset = vi.fn();
    const deps = makeDeps({ ingestBrandAsset });
    const thread = makeThread();

    await handleIncomingMessage(
      deps,
      thread,
      makeMessage({
        attachments: [{ fetchData, mimeType: "image/jpeg" }],
        text: "logo gigante",
      }),
    );

    expect(ingestBrandAsset).not.toHaveBeenCalled();
    const call = (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait.mock
      .calls[0]![0] as { oversizeCount: number };
    expect(call.oversizeCount).toBe(1);
  });

  it("replies with the empty-text static when message is whitespace + no attachments", async () => {
    const dispatcher = makeDispatcher();
    const deps = makeDeps({ dispatcher, ingestBrandAsset: vi.fn() });
    const thread = makeThread();

    await handleIncomingMessage(deps, thread, makeMessage({ text: "   " }));

    expect(dispatcher.enqueueAndAwait).not.toHaveBeenCalled();
    expect(thread.post).toHaveBeenCalledWith(
      "Recebi sua mensagem, mas não entendi. Pode tentar de novo?",
    );
  });

  it("apologises when audio download fails", async () => {
    const deps = makeDeps();
    const thread = makeThread();

    await handleIncomingMessage(
      deps,
      thread,
      makeMessage({
        attachments: [
          { fetchData: () => Promise.reject(new Error("boom")), mimeType: "audio/ogg" },
        ],
        text: "",
      }),
    );

    expect(
      (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait,
    ).not.toHaveBeenCalled();
    expect(thread.post).toHaveBeenCalledWith("Não consegui baixar seu áudio, pode reenviar?");
  });

  it("apologises when dispatcher throws (top-level catch)", async () => {
    const dispatcher = makeDispatcher(vi.fn().mockRejectedValue(new Error("agent failed")));
    const deps = makeDeps({ dispatcher });
    const thread = makeThread();

    await handleIncomingMessage(deps, thread, makeMessage({ text: "olá" }));

    expect(thread.post).toHaveBeenCalledWith(
      "Tive um problema processando sua mensagem, pode tentar de novo?",
    );
  });

  it("posts generated image via thread.post({ files, markdown }) when dispatcher returns generatedAssetIds", async () => {
    const generatedBytes = new Uint8Array([99, 98, 97]);
    const fetchAssetMock = vi.fn().mockResolvedValue(generatedBytes);

    const prisma = makePrisma();
    (
      prisma as never as {
        brandAsset: { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
      }
    ).brandAsset = {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ mimeType: "image/png", r2Key: "org_1/gen.png" }),
    };

    const deps: HandlerDeps = {
      dispatcher: makeDispatcher(
        vi.fn().mockResolvedValue({
          generatedAssetIds: ["asset_gen_1"],
          text: "Pronto, gerei a imagem!",
          toolCallSummary: { extractSoul: 0, generateBrandImage: 1, labelBrandAsset: 0 },
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      ) as unknown as HandlerDeps["dispatcher"],
      fetchAsset: fetchAssetMock as unknown as HandlerDeps["fetchAsset"],
      getBusinessContext: vi.fn().mockResolvedValue("") as never,
      ingestBrandAsset: vi.fn() as never,
      prisma: prisma as never,
    };

    const thread = makeThread();

    await handleIncomingMessage(deps, thread, makeMessage({ text: "gera uma imagem" }));

    expect(fetchAssetMock).toHaveBeenCalledWith("org_1/gen.png");
    expect(thread.post).toHaveBeenCalledOnce();
    expect(thread.post).toHaveBeenCalledWith({
      files: [
        {
          data: Buffer.from(generatedBytes),
          filename: "qolmeia-asset_gen_1.png",
          mimeType: "image/png",
        },
      ],
      markdown: "Pronto, gerei a imagem!",
    });
  });
});
