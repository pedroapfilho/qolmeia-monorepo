import type { MemoryAdapter } from "@/lib/memory/adapter";
import { InMemoryMemoryAdapter } from "@/lib/memory/in-memory";

// Production backend (Vectorize + Workers AI) lands in T7. Until then the
// selector always returns the in-memory backend — local dev needs no
// Cloudflare account; tests use the same path. The selector mirrors
// `getModel`'s "Cloudflare prod / local dev" split.
const getMemoryAdapter = (_env: Env): MemoryAdapter => {
  return new InMemoryMemoryAdapter();
};

export { getMemoryAdapter };
export type { MemoryAdapter, MemoryRecord, RetrieveArgs, ScoredRecord } from "@/lib/memory/adapter";
