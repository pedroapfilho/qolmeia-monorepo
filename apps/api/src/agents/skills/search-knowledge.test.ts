import { describe, expect, it, vi } from "vitest";

import { searchKnowledgeSkill } from "./search-knowledge";

describe("searchKnowledgeSkill", () => {
  it("has the expected metadata", () => {
    expect(searchKnowledgeSkill.id).toBe("searchKnowledge");
    expect(searchKnowledgeSkill.displayName).toBe("Search Knowledge");
    expect(searchKnowledgeSkill.requiresApprovalDefault).toBe(false);
  });

  it("validates input via Zod (query length + limit bounds)", () => {
    expect(searchKnowledgeSkill.inputSchema.parse({ query: "foo" }).limit).toBe(5);
    expect(searchKnowledgeSkill.inputSchema.parse({ limit: 10, query: "x" }).limit).toBe(10);
    expect(() => searchKnowledgeSkill.inputSchema.parse({ query: "" })).toThrow();
    expect(() => searchKnowledgeSkill.inputSchema.parse({ limit: 50, query: "x" })).toThrow();
  });

  it("queries knowledgeDoc.findMany scoped to orgId with OR over title/summary/tags", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ id: "doc_1", summary: "s1", tags: ["x"], title: "Title 1" }]);
    const prisma = { knowledgeDoc: { findMany } } as never;

    const result = await searchKnowledgeSkill.execute(
      { limit: 5, query: "voice" },
      {
        agentInstanceId: "ai_1",
        dispatcher: { enqueueAndAwait: vi.fn() } as never,
        orgId: "org_1",
        parentRunArgs: {} as never,
        parentRunId: "run_test",
        prisma,
      },
    );

    expect(findMany).toHaveBeenCalledOnce();
    const args = findMany.mock.calls[0]![0] as {
      take: number;
      where: { OR: Array<unknown>; orgId: string };
    };
    expect(args.take).toBe(5);
    expect(args.where.orgId).toBe("org_1");
    expect(args.where.OR).toHaveLength(3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]!.id).toBe("doc_1");
    }
  });
});
