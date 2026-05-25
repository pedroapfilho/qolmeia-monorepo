import type { MemoryAdapter } from "@/lib/memory/adapter";
import { InMemoryMemoryAdapter } from "@/lib/memory/in-memory";
import { VectorizeMemoryAdapter } from "@/lib/memory/vectorize";

// Same shape as `getModel`: production backend when the Cloudflare bindings
// exist, in-memory fallback otherwise. The bindings are declared optional in
// env.d.ts and added to wrangler.jsonc only at deploy (P2 T11 checklist), so
// local dev sees `undefined` and goes through the in-memory path.
const getMemoryAdapter = (env: Env): MemoryAdapter => {
  if (env.AI && env.VECTORIZE) {
    return new VectorizeMemoryAdapter({ AI: env.AI, VECTORIZE: env.VECTORIZE });
  }
  return new InMemoryMemoryAdapter();
};

export { getMemoryAdapter };
export type { MemoryAdapter, MemoryRecord, RetrieveArgs, ScoredRecord } from "@/lib/memory/adapter";
