import type { ConnectorInstance, PrismaClient } from "@repo/db";

import { logActivity } from "../activity/log";
import { ensureInboundBindingForTelegramConnector } from "../agents/connector-binding-seed";
import type { AgentDispatcher } from "../agents/dispatcher";
import { getAdapter } from "../connectors/registry";
import type { NormalizedMessage } from "../connectors/types";
import type { ingestBrandAsset as ingestBrandAssetDefault } from "../knowledge/brand-asset";
import type { getBusinessContext as getBusinessContextDefault } from "../knowledge/provider";
import { logger } from "../lib/logger";
import type { fetchAsset as fetchAssetDefault } from "../lib/storage";

import { postAgentResult, runAgentForInbound } from "./agent-step";
import type { AttachmentBytesFetcher } from "./attachments";
import { fetchAudioBytes, processIncomingAttachments } from "./attachments";
import { markWebhookProcessed, persistInboundMessage, resolveOrgAndConversation } from "./ingest";
import { handleOwnerCommand, parseOwnerCommand } from "./owner-commands";

const DOWNLOAD_FAILED_REPLY = "Não consegui baixar seu áudio, pode reenviar?";
const EMPTY_TEXT_REPLY = "Recebi sua mensagem, mas não entendi. Pode tentar de novo?";
const EXTRACT_FAILED_REPLY = "Tive um problema processando sua mensagem, pode tentar de novo?";

type PipelineDeps = {
  dispatcher: AgentDispatcher;
  fetchAsset?: typeof fetchAssetDefault;
  fetchAttachmentBytes?: AttachmentBytesFetcher;
  getBusinessContext?: typeof getBusinessContextDefault;
  ingestBrandAsset?: typeof ingestBrandAssetDefault;
  prisma: Pick<
    PrismaClient,
    | "$transaction"
    | "activityLog"
    | "agentAction"
    | "agentConnectorBinding"
    | "agentInstance"
    | "agentRun"
    | "brandAsset"
    | "connectorInstance"
    | "conversation"
    | "knowledgeDoc"
    | "message"
    | "organization"
    | "routine"
    | "webhookEvent"
  >;
};

type HandleInboundArgs = {
  connectorInstance: ConnectorInstance;
  normalizedMessage: NormalizedMessage;
};

type ChannelContext = { channelLabel: string; connectorInstanceId: string; orgId: string };

// Friendly pt-BR label used in ActivityLog summaries + Pino logs. Kept here
// so the existing "Mensagem recebida via Telegram" summary survives the
// unification refactor.
const CONNECTOR_DISPLAY_LABELS: Record<string, string> = {
  FRESHA: "Fresha",
  GOOGLE_MY_BUSINESS: "Google Meu Negócio",
  INSTAGRAM: "Instagram",
  TELEGRAM: "Telegram",
  WEB_CHAT: "Chat",
  WHATSAPP: "WhatsApp",
};

const labelForConnectorType = (type: string): string => CONNECTOR_DISPLAY_LABELS[type] ?? type;

const sendOutboundReply = async ({
  connectorInstance,
  text,
  threadId,
}: {
  connectorInstance: Pick<ConnectorInstance, "config" | "type">;
  text: string;
  threadId: string;
}): Promise<void> => {
  const adapter = getAdapter(connectorInstance.type);
  await adapter.sendOutbound({
    connectorConfig: connectorInstance.config,
    payload: { text },
    threadId,
  });
};

const summaryForChannel = (channel: string): string => `Mensagem recebida via ${channel}`;

const outboundSummaryForChannel = (channel: string): string =>
  `Resposta enviada ao dono via ${channel}`;

const safeSendReply = async ({
  connectorInstance,
  context,
  text,
  threadId,
}: {
  connectorInstance: ConnectorInstance;
  context: { messageExternalId: string; threadId: string };
  text: string;
  threadId: string;
}) => {
  try {
    await sendOutboundReply({ connectorInstance, text, threadId });
  } catch (error) {
    logger.error(
      { chatId: context.threadId, error, messageId: context.messageExternalId },
      "handler.reply_failed",
    );
  }
};

