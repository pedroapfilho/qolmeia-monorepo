import type { MemoryAdapter, MemoryRecord, RetrieveArgs, ScoredRecord } from "#/lib/memory/adapter";

const EMBEDDING_MODEL = "@cf/baai/bge-m3";

type Bindings = { AI: Ai; VECTORIZE: VectorizeIndex };

const metaString = (value: unknown): string => (typeof value === "string" ? value : "");

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
        agentInstanceId: metaString(m.agentInstanceId),
        companyId: metaString(m.companyId),
        content: metaString(m.content),
        createdAt: Number(m.createdAt ?? 0),
        id: match.id,
        kind: metaString(m.kind),
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
    const result: unknown = await this.env.AI.run(EMBEDDING_MODEL, { text: [text] });
    const data =
      typeof result === "object" && result !== null && "data" in result ? result.data : undefined;
    const first: unknown = Array.isArray(data) ? data[0] : undefined;
    if (!Array.isArray(first)) {
      throw new TypeError("Workers AI embedding returned no vector");
    }
    const vector = first.filter((n): n is number => typeof n === "number");
    if (vector.length !== first.length) {
      throw new Error("Workers AI embedding returned a non-numeric vector");
    }
    return vector;
  }
}

export { VectorizeMemoryAdapter };
