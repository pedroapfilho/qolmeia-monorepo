import { describe, expect, it, vi } from "vitest";

import { handleIncomingMessage } from "./handler";

const makeThread = () => ({ id: "tg_chat_42", post: vi.fn().mockResolvedValue(undefined) });

const makeMessage = (over: Partial<{ id: string; text: string }> = {}) => ({
  attachments: [] as Array<{ mimeType: string; name: string }>,
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

describe("handleIncomingMessage", () => {
  it("creates org+conversation+message and replies on first contact", async () => {
    const prisma = makePrisma();
    const thread = makeThread();

    await handleIncomingMessage({ prisma }, thread, makeMessage());

    expect((prisma as never as { organization: { create: ReturnType<typeof vi.fn> } }).organization.create).toHaveBeenCalledOnce();
    expect((prisma as never as { message: { create: ReturnType<typeof vi.fn> } }).message.create).toHaveBeenCalledOnce();
    expect(thread.post).toHaveBeenCalledOnce();
  });

  it("is idempotent — duplicate message id is a no-op", async () => {
    const prisma = makePrisma();
    (prisma as never as { webhookEvent: { findUnique: ReturnType<typeof vi.fn> } }).webhookEvent.findUnique.mockResolvedValue({ id: "wh_1" });
    const thread = makeThread();

    await handleIncomingMessage({ prisma }, thread, makeMessage());

    expect((prisma as never as { message: { create: ReturnType<typeof vi.fn> } }).message.create).not.toHaveBeenCalled();
    expect(thread.post).not.toHaveBeenCalled();
  });
});
