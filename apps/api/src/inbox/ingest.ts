import type { Channel, ConnectorType, PrismaClient, SenderRole } from "@repo/db";

import type { NormalizedMessage } from "../connectors/types";

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

type ConnectorInstanceLite = {
  config: unknown;
  id: string;
  orgId: string;
  senderRole: SenderRole | null;
  type: ConnectorType;
};

// Map ConnectorType (uppercase enum) to a stable lowercase provider key so
// WebhookEvent (provider, externalId) dedup keys remain consistent regardless
// of the source channel. Telegram dedup keys stay "telegram" so we don't
// reprocess pre-restructure rows.
const providerFromConnectorType = (type: ConnectorType): string => type.toLowerCase();

// Map ConnectorType to the existing Conversation.channel enum. The schema's
// Channel enum only ships TELEGRAM + WEB_CHAT today; other ConnectorTypes
// (WhatsApp, etc.) land on WEB_CHAT until the enum widens — Conversation rows
// also carry connectorInstanceId so the original channel is recoverable.
const channelFromConnectorType = (type: ConnectorType): Channel => {
  if (type === "TELEGRAM") {
    return "TELEGRAM";
  }
  return "WEB_CHAT";
};

const markWebhookProcessed = async ({
  connectorInstance,
  normalizedMessage,
  prisma,
}: {
  connectorInstance: ConnectorInstanceLite;
  normalizedMessage: NormalizedMessage;
  prisma: IngestPrisma;
}): Promise<{ alreadyProcessed: boolean }> => {
  const provider = providerFromConnectorType(connectorInstance.type);
  const externalId = normalizedMessage.externalId;
  const existing = await prisma.webhookEvent.findUnique({
    where: { provider_externalId: { externalId, provider } },
  });
  if (existing) {
    return { alreadyProcessed: true };
  }
  await prisma.webhookEvent.create({
    data: {
      externalId,
      payload: toJsonSafe({ ...normalizedMessage }) as object,
      provider,
    },
  });
  return { alreadyProcessed: false };
};

const resolveOrgAndConversation = async ({
  connectorInstance,
  externalThreadId,
  prisma,
}: {
  connectorInstance: ConnectorInstanceLite;
  externalThreadId: string;
  prisma: IngestPrisma;
}): Promise<{
  connectorInstanceId: string;
  conversationId: string;
  orgId: string;
  senderRole: SenderRole | null;
}> => {
  const channel = channelFromConnectorType(connectorInstance.type);
  const conversation =
    (await prisma.conversation.findFirst({
      select: { id: true },
      where: {
        channel,
        connectorInstanceId: connectorInstance.id,
        orgId: connectorInstance.orgId,
      },
    })) ??
    (await prisma.conversation.create({
      data: {
        channel,
        connectorInstanceId: connectorInstance.id,
        externalId: externalThreadId,
        orgId: connectorInstance.orgId,
      },
      select: { id: true },
    }));

  return {
    connectorInstanceId: connectorInstance.id,
    conversationId: conversation.id,
    orgId: connectorInstance.orgId,
    senderRole: connectorInstance.senderRole,
  };
};

const persistInboundMessage = async ({
  contentType,
  conversationId,
  normalizedMessage,
  prisma,
}: {
  contentType: "AUDIO" | "IMAGE" | "TEXT";
  conversationId: string;
  normalizedMessage: NormalizedMessage;
  prisma: IngestPrisma;
}): Promise<{ id: string }> => {
  const row = await prisma.message.create({
    data: {
      content: normalizedMessage.text ?? "",
      contentType,
      conversationId,
      externalId: normalizedMessage.externalId,
      metadata: toJsonSafe({ attachments: normalizedMessage.attachments }) as object,
      sender: "CUSTOMER",
    },
    select: { id: true },
  });
  return { id: row.id };
};

export {
  channelFromConnectorType,
  markWebhookProcessed,
  persistInboundMessage,
  providerFromConnectorType,
  resolveOrgAndConversation,
};
export type { ConnectorInstanceLite, IngestPrisma };
