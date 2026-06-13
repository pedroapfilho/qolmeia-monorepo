// Memory adapter contract. Two implementations live behind this interface —
// `InMemoryMemoryAdapter` for local dev (no Cloudflare account required) and
// `VectorizeMemoryAdapter` for production. The selector in `./index.ts` picks
// based on bindings. The adapter owns embedding internally so callers don't
// know which embedding model is used.

type MemoryRecord = {
  agentInstanceId: string;
  companyId: string;
  content: string;
  createdAt: number;
  id: string;
  kind: string;
};

type RetrieveArgs = {
  agentInstanceId: string;
  minScore?: number;
  query: string;
  topK: number;
};

type ScoredRecord = MemoryRecord & { score: number };

type MemoryAdapter = {
  retrieve: (args: RetrieveArgs) => Promise<ReadonlyArray<ScoredRecord>>;
  upsert: (record: MemoryRecord) => Promise<void>;
};

export type { MemoryAdapter, MemoryRecord, RetrieveArgs, ScoredRecord };
