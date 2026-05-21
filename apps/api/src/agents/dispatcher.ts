import type { AgentInstance, PrismaClient } from "@repo/db";

type AgentRunInput = {
  audioBytes?: Uint8Array;
  audioMime?: string;
  imageBytes: ReadonlyArray<{ assetId: string; bytes: Uint8Array; mimeType: string }>;
  text?: string;
};

type AssetSummary = {
  assetId: string;
  deduped: boolean;
  mimeType: string;
};

type ExistingAssetSummary = {
  assetId: string;
  metadata: unknown;
  mimeType: string;
};

type AgentRunResult = {
  generatedAssetIds: ReadonlyArray<string>;
  text: string;
  toolCallSummary: Record<string, number>;
  usage: { inputTokens: number; outputTokens: number };
};

// Discriminator that lets the dispatcher build a coalesce key (BullMQ jobId)
// so duplicate inbound webhooks and accidentally re-issued delegations don't
// race two runs over the same conversation. `inbound` is set at the
// pipeline edge; `delegation` is set by skills that re-enter the dispatcher.
type DispatchOrigin =
  | {
      // null when the conversation pre-dates ConnectorInstance (legacy
      // TelegramLink path); we still coalesce by thread + message id.
      connectorInstanceId: string | null;
      externalThreadId: string;
      kind: "inbound";
      triggerMessageExternalId: string;
    }
  | {
      childTemplateSlug: string;
      kind: "delegation";
      parentAgentInstanceId: string;
      // TODO: once AgentRun lands (Group 3.1), key by `parentRunId` instead
      // of `parentAgentInstanceId + Date.now()` so two delegations from the
      // same parent run dedup against each other.
      subtaskHash: string;
    };

type AgentDispatchArgs = {
  agentInstance: AgentInstance;
  currentContext: string;
  dispatcher: AgentDispatcher;
  dispatchOrigin?: DispatchOrigin;
  existingAssets: ReadonlyArray<ExistingAssetSummary>;
  input: AgentRunInput;
  newAssets: ReadonlyArray<AssetSummary>;
  oversizeCount: number;
  prisma: PrismaClient;
};

type AgentRunner = (args: AgentDispatchArgs) => Promise<AgentRunResult>;

type AgentDispatcher = {
  enqueueAndAwait: (args: AgentDispatchArgs) => Promise<AgentRunResult>;
};

const createSerialDispatcher = (runner: AgentRunner): AgentDispatcher => ({
  enqueueAndAwait: (args) => runner(args),
});

const buildCoalesceKey = (origin: DispatchOrigin): string => {
  if (origin.kind === "inbound") {
    const connector = origin.connectorInstanceId ?? "legacy";
    return `inbox:${connector}:${origin.externalThreadId}:${origin.triggerMessageExternalId}`;
  }
  return `delegate:${origin.parentAgentInstanceId}:${origin.childTemplateSlug}:${origin.subtaskHash}`;
};

export { buildCoalesceKey, createSerialDispatcher };
export type {
  AgentDispatcher,
  AgentDispatchArgs,
  AgentRunInput,
  AgentRunner,
  AgentRunResult,
  AssetSummary,
  DispatchOrigin,
  ExistingAssetSummary,
};
