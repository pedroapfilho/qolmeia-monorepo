import type { MemoryAdapter, MemoryRecord, RetrieveArgs, ScoredRecord } from "@/lib/memory/adapter";

// Production memory backend — Workers AI for embeddings, Vectorize for
// storage and ANN retrieval. Per-agent isolation comes from a metadata
// filter at query time; the upsert *must* set the same metadata or
// retrieval forgets where the record belongs.
//
// bge-m3 is multilingual (pt-BR covered) and returns 1024-dim vectors. The
// Vectorize index must be created with `--dimensions=1024 --metric=cosine`.
const EMBEDDING_MODEL = "@cf/baai/bge-m3";

type Bindings = { AI: Ai; VECTORIZE: VectorizeIndex };

type EmbedResult = { data?: Array<Array<number>> };

class VectorizeMemoryAdapter implements MemoryAdapter {
  constructor(private readonly env: Bindings) {}

  // MemoryAdapter interface method — call sites dispatch through the interface.
  // fallow-ignore-next-line unused-class-member
  async retrieve(args: RetrieveArgs): Promise<ReadonlyArray<ScoredRecord>> {
    const vector = await this.embed(args.query);
    const result = await this.env.VECTORIZE.query(vector, {
      filter: { agentInstanceId: args.agentInstanceId },
      returnMetadata: "all",
      topK: args.topK,
    });
    const min = args.minScore ?? 0.5;
    const records: Array<ScoredRecord> = [];
    for (const match of result.matches) {
      if (match.score < min) {
        continue;
      }
      const m = match.metadata ?? {};
      records.push({
        agentInstanceId: String(m.agentInstanceId ?? ""),
        companyId: String(m.companyId ?? ""),
        content: String(m.content ?? ""),
        createdAt: Number(m.createdAt ?? 0),
        id: match.id,
        kind: String(m.kind ?? ""),
        score: match.score,
      });
    }
    return records;
  }

  // MemoryAdapter interface method — call sites dispatch through the interface.
  // fallow-ignore-next-line unused-class-member
  async upsert(record: MemoryRecord): Promise<void> {
    const values = await this.embed(record.content);
    await this.env.VECTORIZE.upsert([
      {
        id: record.id,
        metadata: {
          agentInstanceId: record.agentInstanceId,
          companyId: record.companyId,
          content: record.content,
          createdAt: record.createdAt,
          kind: record.kind,
        },
        values,
      },
    ]);
  }

  private async embed(text: string): Promise<Array<number>> {
    const result = (await this.env.AI.run(EMBEDDING_MODEL, { text: [text] })) as EmbedResult;
    const vector = result.data?.[0];
    if (!vector) {
      throw new Error("Workers AI embedding returned no vector");
    }
    return vector;
  }
}

export { VectorizeMemoryAdapter };
