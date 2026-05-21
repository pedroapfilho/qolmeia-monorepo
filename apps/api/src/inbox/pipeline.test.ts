import { describe, expect, it, vi } from "vitest";

import { handleInboundMessage, type PipelineDeps } from "./pipeline";

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
  const agentInstance = {
    displayName: "Controller",
    enabledSkillIds: null,
    id: "ai_test",
    mission: "",
    orgId: "org_1",
    templateSlug: "controller",
  };
  const org = { connectorInstances: [{ id: "ci_new" }], id: "org_1" };
  const conversation = { id: "conv_1" };
  return {
    agentConnectorBinding: {
      // Default to one binding (Controller) so routing succeeds for tests
      // that exercise the binding-driven inbound path.
      findMany: vi.fn().mockResolvedValue([
        {
          agentInstance,
          agentInstanceId: agentInstance.id,
          connectorInstanceId: "ci_new",
          direction: "INBOUND",
          id: "binding_test",
        },
      ]),
      upsert: vi.fn().mockResolvedValue({ id: "binding_test" }),
    },
    agentInstance: {
      upsert: vi.fn().mockResolvedValue(agentInstance),
    },
    brandAsset: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    connectorInstance: { findFirst: vi.fn().mockResolvedValue(null) },
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
): PipelineDeps => {
  const prisma = over.prisma ?? makePrisma();
  return {
    dispatcher: (over.dispatcher ?? makeDispatcher()) as unknown as PipelineDeps["dispatcher"],
    fetchAsset: over.fetchAsset as unknown as PipelineDeps["fetchAsset"],
    getBusinessContext: (over.getBusinessContext ??
      vi.fn().mockResolvedValue("")) as unknown as PipelineDeps["getBusinessContext"],
    ingestBrandAsset: (over.ingestBrandAsset ??
      vi
        .fn()
        .mockImplementation((a: { mimeType: string }) =>
          Promise.resolve({ assetId: `asset_${a.mimeType}`, deduped: false }),
        )) as unknown as PipelineDeps["ingestBrandAsset"],
    prisma: prisma as unknown as PipelineDeps["prisma"],
  };
};

