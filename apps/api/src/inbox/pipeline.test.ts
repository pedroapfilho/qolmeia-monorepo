import type { ConnectorInstance } from "@repo/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as ConnectorsRegistry from "../connectors/registry";
import type { NormalizedAttachment, NormalizedMessage } from "../connectors/types";

import { handleInbound, type PipelineDeps } from "./pipeline";

const TELEGRAM_CONFIG = { botToken: "BOT:TOKEN", chatId: "tg_chat_42", secretToken: "secret" };

const buildConnectorInstance = (over: Partial<ConnectorInstance> = {}): ConnectorInstance =>
  ({
    capabilities: { inbound: true, outbound: true } as never,
    config: TELEGRAM_CONFIG as never,
    createdAt: new Date(),
    displayName: "Telegram",
    id: "ci_default",
    orgId: "org_1",
    senderRole: "OWNER",
    type: "TELEGRAM",
    updatedAt: new Date(),
    ...over,
  }) as ConnectorInstance;

const buildNormalizedMessage = (over: Partial<NormalizedMessage> = {}): NormalizedMessage => ({
  attachments: over.attachments ?? [],
  authorDisplayName: over.authorDisplayName ?? null,
  externalId: over.externalId ?? "msg_1",
  externalThreadId: over.externalThreadId ?? "tg_chat_42",
  rawTimestamp: over.rawTimestamp ?? Date.now(),
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
  const conversation = { id: "conv_1" };
  return {
    activityLog: { create: vi.fn().mockResolvedValue({ id: "al_test" }) },
    agentConnectorBinding: {
      findFirst: vi.fn().mockResolvedValue({ id: "binding_test" }),
      // Default to one binding (Controller) so routing succeeds for tests
      // that exercise the binding-driven inbound path.
      findMany: vi.fn().mockResolvedValue([
        {
          agentInstance,
          agentInstanceId: agentInstance.id,
          connectorInstanceId: "ci_default",
          direction: "INBOUND",
          id: "binding_test",
        },
      ]),
      upsert: vi.fn().mockResolvedValue({ id: "binding_test" }),
    },
    agentInstance: {
      upsert: vi.fn().mockResolvedValue(agentInstance),
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
    conversation: {
      create: vi.fn().mockResolvedValue(conversation),
      findFirst: vi.fn().mockResolvedValue(conversation),
    },
    message: { create: vi.fn().mockResolvedValue({ id: "m_1" }) },
    organization: {
      create: vi.fn(),
      findUnique: vi.fn().mockResolvedValue({ agentInstructions: null, businessIdea: null }),
      update: vi.fn().mockResolvedValue({}),
    },
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

// Mocks the adapter registry indirectly: agent-step + pipeline call
// `getAdapter(type).sendOutbound(...)`. Vitest module-level mock below intercepts.
const sendOutboundMock = vi.fn().mockResolvedValue({ externalMessageId: "tg_out_1" });

vi.mock("../connectors/registry", async () => {
  const actual = await vi.importActual<typeof ConnectorsRegistry>("../connectors/registry");
  return {
    ...actual,
    getAdapter: () => ({
      capabilities: { inbound: true, outbound: true },
      parseInboundPayload: vi.fn(),
      sendOutbound: sendOutboundMock,
      type: "TELEGRAM" as const,
      validateConfig: vi.fn().mockReturnValue({ valid: true }),
    }),
  };
});

const makeDeps = (
  over: Partial<{
    dispatcher: ReturnType<typeof makeDispatcher>;
    fetchAsset: ReturnType<typeof vi.fn>;
    fetchAttachmentBytes: ReturnType<typeof vi.fn>;
    getBusinessContext: ReturnType<typeof vi.fn>;
    ingestBrandAsset: ReturnType<typeof vi.fn>;
    prisma: ReturnType<typeof makePrisma>;
  }> = {},
): PipelineDeps => {
  const prisma = over.prisma ?? makePrisma();
  return {
    dispatcher: (over.dispatcher ?? makeDispatcher()) as unknown as PipelineDeps["dispatcher"],
    fetchAsset: over.fetchAsset as unknown as PipelineDeps["fetchAsset"],
    fetchAttachmentBytes:
      over.fetchAttachmentBytes as unknown as PipelineDeps["fetchAttachmentBytes"],
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

describe("handleInbound", () => {
  beforeEach(() => {
    sendOutboundMock.mockClear();
  });

  it("dispatches via the adapter and replies with the agent's text", async () => {
    const deps = makeDeps();

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({ text: "sou um salão" }),
    });

    expect(
      (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait,
    ).toHaveBeenCalledOnce();
    expect(sendOutboundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { text: "Anotei!" },
        threadId: "tg_chat_42",
      }),
    );
  });

  it("creates an AgentRun with the rendered systemPrompt + contextSnapshot before dispatch and finalizes after", async () => {
    const prisma = makePrisma();
    (prisma as never as { message: { create: ReturnType<typeof vi.fn> } }).message.create = vi
      .fn()
      .mockResolvedValue({ id: "m_persisted_1" });

    const deps = makeDeps({
      getBusinessContext: vi.fn().mockResolvedValue("BUSINESS-CTX-MD"),
      prisma,
    });

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({ text: "sou um salão" }),
    });

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

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({ text: "olá" }),
    });

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

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage(),
    });

    expect(
      (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait,
    ).not.toHaveBeenCalled();
    expect(sendOutboundMock).not.toHaveBeenCalled();
  });

  it("downloads audio attachments and forwards bytes to the dispatcher", async () => {
    const bytes = new Uint8Array([7, 7, 7]);
    const fetchAttachmentBytes = vi.fn().mockResolvedValue(bytes);
    const deps = makeDeps({ fetchAttachmentBytes });

    const audioAttachment: NormalizedAttachment = {
      kind: "audio",
      mimeType: "audio/ogg",
      sizeBytes: 1000,
    };

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({
        attachments: [audioAttachment],
        text: "",
      }),
    });

    expect(fetchAttachmentBytes).toHaveBeenCalled();
    const call = (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait.mock
      .calls[0]![0] as { input: { audioBytes?: Uint8Array; audioMime?: string } };
    expect(call.input.audioBytes).toBe(bytes);
    expect(call.input.audioMime).toBe("audio/ogg");
  });

  it("ingests image attachments and passes new assets + image bytes to the dispatcher", async () => {
    const imageBytes = new Uint8Array([1, 2, 3]);
    const fetchAttachmentBytes = vi.fn().mockResolvedValue(imageBytes);
    const ingestBrandAsset = vi.fn().mockResolvedValue({ assetId: "asset_logo", deduped: false });
    const deps = makeDeps({ fetchAttachmentBytes, ingestBrandAsset });

    const imageAttachment: NormalizedAttachment = {
      kind: "image",
      mimeType: "image/png",
      sizeBytes: 3,
    };

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({
        attachments: [imageAttachment],
        text: "minha logo",
      }),
    });

    expect(fetchAttachmentBytes).toHaveBeenCalled();
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
    const fetchAttachmentBytes = vi.fn().mockResolvedValue(bytes);
    const ingestBrandAsset = vi
      .fn()
      .mockResolvedValue({ assetId: "asset_existing", deduped: true });
    const deps = makeDeps({ fetchAttachmentBytes, ingestBrandAsset });

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({
        attachments: [{ kind: "image", mimeType: "image/jpeg", sizeBytes: 1 }],
        text: "",
      }),
    });

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
    const fetchAttachmentBytes = vi.fn().mockResolvedValue(bigBytes);
    const ingestBrandAsset = vi.fn();
    const deps = makeDeps({ fetchAttachmentBytes, ingestBrandAsset });

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({
        attachments: [{ kind: "image", mimeType: "image/jpeg", sizeBytes: 21_000_000 }],
        text: "logo gigante",
      }),
    });

    expect(ingestBrandAsset).not.toHaveBeenCalled();
    const call = (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait.mock
      .calls[0]![0] as { oversizeCount: number };
    expect(call.oversizeCount).toBe(1);
  });

  it("replies with the empty-text static when message is whitespace + no attachments", async () => {
    const dispatcher = makeDispatcher();
    const deps = makeDeps({ dispatcher, ingestBrandAsset: vi.fn() });

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({ text: "   " }),
    });

    expect(dispatcher.enqueueAndAwait).not.toHaveBeenCalled();
    expect(sendOutboundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { text: "Recebi sua mensagem, mas não entendi. Pode tentar de novo?" },
      }),
    );
  });

  it("apologises when audio download fails", async () => {
    const fetchAttachmentBytes = vi.fn().mockRejectedValue(new Error("boom"));
    const deps = makeDeps({ fetchAttachmentBytes });

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({
        attachments: [{ kind: "audio", mimeType: "audio/ogg", sizeBytes: 1000 }],
        text: "",
      }),
    });

    expect(
      (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait,
    ).not.toHaveBeenCalled();
    expect(sendOutboundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { text: "Não consegui baixar seu áudio, pode reenviar?" },
      }),
    );
  });

  it("apologises when dispatcher throws (top-level catch)", async () => {
    const dispatcher = makeDispatcher(vi.fn().mockRejectedValue(new Error("agent failed")));
    const deps = makeDeps({ dispatcher });

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({ text: "olá" }),
    });

    expect(sendOutboundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { text: "Tive um problema processando sua mensagem, pode tentar de novo?" },
      }),
    );
  });

  it("routes inbound via AgentConnectorBinding lookup (not a hardcoded controller slug)", async () => {
    const prisma = makePrisma();
    // The binding lookup returns the Controller agent for this connector.
    const boundAgent = {
      displayName: "Custom Controller",
      enabledSkillIds: null,
      id: "ai_bound",
      mission: "",
      orgId: "org_1",
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

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance({ id: "ci_existing" }),
      normalizedMessage: buildNormalizedMessage({ text: "olá" }),
    });

    expect(bindingFindMany).toHaveBeenCalledWith({
      include: { agentInstance: true },
      where: { connectorInstanceId: "ci_existing", direction: { in: ["INBOUND", "BOTH"] } },
    });
    const call = (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait.mock
      .calls[0]![0] as { agentInstance: { id: string } };
    expect(call.agentInstance.id).toBe("ai_bound");
  });

  it("backfills the INBOUND binding when an existing Telegram ConnectorInstance lacks one", async () => {
    const prisma = makePrisma();
    (
      prisma as never as { agentConnectorBinding: { findFirst: ReturnType<typeof vi.fn> } }
    ).agentConnectorBinding.findFirst.mockResolvedValue(null);

    const deps = makeDeps({ prisma });

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance({ id: "ci_legacy", orgId: "org_legacy" }),
      normalizedMessage: buildNormalizedMessage({ text: "msg" }),
    });

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

    const deps = makeDeps({ prisma });

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance({ id: "ci_bound", orgId: "org_bound" }),
      normalizedMessage: buildNormalizedMessage({ text: "msg" }),
    });

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
      prisma as never as { agentConnectorBinding: { findMany: ReturnType<typeof vi.fn> } }
    ).agentConnectorBinding.findMany.mockResolvedValue([]);

    const deps = makeDeps({ prisma });

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance({ id: "ci_orphan", orgId: "org_orphan" }),
      normalizedMessage: buildNormalizedMessage({ text: "olá" }),
    });

    expect(
      (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait,
    ).not.toHaveBeenCalled();
    expect(sendOutboundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { text: "Tive um problema processando sua mensagem, pode tentar de novo?" },
      }),
    );
  });

  it("posts the failure reply when multiple INBOUND bindings exist for the same connector", async () => {
    const prisma = makePrisma();
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

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance({ id: "ci_dup", orgId: "org_dup" }),
      normalizedMessage: buildNormalizedMessage({ text: "olá" }),
    });

    expect(
      (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait,
    ).not.toHaveBeenCalled();
    expect(sendOutboundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { text: "Tive um problema processando sua mensagem, pode tentar de novo?" },
      }),
    );
  });

  it("posts generated image via adapter.sendOutbound({ files, text }) when dispatcher returns generatedAssetIds", async () => {
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

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({ text: "gera uma imagem" }),
    });

    expect(fetchAssetMock).toHaveBeenCalledWith("org_1/gen.png");
    expect(sendOutboundMock).toHaveBeenCalledOnce();
    expect(sendOutboundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          files: [
            {
              bytes: generatedBytes,
              filename: "qolmeia-asset_gen_1.png",
              mimeType: "image/png",
            },
          ],
          text: "Pronto, gerei a imagem!",
        },
        threadId: "tg_chat_42",
      }),
    );
  });

  it("handles /instrucoes <text> by updating the org and posting the confirmation (no dispatch)", async () => {
    const prisma = makePrisma();
    const deps = makeDeps({ prisma });

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({ text: "/instrucoes Sempre responda em pt-BR." }),
    });

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
    expect(sendOutboundMock).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { text: "Instruções atualizadas." } }),
    );
  });

  it("handles bare /ideia by reading the current value (no dispatch)", async () => {
    const prisma = makePrisma();
    (
      prisma as never as { organization: { findUnique: ReturnType<typeof vi.fn> } }
    ).organization.findUnique.mockResolvedValue({ businessIdea: "Salão em SP." });
    const deps = makeDeps({ prisma });

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({ text: "/ideia" }),
    });

    expect(
      (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait,
    ).not.toHaveBeenCalled();
    expect(sendOutboundMock).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { text: "Salão em SP." } }),
    );
    expect(
      (prisma as never as { organization: { update: ReturnType<typeof vi.fn> } }).organization
        .update,
    ).not.toHaveBeenCalled();
  });

  it("does NOT trigger owner-command handling on regular text", async () => {
    const prisma = makePrisma();
    const deps = makeDeps({ prisma });

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({ text: "oi, sou um salão" }),
    });

    expect(
      (prisma as never as { organization: { update: ReturnType<typeof vi.fn> } }).organization
        .update,
    ).not.toHaveBeenCalled();
    expect(
      (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait,
    ).toHaveBeenCalledOnce();
    expect(sendOutboundMock).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { text: "Anotei!" } }),
    );
  });

  it("ignores owner commands when senderRole is CUSTOMER (dispatches to agent instead)", async () => {
    const prisma = makePrisma();
    const deps = makeDeps({ prisma });

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance({ senderRole: "CUSTOMER" }),
      normalizedMessage: buildNormalizedMessage({ text: "/instrucoes nope" }),
    });

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

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({ text: "olá" }),
    });

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

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({ text: "olá" }),
    });

    const activityCreate = (
      prisma as never as { activityLog: { create: ReturnType<typeof vi.fn> } }
    ).activityLog.create;
    const types = activityCreate.mock.calls.map(
      (c) => (c[0] as { data: { type: string } }).data.type,
    );
    expect(types).toContain("MESSAGE_INBOUND");
    expect(types).toContain("AGENT_RUN_STARTED");
    expect(types).toContain("AGENT_RUN_FAILED");
    expect(types).not.toContain("MESSAGE_OUTBOUND");
  });

  it("emits OWNER_COMMAND + INSTRUCTIONS_UPDATED ActivityLog rows for /instrucoes <text>", async () => {
    const prisma = makePrisma();
    const deps = makeDeps({ prisma });

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({ text: "/instrucoes Sempre responda em pt-BR." }),
    });

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

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({ text: "/ideia Salão premium em SP." }),
    });

    const activityCreate = (
      prisma as never as { activityLog: { create: ReturnType<typeof vi.fn> } }
    ).activityLog.create;
    const types = activityCreate.mock.calls.map(
      (c) => (c[0] as { data: { type: string } }).data.type,
    );
    expect(types).toEqual(["OWNER_COMMAND", "BUSINESS_IDEA_UPDATED"]);
  });

  it("threads senderRole=OWNER from the default ConnectorInstance into AgentDispatchArgs", async () => {
    const prisma = makePrisma();
    const deps = makeDeps({ prisma });

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({ text: "olá" }),
    });

    const call = (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait.mock
      .calls[0]![0] as { senderRole: "CUSTOMER" | "OWNER" | null };
    expect(call.senderRole).toBe("OWNER");
  });

  it("threads senderRole=CUSTOMER when the resolving ConnectorInstance is customer-side", async () => {
    const prisma = makePrisma();
    const deps = makeDeps({ prisma });

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance({ senderRole: "CUSTOMER" }),
      normalizedMessage: buildNormalizedMessage({ text: "oi" }),
    });

    const call = (deps.dispatcher as ReturnType<typeof makeDispatcher>).enqueueAndAwait.mock
      .calls[0]![0] as { senderRole: "CUSTOMER" | "OWNER" | null };
    expect(call.senderRole).toBe("CUSTOMER");
  });

  it("emits OWNER_COMMAND but no UPDATED row when reading bare /ideia", async () => {
    const prisma = makePrisma();
    const deps = makeDeps({ prisma });

    await handleInbound(deps, {
      connectorInstance: buildConnectorInstance(),
      normalizedMessage: buildNormalizedMessage({ text: "/ideia" }),
    });

    const activityCreate = (
      prisma as never as { activityLog: { create: ReturnType<typeof vi.fn> } }
    ).activityLog.create;
    const types = activityCreate.mock.calls.map(
      (c) => (c[0] as { data: { type: string } }).data.type,
    );
    expect(types).toEqual(["OWNER_COMMAND"]);
  });
});
