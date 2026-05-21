import type { PrismaClient } from "@repo/db";

import { ensureInboundBindingForTelegramConnector } from "../agents/connector-binding-seed";

import { toJsonSafe } from "./json-safe";

type IngestPrisma = Pick<
  PrismaClient,
  | "agentConnectorBinding"
  | "agentInstance"
  | "connectorInstance"
  | "conversation"
  | "message"
  | "organization"
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
  connectorInstanceId: string;
  conversationId: string;
  orgId: string;
  senderRole: "CUSTOMER" | "OWNER" | null;
}> => {
  // Post-Phase-5i: every inbound message must come from a known onboarded
  // org. The chat -> org mapping lives on ConnectorInstance(TELEGRAM)
  // with config.chatId. Unknown chats are rejected so we don't silently
  // create rogue orgs from arbitrary Telegram traffic.
  const connector = await prisma.connectorInstance.findFirst({
    select: {
      bindings: {
        select: { id: true },
        take: 1,
        where: { direction: { in: ["INBOUND", "BOTH"] } },
      },
      id: true,
      orgId: true,
      senderRole: true,
    },
    where: {
      config: { equals: { chatId: telegramChatId } },
      type: "TELEGRAM",
    },
  });

  if (!connector) {
    throw new Error(`No ConnectorInstance(TELEGRAM) found for chatId ${telegramChatId}`);
  }

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

  // Idempotent backfill: existing ConnectorInstance rows that predate
  // binding-driven routing need the Controller INBOUND binding too. Skip
  // when bindings already exist to avoid steady-state upsert overhead.
  if (connector.bindings.length === 0) {
    await ensureInboundBindingForTelegramConnector({
      connectorInstanceId: connector.id,
      orgId: connector.orgId,
      prisma,
    });
  }

  return {
    connectorInstanceId: connector.id,
    conversationId: conversation.id,
    orgId: connector.orgId,
    senderRole: connector.senderRole,
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
}): Promise<{ id: string }> => {
  const row = await prisma.message.create({
    data: {
      content: message.text ?? "",
      contentType,
      conversationId,
      externalId: message.id,
      metadata: toJsonSafe({ attachments: message.attachments ?? [] }) as object,
      sender: "CUSTOMER",
    },
    select: { id: true },
  });
  return { id: row.id };
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
