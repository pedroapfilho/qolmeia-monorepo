import type { PrismaClient } from "@repo/db";

import type { AgentDispatcher } from "../agents/dispatcher";
import type { ingestBrandAsset as ingestBrandAssetDefault } from "../knowledge/brand-asset";
import type { getBusinessContext as getBusinessContextDefault } from "../knowledge/provider";
import { logger } from "../lib/logger";
import type { fetchAsset as fetchAssetDefault } from "../lib/storage";

import { postAgentResult, runAgentForInbound } from "./agent-step";
import { processIncomingAttachments } from "./attachments";
import { markWebhookProcessed, persistInboundMessage, resolveOrgAndConversation } from "./ingest";
import type { IncomingMessage, IncomingThread } from "./ingest";

const DOWNLOAD_FAILED_REPLY = "Não consegui baixar seu áudio, pode reenviar?";
const EMPTY_TEXT_REPLY = "Recebi sua mensagem, mas não entendi. Pode tentar de novo?";
const EXTRACT_FAILED_REPLY = "Tive um problema processando sua mensagem, pode tentar de novo?";

type PipelineDeps = {
  dispatcher: AgentDispatcher;
  fetchAsset?: typeof fetchAssetDefault;
  getBusinessContext?: typeof getBusinessContextDefault;
  ingestBrandAsset?: typeof ingestBrandAssetDefault;
  prisma: Pick<
    PrismaClient,
    | "$transaction"
    | "agentConnectorBinding"
    | "agentInstance"
    | "brandAsset"
    | "connectorInstance"
    | "conversation"
    | "message"
    | "organization"
    | "telegramLink"
    | "webhookEvent"
  >;
};

const handleInboundMessage = async (
  deps: PipelineDeps,
  thread: IncomingThread,
  message: IncomingMessage,
): Promise<void> => {
  try {
    const { alreadyProcessed } = await markWebhookProcessed({ message, prisma: deps.prisma });
    if (alreadyProcessed) {
      return;
    }

    const {
      // TODO: thread into AgentDispatchArgs for senderRole-aware approval
      connectorInstanceId: _connectorInstanceId,
      conversationId,
      orgId,
    } = await resolveOrgAndConversation({
      prisma: deps.prisma,
      telegramChatId: thread.id,
    });

    const attachments = message.attachments ?? [];
    const hasAudio = attachments.some((a) => (a.mimeType ?? "").startsWith("audio"));
    const hasImages = attachments.some((a) => (a.mimeType ?? "").startsWith("image"));

    let contentType: "AUDIO" | "IMAGE" | "TEXT";
    if (hasAudio) {
      contentType = "AUDIO";
    } else if (hasImages) {
      contentType = "IMAGE";
    } else {
      contentType = "TEXT";
    }

    await persistInboundMessage({ contentType, conversationId, message, prisma: deps.prisma });

    const processed = await processIncomingAttachments({
      chatId: thread.id,
      deps: { ingestBrandAsset: deps.ingestBrandAsset, prisma: deps.prisma },
      message,
      orgId,
    });

    const text = (message.text ?? "").trim();
    if (
      !processed.hasAudio &&
      text.length === 0 &&
      processed.newAssets.length === 0 &&
      processed.oversizeCount === 0
    ) {
      await thread.post(EMPTY_TEXT_REPLY);
      return;
    }

    let audioBytes: Uint8Array | undefined;
    if (processed.hasAudio) {
      const audio = attachments.find((a) => (a.mimeType ?? "").startsWith("audio"));
      try {
        if (!audio?.fetchData) {
          throw new Error("attachment has no fetchData");
        }
        audioBytes = await audio.fetchData();
      } catch (error) {
        logger.error({ chatId: thread.id, error, messageId: message.id }, "audio.download_failed");
        await thread.post(DOWNLOAD_FAILED_REPLY);
        return;
      }
    }

    const result = await runAgentForInbound({
      attachments: { ...processed, audioBytes },
      deps: {
        dispatcher: deps.dispatcher,
        fetchAsset: deps.fetchAsset,
        getBusinessContext: deps.getBusinessContext,
        ingestBrandAsset: deps.ingestBrandAsset,
        prisma: deps.prisma,
      },
      message,
      orgId,
    });

    await postAgentResult({
      deps: {
        dispatcher: deps.dispatcher,
        fetchAsset: deps.fetchAsset,
        getBusinessContext: deps.getBusinessContext,
        ingestBrandAsset: deps.ingestBrandAsset,
        prisma: deps.prisma,
      },
      result,
      thread,
    });

    logger.info(
      {
        chatId: thread.id,
        generatedAssetIds: result.generatedAssetIds,
        messageId: message.id,
        newAssetIds: processed.newAssets.map((a) => a.assetId),
        oversizeCount: processed.oversizeCount,
        replyLength: result.text.length,
        tokensIn: result.usage.inputTokens,
        tokensOut: result.usage.outputTokens,
        toolCallSummary: result.toolCallSummary,
      },
      "telegram message handled",
    );
  } catch (error) {
    logger.error({ chatId: thread.id, error, messageId: message.id }, "handler.failed");
    try {
      await thread.post(EXTRACT_FAILED_REPLY);
    } catch (postError) {
      logger.error(
        { chatId: thread.id, error: postError, messageId: message.id },
        "handler.reply_failed",
      );
    }
  }
};

export { handleInboundMessage };
export type { IncomingMessage, IncomingThread, PipelineDeps };
