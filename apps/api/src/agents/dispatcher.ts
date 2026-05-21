import type { AgentInstance, PrismaClient, SenderRole } from "@repo/db";

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
      // The parent AgentRun id is the canonical dedup token: identical
      // subtasks from the same parent run coalesce against each other.
      parentRunId: string;
      subtaskHash: string;
    };

type AgentDispatchArgs = {
  agentInstance: AgentInstance;
  dispatcher: AgentDispatcher;
  dispatchOrigin?: DispatchOrigin;
  existingAssets: ReadonlyArray<ExistingAssetSummary>;
  input: AgentRunInput;
  newAssets: ReadonlyArray<AssetSummary>;
  oversizeCount: number;
  prisma: PrismaClient;
  // The AgentRun row this dispatch belongs to. Set by the orchestrator
  // (inbox/agent-step or delegate-to-specialist) before enqueue; the
  // runtime reads contextSnapshot + systemPrompt from this row.
  runId: string;
  // senderRole of the ConnectorInstance that triggered this run, snapshot at
  // dispatch time. Threaded into recordAgentAction so the §8 approval rule
  // (DRAFTED vs AUTO_APPROVED) can fire. Null when there's no connector
  // (legacy TelegramLink path, internal delegations). At run-level granularity
  // because v0 = one run, one trigger, one connector; multi-connector fan-in
  // would force this down to the action level.
  senderRole: SenderRole | null;
  // Fully rendered system prompt — duplicated from AgentRun.systemPrompt
  // so the worker doesn't need to re-fetch the row to call the model.
  systemPrompt: string;
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
  return `delegate:${origin.parentRunId}:${origin.childTemplateSlug}:${origin.subtaskHash}`;
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
