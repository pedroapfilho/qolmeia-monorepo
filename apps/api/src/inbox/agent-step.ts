import type { ConnectorInstance, PrismaClient, SenderRole } from "@repo/db";

import { findInboundAgentInstanceForConnector } from "../agents/agent-instance";
import { buildContextSnapshot } from "../agents/context-snapshot";
import type { AgentDispatcher, AgentRunResult } from "../agents/dispatcher";
import { createAgentRun, finalizeAgentRun } from "../agents/runs";
import { findTemplateBySlug } from "../agents/templates/registry";
import { renderSystemPrompt } from "../agents/templates/renderer";
import { getAdapter } from "../connectors/registry";
import type { NormalizedMessage, OutboundFile } from "../connectors/types";
import type { ingestBrandAsset as ingestBrandAssetDefault } from "../knowledge/brand-asset";
import { getBusinessContext as getBusinessContextDefault } from "../knowledge/provider";
import { logger } from "../lib/logger";
import { fetchAsset as fetchAssetDefault } from "../lib/storage";

import type { ProcessedAttachments } from "./attachments";

type AgentStepPrisma = Pick<
  PrismaClient,
  | "activityLog"
  | "agentAction"
  | "agentConnectorBinding"
  | "agentInstance"
  | "agentRun"
  | "brandAsset"
  | "organization"
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

type InboundRunOutcome = {
  agentInstanceId: string;
  result: AgentRunResult;
  runId: string;
};

const resolveInboundAgentInstance = async ({
  connectorInstanceId,
  orgId,
  prisma,
}: {
  connectorInstanceId: string;
  orgId: string;
  prisma: AgentStepPrisma;
}) => {
  const lookup = await findInboundAgentInstanceForConnector({ connectorInstanceId, prisma });
  if (lookup.kind === "found") {
    return lookup.agentInstance;
  }
  if (lookup.kind === "ambiguous") {
    logger.error(
      {
        candidateTemplateSlugs: lookup.candidateTemplateSlugs,
        connectorInstanceId,
        orgId,
      },
      "agent-step.routing.ambiguous_inbound_binding",
    );
    throw new Error(
      `Multiple inbound bindings for ConnectorInstance ${connectorInstanceId}: ${lookup.candidateTemplateSlugs.join(", ")}`,
    );
  }
  logger.error({ connectorInstanceId, orgId }, "agent-step.routing.missing_inbound_binding");
  throw new Error(`No inbound binding for ConnectorInstance ${connectorInstanceId}`);
};

const runAgentForInbound = async ({
  attachments,
  connectorInstance,
  deps,
  normalizedMessage,
  orgId,
  senderRole,
  triggerMessageId,
}: {
  attachments: ProcessedAttachments & { audioBytes?: Uint8Array };
  connectorInstance: Pick<ConnectorInstance, "id" | "orgId" | "type">;
  deps: AgentStepDeps;
  normalizedMessage: NormalizedMessage;
  orgId: string;
  // senderRole snapshot from the resolving ConnectorInstance. Threaded into
  // AgentDispatchArgs so recordAgentAction can apply the §8 approval rule
  // (DRAFTED for CUSTOMER + requires-approval skills).
  senderRole: SenderRole | null;
  // The persisted Message.id, set by the inbox pipeline. Null when the
  // message wasn't persisted (defensive — current pipeline always persists).
  triggerMessageId: string | null;
}): Promise<InboundRunOutcome> => {
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

  const agentInstance = await resolveInboundAgentInstance({
    connectorInstanceId: connectorInstance.id,
    orgId,
    prisma: deps.prisma,
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

  const activityContext = {
    agentDisplayName: agentInstance.displayName,
    orgId,
    templateSlug: agentInstance.templateSlug,
  };

  const run = await createAgentRun({
    activityContext,
    agentInstanceId: agentInstance.id,
    contextSnapshot,
    prisma: deps.prisma,
    systemPrompt,
    triggerMessageId,
  });

  const text = (normalizedMessage.text ?? "").trim();

  try {
    const result = await deps.dispatcher.enqueueAndAwait({
      agentInstance,
      dispatcher: deps.dispatcher,
      dispatchOrigin: {
        connectorInstanceId: connectorInstance.id,
        externalThreadId: normalizedMessage.externalThreadId,
        kind: "inbound",
        triggerMessageExternalId: normalizedMessage.externalId,
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
      senderRole,
      systemPrompt,
    });

    await finalizeAgentRun({ activityContext, prisma: deps.prisma, result, runId: run.id });
    return { agentInstanceId: agentInstance.id, result, runId: run.id };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    await finalizeAgentRun({
      activityContext,
      error: err,
      prisma: deps.prisma,
      runId: run.id,
    }).catch(
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
  connectorInstance,
  deps,
  normalizedMessage,
  result,
}: {
  connectorInstance: Pick<ConnectorInstance, "config" | "id" | "type">;
  deps: AgentStepDeps;
  normalizedMessage: NormalizedMessage;
  result: AgentRunResult;
}): Promise<void> => {
  const doFetch = deps.fetchAsset ?? fetchAssetDefault;
  const adapter = getAdapter(connectorInstance.type);
  const threadId = normalizedMessage.externalThreadId;

  if (result.generatedAssetIds.length === 0) {
    await adapter.sendOutbound({
      connectorConfig: connectorInstance.config,
      payload: { text: result.text },
      threadId,
    });
    return;
  }

  // Fetch all generated asset bytes from R2 in parallel, then send as a
  // single outbound (text + files). When fetch fails the adapter still
  // receives whatever bytes we have; if every file fetch fails we fall
  // back to a plain-text reply so the user isn't left hanging.
  const fetched = await Promise.allSettled(
    result.generatedAssetIds.map(async (assetId) => {
      const row = await deps.prisma.brandAsset.findUnique({
        select: { mimeType: true, r2Key: true },
        where: { id: assetId },
      });
      if (!row) {
        return null;
      }
      const bytes = await doFetch(row.r2Key);
      const file: OutboundFile = {
        bytes,
        filename: `qolmeia-${assetId}.${extFromMime(row.mimeType)}`,
        mimeType: row.mimeType,
      };
      return file;
    }),
  );

  const files: Array<OutboundFile> = [];
  for (const [i, settled] of fetched.entries()) {
    if (settled.status === "fulfilled" && settled.value) {
      files.push(settled.value);
    } else if (settled.status === "rejected") {
      logger.error(
        { assetId: result.generatedAssetIds[i], chatId: threadId, error: settled.reason },
        "generated_image.post_failed",
      );
    }
  }

  if (files.length === 0) {
    await adapter
      .sendOutbound({
        connectorConfig: connectorInstance.config,
        payload: { text: result.text },
        threadId,
      })
      .catch((error: unknown) => {
        logger.error({ chatId: threadId, error }, "handler.reply_failed");
      });
    return;
  }

  try {
    await adapter.sendOutbound({
      connectorConfig: connectorInstance.config,
      payload: { files, text: result.text },
      threadId,
    });
  } catch (error) {
    logger.error({ chatId: threadId, error }, "generated_image.post_failed");
    await adapter
      .sendOutbound({
        connectorConfig: connectorInstance.config,
        payload: { text: result.text },
        threadId,
      })
      .catch((postError: unknown) => {
        logger.error({ chatId: threadId, error: postError }, "handler.reply_failed");
      });
  }
};

export { postAgentResult, runAgentForInbound };
export type { AgentStepDeps, InboundRunOutcome };
