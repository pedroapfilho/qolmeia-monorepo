import type { PrismaClient } from "@repo/db";

import { logger } from "../lib/logger";

type HandlerDeps = { prisma: Pick<PrismaClient, "conversation" | "message" | "organization" | "telegramLink" | "webhookEvent"> };

type IncomingAttachment = { mimeType?: string; name?: string };

type IncomingMessage = {
  attachments?: Array<IncomingAttachment>;
  id: string;
  text?: string;
};

type IncomingThread = {
  id: string;
  post: (text: string) => Promise<unknown>;
};

const ACK_REPLY =
  "Recebi sua mensagem 👋 Em breve vou transformar seus áudios no perfil do seu negócio.";

const slugify = (chatId: string): string => `org-tg-${chatId}`.toLowerCase();

const handleIncomingMessage = async (
  deps: HandlerDeps,
  thread: IncomingThread,
  message: IncomingMessage,
): Promise<void> => {
  const { prisma } = deps;

  // Durable audit + idempotency (complements the adapter's in-memory dedup).
  const existing = await prisma.webhookEvent.findUnique({
    where: { provider_externalId: { externalId: message.id, provider: "telegram" } },
  });
  if (existing) {
    return;
  }
  await prisma.webhookEvent.create({
    data: { externalId: message.id, payload: { ...message }, provider: "telegram" },
  });

  // Resolve identity: one Telegram chat == one Organization being onboarded.
  let link = await prisma.telegramLink.findUnique({
    select: { orgId: true },
    where: { telegramChatId: thread.id },
  });

  if (!link) {
    const org = await prisma.organization.create({
      data: {
        conversations: { create: { channel: "TELEGRAM", externalId: thread.id } },
        name: `Negócio ${thread.id}`,
        slug: slugify(thread.id),
        telegramLink: { create: { telegramChatId: thread.id } },
      },
      select: { id: true },
    });
    link = { orgId: org.id };
  }

  const conversation =
    (await prisma.conversation.findFirst({
      select: { id: true },
      where: { channel: "TELEGRAM", orgId: link.orgId },
    })) ??
    (await prisma.conversation.create({
      data: { channel: "TELEGRAM", externalId: thread.id, orgId: link.orgId },
      select: { id: true },
    }));

  const hasAudio = (message.attachments ?? []).some((a) =>
    (a.mimeType ?? "").startsWith("audio"),
  );

  await prisma.message.create({
    data: {
      content: message.text ?? "",
      contentType: hasAudio ? "AUDIO" : "TEXT",
      conversationId: conversation.id,
      externalId: message.id,
      metadata: { attachments: message.attachments ?? [] },
      sender: "CUSTOMER",
    },
  });

  await thread.post(ACK_REPLY);
  logger.info({ chatId: thread.id, messageId: message.id }, "telegram message handled");
};

export { handleIncomingMessage };
export type { HandlerDeps, IncomingMessage, IncomingThread };
