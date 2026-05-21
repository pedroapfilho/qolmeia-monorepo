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
  const org = { id: "org_1" };
  const conversation = { id: "conv_1" };
  return {
    activityLog: { create: vi.fn().mockResolvedValue({ id: "al_test" }) },
    agentInstance: {
      upsert: vi.fn().mockResolvedValue({
        displayName: "Controller",
        id: "ai_test",
        mission: "",
        orgId: "org_1",
        templateSlug: "controller",
      }),
    },
    agentRun: {
      create: vi.fn().mockResolvedValue({
        agentInstanceId: "ai_test",
        costCents: 0,
        id: "run_test",
        startedAt: new Date(),
      }),
      update: vi.fn().mockResolvedValue({
        agentInstanceId: "ai_test",
        costCents: 0,
        id: "run_test",
        startedAt: new Date(),
      }),
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
    organization: {
      create: vi.fn().mockResolvedValue(org),
      findUnique: vi.fn().mockResolvedValue({ agentInstructions: null, businessIdea: null }),
      update: vi.fn().mockResolvedValue({}),
    },
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

  it("creates an AgentRun with the rendered systemPrompt + contextSnapshot before dispatch and finalizes after", async () => {
    const prisma = makePrisma();
    // Capture the persisted Message id so we can assert it lands on the run.
    (prisma as never as { message: { create: ReturnType<typeof vi.fn> } }).message.create = vi
      .fn()
      .mockResolvedValue({ id: "m_persisted_1" });

    const deps = makeDeps({
      getBusinessContext: vi.fn().mockResolvedValue("BUSINESS-CTX-MD"),
      prisma,
    });
    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "sou um salão" }));

    const create = (prisma as never as { agentRun: { create: ReturnType<typeof vi.fn> } }).agentRun
      .create;
    const update = (prisma as never as { agentRun: { update: ReturnType<typeof vi.fn> } }).agentRun
      .update;

    expect(create).toHaveBeenCalledOnce();
    const createArgs = create.mock.calls[0]![0] as {
      data: {
        agentInstanceId: string;
        contextSnapshot: { businessContext: string };
        parentRunId: string | null;
        systemPrompt: string;
        triggerMessageId: string | null;
      };
    };
    expect(createArgs.data.agentInstanceId).toBe("ai_test");
    expect(createArgs.data.triggerMessageId).toBe("m_persisted_1");
    expect(createArgs.data.parentRunId).toBeNull();
    expect(createArgs.data.contextSnapshot.businessContext).toBe("BUSINESS-CTX-MD");
    expect(createArgs.data.systemPrompt).toContain("BUSINESS-CTX-MD");

    // Dispatch happens AFTER the run row is created, then the run is
    // finalized as SUCCEEDED.
    const dispatcher = deps.dispatcher as ReturnType<typeof makeDispatcher>;
    expect(dispatcher.enqueueAndAwait).toHaveBeenCalledOnce();
    const dispatchArg = dispatcher.enqueueAndAwait.mock.calls[0]![0] as {
      runId: string;
      systemPrompt: string;
    };
    expect(dispatchArg.runId).toBe("run_test");
    expect(dispatchArg.systemPrompt).toBe(createArgs.data.systemPrompt);

    expect(update).toHaveBeenCalledOnce();
    const updateArgs = update.mock.calls[0]![0] as {
      data: { status: string };
      where: { id: string };
    };
    expect(updateArgs.where.id).toBe("run_test");
    expect(updateArgs.data.status).toBe("SUCCEEDED");
  });

  it("finalizes the AgentRun as FAILED when the dispatcher throws", async () => {
    const prisma = makePrisma();
    const dispatcher = makeDispatcher(vi.fn().mockRejectedValue(new Error("agent failed")));
    const deps = makeDeps({ dispatcher, prisma });
    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "olá" }));

    const update = (prisma as never as { agentRun: { update: ReturnType<typeof vi.fn> } }).agentRun
      .update;
    expect(update).toHaveBeenCalledOnce();
    const updateArgs = update.mock.calls[0]![0] as {
      data: { errorMessage: string | null; status: string };
    };
    expect(updateArgs.data.status).toBe("FAILED");
    expect(updateArgs.data.errorMessage).toBe("agent failed");
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
      id: "ci_1",
      orgId: "org_ci",
      senderRole: "OWNER",
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

  it("handles /instrucoes <text> by updating the org and posting the confirmation (no dispatch)", async () => {
    const prisma = makePrisma();
    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleInboundMessage(
      deps,
      thread,
      makeMessage({ text: "/instrucoes Sempre responda em pt-BR." }),
    );

    expect(
      (prisma as never as { organization: { update: ReturnType<typeof vi.fn> } }).organization
        .update,
    ).toHaveBeenCalledWith({
      data: { agentInstructions: "Sempre responda em pt-BR." },
      where: { id: "org_1" },
    });
    expect(
      (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait,
    ).not.toHaveBeenCalled();
    expect(thread.post).toHaveBeenCalledWith("Instruções atualizadas.");
  });

  it("handles bare /ideia by reading the current value (no dispatch)", async () => {
    const prisma = makePrisma();
    (
      prisma as never as { organization: { findUnique: ReturnType<typeof vi.fn> } }
    ).organization.findUnique.mockResolvedValue({ businessIdea: "Salão em SP." });
    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "/ideia" }));

    expect(
      (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait,
    ).not.toHaveBeenCalled();
    expect(thread.post).toHaveBeenCalledWith("Salão em SP.");
    expect(
      (prisma as never as { organization: { update: ReturnType<typeof vi.fn> } }).organization
        .update,
    ).not.toHaveBeenCalled();
  });

  it("does NOT trigger owner-command handling on regular text", async () => {
    const prisma = makePrisma();
    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "oi, sou um salão" }));

    expect(
      (prisma as never as { organization: { update: ReturnType<typeof vi.fn> } }).organization
        .update,
    ).not.toHaveBeenCalled();
    expect(
      (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait,
    ).toHaveBeenCalledOnce();
    expect(thread.post).toHaveBeenCalledWith("Anotei!");
  });

  it("ignores owner commands when senderRole is CUSTOMER (dispatches to agent instead)", async () => {
    const prisma = makePrisma();
    (
      prisma as never as { connectorInstance: { findFirst: ReturnType<typeof vi.fn> } }
    ).connectorInstance.findFirst.mockResolvedValue({
      id: "ci_cust",
      orgId: "org_cust",
      senderRole: "CUSTOMER",
    });
    (
      prisma as never as { conversation: { findFirst: ReturnType<typeof vi.fn> } }
    ).conversation.findFirst.mockResolvedValue({ id: "conv_cust" });

    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "/instrucoes nope" }));

    expect(
      (prisma as never as { organization: { update: ReturnType<typeof vi.fn> } }).organization
        .update,
    ).not.toHaveBeenCalled();
    expect(
      (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait,
    ).toHaveBeenCalledOnce();
  });

  it("emits MESSAGE_INBOUND, AGENT_RUN_STARTED, AGENT_RUN_FINISHED, MESSAGE_OUTBOUND ActivityLog rows in order", async () => {
    const prisma = makePrisma();
    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "olá" }));

    const activityCreate = (
      prisma as never as { activityLog: { create: ReturnType<typeof vi.fn> } }
    ).activityLog.create;
    const types = activityCreate.mock.calls.map(
      (c) => (c[0] as { data: { type: string } }).data.type,
    );
    expect(types).toEqual([
      "MESSAGE_INBOUND",
      "AGENT_RUN_STARTED",
      "AGENT_RUN_FINISHED",
      "MESSAGE_OUTBOUND",
    ]);
  });

  it("emits AGENT_RUN_FAILED ActivityLog when the dispatcher throws", async () => {
    const prisma = makePrisma();
    const dispatcher = makeDispatcher(vi.fn().mockRejectedValue(new Error("agent failed")));
    const deps = makeDeps({ dispatcher, prisma });
    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "olá" }));

    const activityCreate = (
      prisma as never as { activityLog: { create: ReturnType<typeof vi.fn> } }
    ).activityLog.create;
    const types = activityCreate.mock.calls.map(
      (c) => (c[0] as { data: { type: string } }).data.type,
    );
    expect(types).toContain("MESSAGE_INBOUND");
    expect(types).toContain("AGENT_RUN_STARTED");
    expect(types).toContain("AGENT_RUN_FAILED");
    // MESSAGE_OUTBOUND should NOT fire when the run failed.
    expect(types).not.toContain("MESSAGE_OUTBOUND");
  });

  it("emits OWNER_COMMAND + INSTRUCTIONS_UPDATED ActivityLog rows for /instrucoes <text>", async () => {
    const prisma = makePrisma();
    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleInboundMessage(
      deps,
      thread,
      makeMessage({ text: "/instrucoes Sempre responda em pt-BR." }),
    );

    const activityCreate = (
      prisma as never as { activityLog: { create: ReturnType<typeof vi.fn> } }
    ).activityLog.create;
    const types = activityCreate.mock.calls.map(
      (c) => (c[0] as { data: { type: string } }).data.type,
    );
    expect(types).toEqual(["OWNER_COMMAND", "INSTRUCTIONS_UPDATED"]);
  });

  it("emits OWNER_COMMAND + BUSINESS_IDEA_UPDATED ActivityLog rows for /ideia <text>", async () => {
    const prisma = makePrisma();
    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "/ideia Salão premium em SP." }));

    const activityCreate = (
      prisma as never as { activityLog: { create: ReturnType<typeof vi.fn> } }
    ).activityLog.create;
    const types = activityCreate.mock.calls.map(
      (c) => (c[0] as { data: { type: string } }).data.type,
    );
    expect(types).toEqual(["OWNER_COMMAND", "BUSINESS_IDEA_UPDATED"]);
  });

  it("threads senderRole=OWNER from the legacy TelegramLink path into AgentDispatchArgs", async () => {
    const prisma = makePrisma();
    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "olá" }));

    const call = (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait.mock
      .calls[0]![0] as { senderRole: "CUSTOMER" | "OWNER" | null };
    expect(call.senderRole).toBe("OWNER");
  });

  it("threads senderRole=CUSTOMER when the resolving ConnectorInstance is customer-side", async () => {
    const prisma = makePrisma();
    (
      prisma as never as { connectorInstance: { findFirst: ReturnType<typeof vi.fn> } }
    ).connectorInstance.findFirst.mockResolvedValue({
      id: "ci_cust",
      orgId: "org_cust",
      senderRole: "CUSTOMER",
    });
    (
      prisma as never as { conversation: { findFirst: ReturnType<typeof vi.fn> } }
    ).conversation.findFirst.mockResolvedValue({ id: "conv_cust" });
    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "oi" }));

    const call = (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait.mock
      .calls[0]![0] as { senderRole: "CUSTOMER" | "OWNER" | null };
    expect(call.senderRole).toBe("CUSTOMER");
  });

  it("emits OWNER_COMMAND but no UPDATED row when reading bare /ideia", async () => {
    const prisma = makePrisma();
    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleInboundMessage(deps, thread, makeMessage({ text: "/ideia" }));

    const activityCreate = (
      prisma as never as { activityLog: { create: ReturnType<typeof vi.fn> } }
    ).activityLog.create;
    const types = activityCreate.mock.calls.map(
      (c) => (c[0] as { data: { type: string } }).data.type,
    );
    expect(types).toEqual(["OWNER_COMMAND"]);
  });
});
