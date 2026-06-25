import type { MemoryAdapter, MemoryRecord, RetrieveArgs, ScoredRecord } from "#/lib/memory/adapter";

const DIM = 256;

// oxlint-disable-next-line unicorn/number-literal-case -- oxfmt lower-cases; oxlint wants upper
const FNV_OFFSET = 0x81_1c_9d_c5;
// oxlint-disable-next-line unicorn/number-literal-case
const FNV_PRIME = 0x01_00_01_93;

const hash = (input: string): number => {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= input.codePointAt(i) ?? 0;
    h = Math.imul(h, FNV_PRIME);
  }
  return h;
};

const embed = (text: string): Array<number> => {
  const normalized = text.toLowerCase().replaceAll(/\s+/gv, " ").trim();
  const vec = Array.from({ length: DIM }, () => 0);
  if (normalized.length < 3) {
    const idx = Math.abs(hash(normalized)) % DIM;
    vec[idx] = (vec[idx] ?? 0) + 1;
  } else {
    for (let i = 0; i <= normalized.length - 3; i++) {
      const trigram = normalized.slice(i, i + 3);
      const idx = Math.abs(hash(trigram)) % DIM;
      vec[idx] = (vec[idx] ?? 0) + 1;
    }
  }
  let norm = 0;
  for (const v of vec) {
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < DIM; i++) {
      vec[i] = (vec[i] ?? 0) / norm;
    }
  }
  return vec;
};

const dot = (a: ReadonlyArray<number>, b: ReadonlyArray<number>): number => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
};

type Stored = { embedding: ReadonlyArray<number>; record: MemoryRecord };

class InMemoryMemoryAdapter implements MemoryAdapter {
  private readonly storage = new Map<string, Array<Stored>>();

  retrieve(args: RetrieveArgs): Promise<ReadonlyArray<ScoredRecord>> {
    const bucket = this.storage.get(args.agentInstanceId) ?? [];
    if (bucket.length === 0) {
      return Promise.resolve([]);
    }
    const queryEmbedding = embed(args.query);
    const min = args.minScore ?? 0.5;
    const scored: Array<ScoredRecord> = [];
    for (const entry of bucket) {
      const score = dot(queryEmbedding, entry.embedding);
      if (score >= min) {
        scored.push({ ...entry.record, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return Promise.resolve(scored.slice(0, args.topK));
  }

  upsert(record: MemoryRecord): Promise<void> {
    const bucket = this.storage.get(record.agentInstanceId) ?? [];
    const existing = bucket.findIndex((entry) => entry.record.id === record.id);
    const stored: Stored = { embedding: embed(record.content), record };
    if (existing === -1) {
      bucket.push(stored);
    } else {
      bucket[existing] = stored;
    }
    this.storage.set(record.agentInstanceId, bucket);
    return Promise.resolve();
  }
}

export { InMemoryMemoryAdapter };
