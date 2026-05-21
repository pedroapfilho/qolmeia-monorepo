import type { PrismaClient } from "@repo/db";

import { logActivity } from "../activity/log";
import type { AgentDispatcher } from "../agents/dispatcher";
import type { ingestBrandAsset as ingestBrandAssetDefault } from "../knowledge/brand-asset";
import type { getBusinessContext as getBusinessContextDefault } from "../knowledge/provider";
import { logger } from "../lib/logger";
import type { fetchAsset as fetchAssetDefault } from "../lib/storage";

import { postAgentResult, runAgentForInbound } from "./agent-step";
import { processIncomingAttachments } from "./attachments";
import { markWebhookProcessed, persistInboundMessage, resolveOrgAndConversation } from "./ingest";
import type { IncomingMessage, IncomingThread } from "./ingest";
import { handleOwnerCommand, parseOwnerCommand } from "./owner-commands";

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

    const { connectorInstanceId, conversationId, orgId, senderRole } =
      await resolveOrgAndConversation({
        prisma: deps.prisma,
        telegramChatId: thread.id,
      });

    // Owner-only slash commands (e.g. /instrucoes, /ideia) short-circuit the
    // agent runtime. Gated by senderRole so CUSTOMER-side connectors (Phase
    // 5h+) can't write to the operator-curated fields.
    if (senderRole === "OWNER") {
      const ownerCommand = parseOwnerCommand(message.text ?? null);
      if (ownerCommand !== null) {
        const persisted = await persistInboundMessage({
          contentType: "TEXT",
          conversationId,
          message,
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
        await thread.post(reply);
        logger.info(
          {
            chatId: thread.id,
            commandKind: ownerCommand.kind,
            messageId: message.id,
            messageType: "owner-command",
            orgId,
          },
          "telegram owner command handled",
        );
        return;
      }
    }

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

    const persistedMessage = await persistInboundMessage({
      contentType,
      conversationId,
      message,
      prisma: deps.prisma,
    });

    await logActivity({
      orgId,
      payload: {
        attachmentCount: attachments.length,
        contentType,
        externalMessageId: message.id,
      },
      prisma: deps.prisma,
      refId: persistedMessage.id,
      refType: "MESSAGE",
      summary: "Mensagem recebida via Telegram",
      type: "MESSAGE_INBOUND",
    });

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

    const outcome = await runAgentForInbound({
      attachments: { ...processed, audioBytes },
      connectorInstanceId,
      deps: {
        dispatcher: deps.dispatcher,
        fetchAsset: deps.fetchAsset,
        getBusinessContext: deps.getBusinessContext,
        ingestBrandAsset: deps.ingestBrandAsset,
        prisma: deps.prisma,
      },
      externalThreadId: thread.id,
      message,
      orgId,
      senderRole,
      triggerMessageId: persistedMessage.id,
    });
    const result = outcome.result;

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

    // Outbound messages from the agent don't currently land in the Message
    // table (thread.post writes straight to Telegram via Chat SDK), so the
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
      summary: "Resposta enviada ao dono via Telegram",
      type: "MESSAGE_OUTBOUND",
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