describe("handleInboundMessage", () => {
  it("creates org+conversation+message and posts the agent's text on text input", async () => {
    const deps = makeDeps();
    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "sou um salão" }));

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

    await handleInboundMessage(deps, thread, makeMessage());

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

    await handleInboundMessage(
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

    await handleInboundMessage(
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

    await handleInboundMessage(
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

    await handleInboundMessage(
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

    await handleInboundMessage(deps, thread, makeMessage({ text: "   " }));

    expect(dispatcher.enqueueAndAwait).not.toHaveBeenCalled();
    expect(thread.post).toHaveBeenCalledWith(
      "Recebi sua mensagem, mas não entendi. Pode tentar de novo?",
    );
  });

  it("apologises when audio download fails", async () => {
    const deps = makeDeps();
    const thread = makeThread();

    await handleInboundMessage(
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

    await handleInboundMessage(deps, thread, makeMessage({ text: "olá" }));

    expect(thread.post).toHaveBeenCalledWith(
      "Tive um problema processando sua mensagem, pode tentar de novo?",
    );
  });

  it("uses ConnectorInstance.config.chatId lookup when available, bypassing TelegramLink", async () => {
    const prisma = makePrisma();
    // ConnectorInstance match found — TelegramLink should never be consulted.
    (
      prisma as never as { connectorInstance: { findFirst: ReturnType<typeof vi.fn> } }
    ).connectorInstance.findFirst.mockResolvedValue({
      bindings: [{ id: "binding_ci_1" }],
      id: "ci_1",
      orgId: "org_ci",
    });
    // Conversation already exists for the connector.
    (
      prisma as never as { conversation: { findFirst: ReturnType<typeof vi.fn> } }
    ).conversation.findFirst.mockResolvedValue({ id: "conv_ci" });

    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "olá via connector" }));

    expect(
      (prisma as never as { telegramLink: { findUnique: ReturnType<typeof vi.fn> } }).telegramLink
        .findUnique,
    ).not.toHaveBeenCalled();
    expect(
      (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait,
    ).toHaveBeenCalledOnce();
    expect(thread.post).toHaveBeenCalledWith("Anotei!");
  });

  it("routes inbound via AgentConnectorBinding lookup (not a hardcoded controller slug)", async () => {
    const prisma = makePrisma();
    // ConnectorInstance match found — should drive the binding query.
    (
      prisma as never as { connectorInstance: { findFirst: ReturnType<typeof vi.fn> } }
    ).connectorInstance.findFirst.mockResolvedValue({
      bindings: [{ id: "binding_existing" }],
      id: "ci_existing",
      orgId: "org_ci",
    });
    (
      prisma as never as { conversation: { findFirst: ReturnType<typeof vi.fn> } }
    ).conversation.findFirst.mockResolvedValue({ id: "conv_ci" });

    // The binding lookup returns the Controller agent for this connector.
    const boundAgent = {
      displayName: "Custom Controller",
      enabledSkillIds: null,
      id: "ai_bound",
      mission: "",
      orgId: "org_ci",
      templateSlug: "controller",
    };
    const bindingFindMany = vi.fn().mockResolvedValue([
      {
        agentInstance: boundAgent,
        agentInstanceId: boundAgent.id,
        connectorInstanceId: "ci_existing",
        direction: "INBOUND",
        id: "binding_existing",
      },
    ]);
    (
      prisma as never as { agentConnectorBinding: { findMany: ReturnType<typeof vi.fn> } }
    ).agentConnectorBinding.findMany = bindingFindMany;

    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "olá" }));

    expect(bindingFindMany).toHaveBeenCalledWith({
      include: { agentInstance: true },
      where: { connectorInstanceId: "ci_existing", direction: { in: ["INBOUND", "BOTH"] } },
    });
    const call = (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait.mock
      .calls[0]![0] as { agentInstance: { id: string } };
    expect(call.agentInstance.id).toBe("ai_bound");
  });

  it("seeds the Controller INBOUND binding on first contact (lazy ConnectorInstance creation)", async () => {
    const prisma = makePrisma();
    // No existing ConnectorInstance and no TelegramLink — first contact path.
    (
      prisma as never as { connectorInstance: { findFirst: ReturnType<typeof vi.fn> } }
    ).connectorInstance.findFirst.mockResolvedValue(null);
    (
      prisma as never as { telegramLink: { findUnique: ReturnType<typeof vi.fn> } }
    ).telegramLink.findUnique.mockResolvedValue(null);

    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "primeira mensagem" }));

    const bindingUpsert = (
      prisma as never as { agentConnectorBinding: { upsert: ReturnType<typeof vi.fn> } }
    ).agentConnectorBinding.upsert;
    expect(bindingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          connectorInstanceId: "ci_new",
          direction: "INBOUND",
        }),
      }),
    );
  });

  it("backfills the INBOUND binding when an existing ConnectorInstance lacks one", async () => {
    const prisma = makePrisma();
    (
      prisma as never as { connectorInstance: { findFirst: ReturnType<typeof vi.fn> } }
    ).connectorInstance.findFirst.mockResolvedValue({
      bindings: [],
      id: "ci_legacy",
      orgId: "org_legacy",
    });
    (
      prisma as never as { conversation: { findFirst: ReturnType<typeof vi.fn> } }
    ).conversation.findFirst.mockResolvedValue({ id: "conv_legacy" });

    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "msg" }));

    const bindingUpsert = (
      prisma as never as { agentConnectorBinding: { upsert: ReturnType<typeof vi.fn> } }
    ).agentConnectorBinding.upsert;
    expect(bindingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          connectorInstanceId: "ci_legacy",
          direction: "INBOUND",
        }),
      }),
    );
  });

  it("skips the INBOUND binding backfill when the ConnectorInstance already has bindings", async () => {
    const prisma = makePrisma();
    (
      prisma as never as { connectorInstance: { findFirst: ReturnType<typeof vi.fn> } }
    ).connectorInstance.findFirst.mockResolvedValue({
      bindings: [{ id: "binding_existing" }],
      id: "ci_bound",
      orgId: "org_bound",
    });
    (
      prisma as never as { conversation: { findFirst: ReturnType<typeof vi.fn> } }
    ).conversation.findFirst.mockResolvedValue({ id: "conv_bound" });

    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "msg" }));

    const bindingUpsert = (
      prisma as never as { agentConnectorBinding: { upsert: ReturnType<typeof vi.fn> } }
    ).agentConnectorBinding.upsert;
    const agentInstanceUpsert = (
      prisma as never as { agentInstance: { upsert: ReturnType<typeof vi.fn> } }
    ).agentInstance.upsert;
    expect(bindingUpsert).not.toHaveBeenCalled();
    expect(agentInstanceUpsert).not.toHaveBeenCalled();
    expect(
      (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait,
    ).toHaveBeenCalledOnce();
  });

  it("posts the failure reply when the inbound binding lookup returns zero rows", async () => {
    const prisma = makePrisma();
    (
      prisma as never as { connectorInstance: { findFirst: ReturnType<typeof vi.fn> } }
    ).connectorInstance.findFirst.mockResolvedValue({
      bindings: [],
      id: "ci_orphan",
      orgId: "org_orphan",
    });
    (
      prisma as never as { conversation: { findFirst: ReturnType<typeof vi.fn> } }
    ).conversation.findFirst.mockResolvedValue({ id: "conv_orphan" });
    // Backfill upsert succeeds, but findMany returns empty (simulating a
    // race or misconfiguration where the upsert path is bypassed).
    (
      prisma as never as { agentConnectorBinding: { findMany: ReturnType<typeof vi.fn> } }
    ).agentConnectorBinding.findMany.mockResolvedValue([]);

    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "olá" }));

    expect(
      (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait,
    ).not.toHaveBeenCalled();
    expect(thread.post).toHaveBeenCalledWith(
      "Tive um problema processando sua mensagem, pode tentar de novo?",
    );
  });

  it("posts the failure reply when multiple INBOUND bindings exist for the same connector", async () => {
    const prisma = makePrisma();
    (
      prisma as never as { connectorInstance: { findFirst: ReturnType<typeof vi.fn> } }
    ).connectorInstance.findFirst.mockResolvedValue({
      bindings: [{ id: "binding_dup" }],
      id: "ci_dup",
      orgId: "org_dup",
    });
    (
      prisma as never as { conversation: { findFirst: ReturnType<typeof vi.fn> } }
    ).conversation.findFirst.mockResolvedValue({ id: "conv_dup" });
    (
      prisma as never as { agentConnectorBinding: { findMany: ReturnType<typeof vi.fn> } }
    ).agentConnectorBinding.findMany.mockResolvedValue([
      {
        agentInstance: { id: "ai_a", templateSlug: "controller" },
        agentInstanceId: "ai_a",
        connectorInstanceId: "ci_dup",
        direction: "INBOUND",
        id: "b_a",
      },
      {
        agentInstance: { id: "ai_b", templateSlug: "designer" },
        agentInstanceId: "ai_b",
        connectorInstanceId: "ci_dup",
        direction: "BOTH",
        id: "b_b",
      },
    ]);

    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "olá" }));

    expect(
      (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait,
    ).not.toHaveBeenCalled();
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

    const deps: PipelineDeps = {
      dispatcher: makeDispatcher(
        vi.fn().mockResolvedValue({
          generatedAssetIds: ["asset_gen_1"],
          text: "Pronto, gerei a imagem!",
          toolCallSummary: { extractSoul: 0, generateBrandImage: 1, labelBrandAsset: 0 },
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      ) as unknown as PipelineDeps["dispatcher"],
      fetchAsset: fetchAssetMock as unknown as PipelineDeps["fetchAsset"],
      getBusinessContext: vi.fn().mockResolvedValue("") as never,
      ingestBrandAsset: vi.fn() as never,
      prisma: prisma as never,
    };

    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "gera uma imagem" }));

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
