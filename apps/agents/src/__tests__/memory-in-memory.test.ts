import { beforeEach, describe, expect, it } from "vitest";

import { InMemoryMemoryAdapter } from "#/lib/memory/in-memory";

const AGENT_A = "agent-a";
const AGENT_B = "agent-b";

const record = (agentInstanceId: string, id: string, content: string, kind = "message") => ({
  agentInstanceId,
  companyId: "co_1",
  content,
  createdAt: Date.now(),
  id,
  kind,
});

let adapter: InMemoryMemoryAdapter;

beforeEach(() => {
  adapter = new InMemoryMemoryAdapter();
});

describe("InMemoryMemoryAdapter", () => {
  it("returns no matches before any upsert", async () => {
    const results = await adapter.retrieve({
      agentInstanceId: AGENT_A,
      query: "anything",
      topK: 5,
    });
    expect(results).toEqual([]);
  });

  it("retrieves an upserted record on a near-identical query", async () => {
    await adapter.upsert(record(AGENT_A, "1", "minha cor preferida é azul"));
    const results = await adapter.retrieve({
      agentInstanceId: AGENT_A,
      minScore: 0,
      query: "cor preferida",
      topK: 5,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.content).toContain("azul");
  });

  it("isolates per-agentInstanceId — agent B never sees agent A's records", async () => {
    await adapter.upsert(record(AGENT_A, "1", "alfa fact"));
    await adapter.upsert(record(AGENT_B, "2", "bravo fact"));
    const aResults = await adapter.retrieve({
      agentInstanceId: AGENT_A,
      minScore: 0,
      query: "fact",
      topK: 10,
    });
    const bResults = await adapter.retrieve({
      agentInstanceId: AGENT_B,
      minScore: 0,
      query: "fact",
      topK: 10,
    });
    expect(aResults.every((r) => r.content === "alfa fact")).toBe(true);
    expect(bResults.every((r) => r.content === "bravo fact")).toBe(true);
  });

  it("respects topK", async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        adapter.upsert(record(AGENT_A, String(i), `fact number ${i}`)),
      ),
    );
    const results = await adapter.retrieve({
      agentInstanceId: AGENT_A,
      minScore: 0,
      query: "fact",
      topK: 3,
    });
    expect(results.length).toBe(3);
  });

  it("upsert is idempotent on id (replaces, doesn't duplicate)", async () => {
    await adapter.upsert(record(AGENT_A, "1", "first version"));
    await adapter.upsert(record(AGENT_A, "1", "second version"));
    const results = await adapter.retrieve({
      agentInstanceId: AGENT_A,
      minScore: 0,
      query: "version",
      topK: 10,
    });
    expect(results.length).toBe(1);
    expect(results[0]?.content).toBe("second version");
  });
});
