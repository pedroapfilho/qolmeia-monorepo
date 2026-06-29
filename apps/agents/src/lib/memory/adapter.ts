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
