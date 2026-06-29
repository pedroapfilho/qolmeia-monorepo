import type { MemoryAdapter, MemoryRecord, RetrieveArgs, ScoredRecord } from "#/lib/memory/adapter";

const EMBEDDING_MODEL = "@cf/baai/bge-m3";

type Bindings = { AI: Ai; VECTORIZE: VectorizeIndex };

type EmbedResult = { data?: Array<Array<number>> };

class VectorizeMemoryAdapter implements MemoryAdapter {
  constructor(private readonly env: Bindings) {}

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
