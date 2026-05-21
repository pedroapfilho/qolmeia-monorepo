import type { PrismaClient } from "@repo/db";

import { toJsonSafe } from "./json-safe";

type IngestPrisma = Pick<
  PrismaClient,
  | "connectorInstance"
  | "conversation"
  | "message"
  | "organization"
  | "telegramLink"
  | "webhookEvent"
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
}): Promise<{
  connectorInstanceId: string | null;
  conversationId: string;
  orgId: string;
  senderRole: "CUSTOMER" | "OWNER" | null;
}> => {
  // 1. Prefer ConnectorInstance lookup (Phase 5h+).
  const connector = await prisma.connectorInstance.findFirst({
    select: { id: true, orgId: true, senderRole: true },
    where: {
      config: { equals: { chatId: telegramChatId } },
      type: "TELEGRAM",
    },
  });

  if (connector) {
    const conversation =
      (await prisma.conversation.findFirst({
        select: { id: true },
        where: { channel: "TELEGRAM", connectorInstanceId: connector.id, orgId: connector.orgId },
      })) ??
      (await prisma.conversation.create({
        data: {
          channel: "TELEGRAM",
          connectorInstanceId: connector.id,
          externalId: telegramChatId,
          orgId: connector.orgId,
        },
        select: { id: true },
      }));

    return {
      connectorInstanceId: connector.id,
      conversationId: conversation.id,
      orgId: connector.orgId,
      senderRole: connector.senderRole,
    };
  }

  // 2. Fallback: legacy TelegramLink lookup. New rows will also dual-write a
  //    ConnectorInstance so subsequent inbound messages take the path above.
  let link = await prisma.telegramLink.findUnique({
    select: { orgId: true },
    where: { telegramChatId },
  });

  if (!link) {
    // First contact for this chat. Create org + telegramLink + connectorInstance
    // + conversation atomically.
    const org = await prisma.organization.create({
      data: {
        connectorInstances: {
          create: {
            capabilities: { inbound: true, outbound: true },
            config: { chatId: telegramChatId },
            displayName: `Telegram — ${telegramChatId}`,
            senderRole: "OWNER",
            type: "TELEGRAM",
          },
        },
        conversations: { create: { channel: "TELEGRAM", externalId: telegramChatId } },
        name: `Negócio ${telegramChatId}`,
        slug: slugify(telegramChatId),
        telegramLink: { create: { telegramChatId } },
      },
      select: { id: true },
    });
    link = { orgId: org.id };
  }

  // 3. Find or create a Conversation for the legacy path.
  const conversation =
    (await prisma.conversation.findFirst({
      select: { id: true },
      where: { channel: "TELEGRAM", orgId: link.orgId },
    })) ??
    (await prisma.conversation.create({
      data: { channel: "TELEGRAM", externalId: telegramChatId, orgId: link.orgId },
      select: { id: true },
    }));

  // Legacy fallback path: new orgs auto-create an OWNER-side connector above,
  // and existing TelegramLink-only rows belong to Pedro's owner chats too, so
  // senderRole defaults to OWNER here.
  return {
    connectorInstanceId: null,
    conversationId: conversation.id,
    orgId: link.orgId,
    senderRole: "OWNER",
  };
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
