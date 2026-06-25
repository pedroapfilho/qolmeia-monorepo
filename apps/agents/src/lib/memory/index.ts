import type { MemoryAdapter } from "#/lib/memory/adapter";
import { InMemoryMemoryAdapter } from "#/lib/memory/in-memory";
import { VectorizeMemoryAdapter } from "#/lib/memory/vectorize";

let inMemorySingleton: InMemoryMemoryAdapter | undefined;

const getMemoryAdapter = (env: Env): MemoryAdapter => {
  if (env.AI && env.VECTORIZE) {
    return new VectorizeMemoryAdapter({ AI: env.AI, VECTORIZE: env.VECTORIZE });
  }
  if (!inMemorySingleton) {
    inMemorySingleton = new InMemoryMemoryAdapter();
  }
  return inMemorySingleton;
};

export { getMemoryAdapter };
export type { MemoryAdapter, ScoredRecord } from "#/lib/memory/adapter";
