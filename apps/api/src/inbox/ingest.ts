import type { PrismaClient } from "@repo/db";

import { toJsonSafe } from "./json-safe";

type IngestPrisma = Pick<
  PrismaClient,
  "conversation" | "message" | "organization" | "telegramLink" | "webhookEvent"
>;

type IncomingAttachment = {
  fetchData?: () => Promise<Uint8Array>;
  mimeType?: string;
  name?: string;
};

type IncomingMessage = {
  attachments?: Array<IncomingAttachment>;
  id: string;
  text?: string;
};

const slugify = (chatId: string): string => `org-tg-${chatId}`.toLowerCase();

const markWebhookProcessed = async ({
  message,
  prisma,
}: {
  message: IncomingMessage;
  prisma: IngestPrisma;
}): Promise<{ alreadyProcessed: boolean }> => {
  const existing = await prisma.webhookEvent.findUnique({
    where: { provider_externalId: { externalId: message.id, provider: "telegram" } },
  });
  if (existing) {
    return { alreadyProcessed: true };
  }
  await prisma.webhookEvent.create({
    data: {
      externalId: message.id,
      payload: toJsonSafe({ ...message }) as object,
      provider: "telegram",
    },
  });
  return { alreadyProcessed: false };
};

const resolveOrgAndConversation = async ({
  prisma,
  telegramChatId,
}: {
  prisma: IngestPrisma;
  telegramChatId: string;
}): Promise<{ conversationId: string; orgId: string }> => {
  let link = await prisma.telegramLink.findUnique({
    select: { orgId: true },
    where: { telegramChatId },
  });
  if (!link) {
    const org = await prisma.organization.create({
      data: {
        conversations: { create: { channel: "TELEGRAM", externalId: telegramChatId } },
        name: `Negócio ${telegramChatId}`,
        slug: slugify(telegramChatId),
        telegramLink: { create: { telegramChatId } },
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
      data: { channel: "TELEGRAM", externalId: telegramChatId, orgId: link.orgId },
      select: { id: true },
    }));

  return { conversationId: conversation.id, orgId: link.orgId };
};

const persistInboundMessage = async ({
  contentType,
  conversationId,
  message,
  prisma,
}: {
  contentType: "AUDIO" | "IMAGE" | "TEXT";
  conversationId: string;
  message: IncomingMessage;
  prisma: IngestPrisma;
}): Promise<void> => {
  await prisma.message.create({
    data: {
      content: message.text ?? "",
      contentType,
      conversationId,
      externalId: message.id,
      metadata: toJsonSafe({ attachments: message.attachments ?? [] }) as object,
      sender: "CUSTOMER",
    },
  });
};

type PostableFile = {
  data: Buffer | Uint8Array;
  filename: string;
  mimeType?: string;
};

type PostableMessage = {
  files?: ReadonlyArray<PostableFile>;
  markdown: string;
};

type IncomingThread = {
  id: string;
  post: (message: string | PostableMessage) => Promise<unknown>;
};

export { markWebhookProcessed, persistInboundMessage, resolveOrgAndConversation };
export type { IncomingAttachment, IncomingMessage, IncomingThread, IngestPrisma };
