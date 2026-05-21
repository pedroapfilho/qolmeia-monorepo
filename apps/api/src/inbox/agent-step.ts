import type { PrismaClient } from "@repo/db";

import { ensureAgentInstance } from "../agents/agent-instance";
import { buildContextSnapshot } from "../agents/context-snapshot";
import type { AgentDispatcher, AgentRunResult } from "../agents/dispatcher";
import { createAgentRun, finalizeAgentRun } from "../agents/runs";
import { findTemplateBySlug } from "../agents/templates/registry";
import { renderSystemPrompt } from "../agents/templates/renderer";
import type { ingestBrandAsset as ingestBrandAssetDefault } from "../knowledge/brand-asset";
import { getBusinessContext as getBusinessContextDefault } from "../knowledge/provider";
import { logger } from "../lib/logger";
import { fetchAsset as fetchAssetDefault } from "../lib/storage";

import type { ProcessedAttachments } from "./attachments";
import type { IncomingMessage, IncomingThread } from "./ingest";

type AgentStepPrisma = Pick<
  PrismaClient,
  "agentAction" | "agentInstance" | "agentRun" | "brandAsset" | "organization"
>;

type AgentStepDeps = {
  dispatcher: AgentDispatcher;
  fetchAsset?: typeof fetchAssetDefault;
  getBusinessContext?: typeof getBusinessContextDefault;
  ingestBrandAsset?: typeof ingestBrandAssetDefault;
  prisma: AgentStepPrisma;
};

const extFromMime = (mimeType: string): string => {
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return "jpg";
  }
  return "bin";
};

const runAgentForInbound = async ({
  attachments,
  connectorInstanceId,
  deps,
  externalThreadId,
  message,
  orgId,
  triggerMessageId,
}: {
  attachments: ProcessedAttachments & { audioBytes?: Uint8Array };
  // null when the conversation pre-dates Phase 5h (TelegramLink fallback).
  // Coalescing still works on (legacy, threadId, messageId).
  connectorInstanceId: string | null;
  deps: AgentStepDeps;
  externalThreadId: string;
  message: IncomingMessage;
  orgId: string;
  // The persisted Message.id, set by the inbox pipeline. Null when the
  // message wasn't persisted (defensive — current pipeline always persists).
  triggerMessageId: string | null;
}): Promise<AgentRunResult> => {
  const getBusinessContext = deps.getBusinessContext ?? getBusinessContextDefault;

  const existingRows = await deps.prisma.brandAsset.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, metadata: true, mimeType: true },
    take: 20,
    where: { orgId },
  });
  const existingAssets = existingRows.map((r) => ({
    assetId: r.id,
    metadata: r.metadata,
    mimeType: r.mimeType,
  }));

  const agentInstance = await ensureAgentInstance({
    orgId,
    prisma: deps.prisma,
    templateSlug: "controller",
  });

  const template = findTemplateBySlug(agentInstance.templateSlug);
  if (!template) {
    throw new Error(`Unknown agent template: ${agentInstance.templateSlug}`);
  }

  // Build context ONCE at dispatch time. Stored on AgentRun.contextSnapshot
  // so the run replays against the same inputs even if businessProfile
  // drifts mid-flight.
  const contextSnapshot = await buildContextSnapshot({
    existingAssets,
    getBusinessContext,
    mission: agentInstance.mission,
    newAssets: attachments.newAssets,
    orgId,
    oversizeCount: attachments.oversizeCount,
    prisma: deps.prisma,
  });

  const baseSystem = renderSystemPrompt(template.defaultSystemPrompt, {
    currentContext: contextSnapshot.businessContext,
    existingAssets: contextSnapshot.existingAssets,
    newAssets: contextSnapshot.newAssets,
    oversizeCount: contextSnapshot.oversizeCount,
  });
  const systemPrompt =
    contextSnapshot.mission.length > 0
      ? `${baseSystem}\n\nMissão deste agente:\n${contextSnapshot.mission}`
      : baseSystem;

  const run = await createAgentRun({
    agentInstanceId: agentInstance.id,
    contextSnapshot,
    prisma: deps.prisma,
    systemPrompt,
    triggerMessageId,
  });

  const text = (message.text ?? "").trim();

  try {
    const result = await deps.dispatcher.enqueueAndAwait({
      agentInstance,
      dispatcher: deps.dispatcher,
      dispatchOrigin: {
        connectorInstanceId,
        externalThreadId,
        kind: "inbound",
        triggerMessageExternalId: message.id,
      },
      existingAssets,
      input: {
        audioBytes: attachments.audioBytes,
        audioMime: attachments.audioMime,
        imageBytes: attachments.imageBytes,
        text: text.length > 0 ? text : undefined,
      },
      newAssets: attachments.newAssets,
      oversizeCount: attachments.oversizeCount,
      prisma: deps.prisma as PrismaClient,
      runId: run.id,
      systemPrompt,
    });

    await finalizeAgentRun({ prisma: deps.prisma, result, runId: run.id });
    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    await finalizeAgentRun({ error: err, prisma: deps.prisma, runId: run.id }).catch(
      // The outer `error` is the dispatch failure we re-throw below; this
      // inner callback fires only if the finalize-as-FAILED write itself
      // also fails, so we log both separately.
      (finalizeError: unknown) => {
        logger.error({ error: finalizeError, runId: run.id }, "agentRun.finalize.failed");
      },
    );
    throw error;
  }
};

const postAgentResult = async ({
  deps,
  result,
  thread,
}: {
  deps: AgentStepDeps;
  result: AgentRunResult;
  thread: IncomingThread;
}): Promise<void> => {
  const doFetch = deps.fetchAsset ?? fetchAssetDefault;

  const postImages = result.generatedAssetIds.map(async (assetId, i, arr) => {
    const isLast = i === arr.length - 1;
    try {
      const row = await deps.prisma.brandAsset.findUnique({
        select: { mimeType: true, r2Key: true },
        where: { id: assetId },
      });
      if (!row) {
        return;
      }
      const bytes = await doFetch(row.r2Key);
      const filename = `qolmeia-${assetId}.${extFromMime(row.mimeType)}`;
      await thread.post({
        files: [{ data: Buffer.from(bytes), filename, mimeType: row.mimeType }],
        markdown: isLast ? result.text : "",
      });
    } catch (error) {
      logger.error({ assetId, chatId: thread.id, error }, "generated_image.post_failed");
      if (isLast) {
        try {
          await thread.post(result.text);
        } catch {
          /* already logged above */
        }
      }
    }
  });

  await (postImages.length > 0 ? Promise.allSettled(postImages) : thread.post(result.text));
};

export { postAgentResult, runAgentForInbound };
export type { AgentStepDeps };
