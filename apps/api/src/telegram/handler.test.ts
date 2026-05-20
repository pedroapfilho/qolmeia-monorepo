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

const makeDeps = (over: Partial<{
  applySoulUpdate: ReturnType<typeof vi.fn>;
  extractFromMessage: ReturnType<typeof vi.fn>;
  getBusinessContext: ReturnType<typeof vi.fn>;
  prisma: ReturnType<typeof makePrisma>;
}> = {}): HandlerDeps => {
  const prisma = over.prisma ?? makePrisma();
  return {
    applySoulUpdate:
      (over.applySoulUpdate ??
      vi.fn().mockResolvedValue({ capturedFields: ["whatYouDo"], newProfile: { whatYouDo: "salão" } })) as unknown as HandlerDeps["applySoulUpdate"],
    extractFromMessage:
      (over.extractFromMessage ??
      vi.fn().mockResolvedValue({
        partial: {
          brandVoice: null,
          differentiator: null,
          location: null,
          targetAudience: null,
          whatYouDo: "salão",
        },
        reply: "Anotei que vocês são um salão! Qual seu público-alvo?",
        usage: { inputTokens: 1, outputTokens: 1 },
      })) as unknown as HandlerDeps["extractFromMessage"],
    getBusinessContext: (over.getBusinessContext ?? vi.fn().mockResolvedValue("")) as unknown as HandlerDeps["getBusinessContext"],
    prisma: prisma as unknown as HandlerDeps["prisma"],
  };
};

describe("handleIncomingMessage", () => {
  it("creates org+conversation+message and replies with the captured/missing summary", async () => {
    const deps = makeDeps();
    const thread = makeThread();

    await handleIncomingMessage(deps, thread, makeMessage({ text: "sou um salão" }));

    expect((deps.prisma as never as { organization: { create: ReturnType<typeof vi.fn> } }).organization.create).toHaveBeenCalledOnce();
    expect((deps.prisma as never as { message: { create: ReturnType<typeof vi.fn> } }).message.create).toHaveBeenCalledOnce();
    expect(deps.extractFromMessage).toHaveBeenCalledOnce();
    expect(deps.applySoulUpdate).toHaveBeenCalledOnce();
    expect(thread.post).toHaveBeenCalledOnce();
    expect(thread.post).toHaveBeenCalledWith("Anotei que vocês são um salão! Qual seu público-alvo?");
  });

  it("is idempotent — duplicate message id is a no-op", async () => {
    const prisma = makePrisma();
    (prisma as never as { webhookEvent: { findUnique: ReturnType<typeof vi.fn> } }).webhookEvent.findUnique.mockResolvedValue({ id: "wh_1" });
    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleIncomingMessage(deps, thread, makeMessage());

    expect(deps.extractFromMessage).not.toHaveBeenCalled();
    expect(deps.applySoulUpdate).not.toHaveBeenCalled();
    expect(thread.post).not.toHaveBeenCalled();
  });

  it("downloads audio attachments and forwards bytes to extractFromMessage", async () => {
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
    expect(deps.extractFromMessage).toHaveBeenCalledWith(
      { bytes, kind: "audio", mediaType: "audio/ogg" },
      "",
    );
  });

  it("replies with the nothing-captured nudge for empty text without calling extract", async () => {
    const deps = makeDeps({
      applySoulUpdate: vi.fn(),
      extractFromMessage: vi.fn(),
    });
    const thread = makeThread();

    await handleIncomingMessage(deps, thread, makeMessage({ text: "   " }));

    expect(deps.extractFromMessage).not.toHaveBeenCalled();
    expect(deps.applySoulUpdate).not.toHaveBeenCalled();
    expect(thread.post).toHaveBeenCalledWith("Recebi sua mensagem, mas não entendi. Pode tentar de novo?");
  });

  it("apologises (not throws) when audio download fails", async () => {
    const deps = makeDeps();
    const thread = makeThread();

    await handleIncomingMessage(
      deps,
      thread,
      makeMessage({
        attachments: [{ fetchData: () => Promise.reject(new Error("boom")), mimeType: "audio/ogg" }],
        text: "",
      }),
    );

    expect(deps.extractFromMessage).not.toHaveBeenCalled();
    const reply = (thread.post as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(reply).toContain("Não consegui baixar seu áudio");
  });

  it("apologises (not throws) when extractFromMessage fails", async () => {
    const deps = makeDeps({
      extractFromMessage: vi.fn().mockRejectedValue(new Error("rate-limited")),
    });
    const thread = makeThread();

    await handleIncomingMessage(deps, thread, makeMessage({ text: "sou um salão" }));

    expect(deps.applySoulUpdate).not.toHaveBeenCalled();
    const reply = (thread.post as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(reply).toContain("Tive um problema processando sua mensagem");
  });

  it("strips non-serializable function refs from attachments before persisting", async () => {
    const fetchData = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const deps = makeDeps();
    const thread = makeThread();

    await handleIncomingMessage(
      deps,
      thread,
      makeMessage({
        attachments: [
          {
            fetchData,
            mimeType: "audio/ogg",
            name: undefined,
          },
        ],
        text: "",
      }),
    );

    const webhookCreate = (deps.prisma as never as { webhookEvent: { create: ReturnType<typeof vi.fn> } }).webhookEvent.create;
    expect(webhookCreate).toHaveBeenCalledOnce();
    const payload = webhookCreate.mock.calls[0]![0].data.payload as {
      attachments?: Array<Record<string, unknown>>;
    };
    expect(typeof payload.attachments?.[0]?.fetchData).not.toBe("function");
    expect(payload.attachments?.[0]?.mimeType).toBe("audio/ogg");
    expect(() => JSON.stringify(payload)).not.toThrow();

    const messageCreate = (deps.prisma as never as { message: { create: ReturnType<typeof vi.fn> } }).message.create;
    expect(messageCreate).toHaveBeenCalledOnce();
    const metadata = messageCreate.mock.calls[0]![0].data.metadata as {
      attachments?: Array<Record<string, unknown>>;
    };
    expect(typeof metadata.attachments?.[0]?.fetchData).not.toBe("function");
    expect(() => JSON.stringify(metadata)).not.toThrow();
  });

  it("apologises (not throws) when a DB write fails before extraction", async () => {
    const prisma = makePrisma();
    (prisma as never as { webhookEvent: { create: ReturnType<typeof vi.fn> } }).webhookEvent.create.mockRejectedValue(
      new Error("prisma kaboom"),
    );
    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await expect(
      handleIncomingMessage(deps, thread, makeMessage({ text: "olá" })),
    ).resolves.toBeUndefined();

    expect(deps.extractFromMessage).not.toHaveBeenCalled();
    const reply = (thread.post as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(reply).toContain("Tive um problema processando sua mensagem");
  });
});