const handleInbound = async (deps: PipelineDeps, args: HandleInboundArgs): Promise<void> => {
  const { connectorInstance, normalizedMessage } = args;
  const threadId = normalizedMessage.externalThreadId;
  const messageExternalId = normalizedMessage.externalId;
  const channelLabel = labelForConnectorType(connectorInstance.type);

  try {
    const { alreadyProcessed } = await markWebhookProcessed({
      connectorInstance,
      normalizedMessage,
      prisma: deps.prisma,
    });
    if (alreadyProcessed) {
      return;
    }

    const { conversationId, orgId, senderRole } = await resolveOrgAndConversation({
      connectorInstance,
      externalThreadId: threadId,
      prisma: deps.prisma,
    });

    // Idempotent backfill for legacy Telegram ConnectorInstances that
    // predate AgentConnectorBinding-driven routing. Skipped when an
    // INBOUND/BOTH binding already exists; the runtime fails closed in
    // resolveInboundAgentInstance if none was created.
    if (connectorInstance.type === "TELEGRAM") {
      const existingBinding = await deps.prisma.agentConnectorBinding.findFirst({
        select: { id: true },
        where: {
          connectorInstanceId: connectorInstance.id,
          direction: { in: ["INBOUND", "BOTH"] },
        },
      });
      if (!existingBinding) {
        await ensureInboundBindingForTelegramConnector({
          connectorInstanceId: connectorInstance.id,
          orgId: connectorInstance.orgId,
          prisma: deps.prisma,
        });
      }
    }

    const channelContext: ChannelContext = {
      channelLabel,
      connectorInstanceId: connectorInstance.id,
      orgId,
    };

    // Owner-only slash commands (e.g. /instrucoes, /ideia) short-circuit the
    // agent runtime. Gated by senderRole so CUSTOMER-side connectors can't
    // write to the operator-curated fields.
    if (senderRole === "OWNER") {
      const ownerCommand = parseOwnerCommand(normalizedMessage.text ?? null);
      if (ownerCommand !== null) {
        const persisted = await persistInboundMessage({
          contentType: "TEXT",
          conversationId,
          normalizedMessage,
          prisma: deps.prisma,
        });
        await logActivity({
          orgId,
          payload: { commandKind: ownerCommand.kind, contentType: "TEXT" },
          prisma: deps.prisma,
          refId: persisted.id,
          refType: "MESSAGE",
          summary: `Comando do dono recebido: /${ownerCommand.kind}`,
          type: "OWNER_COMMAND",
        });
        const reply = await handleOwnerCommand({
          command: ownerCommand,
          orgId,
          prisma: deps.prisma,
        });
        await sendOutboundReply({ connectorInstance, text: reply, threadId });
        logger.info(
          {
            channel: channelContext.channelLabel,
            chatId: threadId,
            commandKind: ownerCommand.kind,
            messageId: messageExternalId,
            messageType: "owner-command",
            orgId,
          },
          "connector owner command handled",
        );
        return;
      }
    }

    const attachments = normalizedMessage.attachments;
    const hasAudio = attachments.some(
      (a) => a.kind === "audio" || (a.mimeType ?? "").startsWith("audio"),
    );
    const hasImages = attachments.some(
      (a) => a.kind === "image" || (a.mimeType ?? "").startsWith("image"),
    );

    let contentType: "AUDIO" | "IMAGE" | "TEXT";
    if (hasAudio) {
      contentType = "AUDIO";
    } else if (hasImages) {
      contentType = "IMAGE";
    } else {
      contentType = "TEXT";
    }

    const persistedMessage = await persistInboundMessage({
      contentType,
      conversationId,
      normalizedMessage,
      prisma: deps.prisma,
    });

    await logActivity({
      orgId,
      payload: {
        attachmentCount: attachments.length,
        contentType,
        externalMessageId: messageExternalId,
      },
      prisma: deps.prisma,
      refId: persistedMessage.id,
      refType: "MESSAGE",
      summary: summaryForChannel(channelContext.channelLabel),
      type: "MESSAGE_INBOUND",
    });

    const processed = await processIncomingAttachments({
      deps: {
        fetchAttachmentBytes: deps.fetchAttachmentBytes,
        ingestBrandAsset: deps.ingestBrandAsset,
        prisma: deps.prisma,
      },
      normalizedMessage,
      orgId,
    });

    const text = (normalizedMessage.text ?? "").trim();
    if (
      !processed.hasAudio &&
      text.length === 0 &&
      processed.newAssets.length === 0 &&
      processed.oversizeCount === 0
    ) {
      await sendOutboundReply({ connectorInstance, text: EMPTY_TEXT_REPLY, threadId });
      return;
    }

    let audioBytes: Uint8Array | undefined;
    if (processed.hasAudio) {
      try {
        const fetched = await fetchAudioBytes({
          deps: {
            fetchAttachmentBytes: deps.fetchAttachmentBytes,
            ingestBrandAsset: deps.ingestBrandAsset,
            prisma: deps.prisma,
          },
          normalizedMessage,
        });
        if (!fetched) {
          throw new Error("attachment has no bytes or url");
        }
        audioBytes = fetched;
      } catch (error) {
        logger.error(
          { chatId: threadId, error, messageId: messageExternalId },
          "audio.download_failed",
        );
        await sendOutboundReply({ connectorInstance, text: DOWNLOAD_FAILED_REPLY, threadId });
        return;
      }
    }

    const outcome = await runAgentForInbound({
      attachments: { ...processed, audioBytes },
      connectorInstance,
      deps: {
        dispatcher: deps.dispatcher,
        fetchAsset: deps.fetchAsset,
        getBusinessContext: deps.getBusinessContext,
        ingestBrandAsset: deps.ingestBrandAsset,
        prisma: deps.prisma,
      },
      normalizedMessage,
      orgId,
      senderRole,
      triggerMessageId: persistedMessage.id,
    });
    const result = outcome.result;

    await postAgentResult({
      connectorInstance,
      deps: {
        dispatcher: deps.dispatcher,
        fetchAsset: deps.fetchAsset,
        getBusinessContext: deps.getBusinessContext,
        ingestBrandAsset: deps.ingestBrandAsset,
        prisma: deps.prisma,
      },
      normalizedMessage,
      result,
    });

    // Outbound messages from the agent don't currently land in the Message
    // table (sendOutbound writes straight to the provider), so the
    // ActivityLog row refs the AgentRun instead. Persisting outbound Message
    // rows is a separate concern tracked outside this task.
    await logActivity({
      orgId,
      payload: {
        generatedAssetCount: result.generatedAssetIds.length,
        replyLength: result.text.length,
        tokensIn: result.usage.inputTokens,
        tokensOut: result.usage.outputTokens,
      },
      prisma: deps.prisma,
      refId: outcome.runId,
      refType: "AGENT_RUN",
      summary: outboundSummaryForChannel(channelContext.channelLabel),
      type: "MESSAGE_OUTBOUND",
    });

    logger.info(
      {
        channel: channelContext.channelLabel,
        chatId: threadId,
        generatedAssetIds: result.generatedAssetIds,
        messageId: messageExternalId,
        newAssetIds: processed.newAssets.map((a) => a.assetId),
        oversizeCount: processed.oversizeCount,
        replyLength: result.text.length,
        tokensIn: result.usage.inputTokens,
        tokensOut: result.usage.outputTokens,
        toolCallSummary: result.toolCallSummary,
      },
      "connector message handled",
    );
  } catch (error) {
    logger.error({ chatId: threadId, error, messageId: messageExternalId }, "handler.failed");
    await safeSendReply({
      connectorInstance,
      context: { messageExternalId, threadId },
      text: EXTRACT_FAILED_REPLY,
      threadId,
    });
  }
};

export { handleInbound };
export type { HandleInboundArgs, PipelineDeps };
