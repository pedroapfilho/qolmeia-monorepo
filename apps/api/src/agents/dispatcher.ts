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

type AgentDispatchArgs = {
  agentInstance: AgentInstance;
  currentContext: string;
  dispatcher: AgentDispatcher;
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

export { createSerialDispatcher };
export type {
  AgentDispatcher,
  AgentDispatchArgs,
  AgentRunInput,
  AgentRunner,
  AgentRunResult,
  AssetSummary,
  ExistingAssetSummary,
};
