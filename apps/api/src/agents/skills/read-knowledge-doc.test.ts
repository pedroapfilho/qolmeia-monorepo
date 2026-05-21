import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/storage", () => ({
  fetchAsset: vi.fn(),
}));

import { fetchAsset } from "../../lib/storage";

import { readKnowledgeDocSkill } from "./read-knowledge-doc";

describe("readKnowledgeDocSkill", () => {
  it("has the expected metadata", () => {
    expect(readKnowledgeDocSkill.id).toBe("readKnowledgeDoc");
    expect(readKnowledgeDocSkill.requiresApprovalDefault).toBe(false);
  });

  it("returns ok:false when the doc is not in the calling org", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { knowledgeDoc: { findFirst } } as never;

    const result = await readKnowledgeDocSkill.execute(
      { docId: "doc_ghost" },
      {
        agentInstanceId: "ai_1",
        dispatcher: { enqueueAndAwait: vi.fn() } as never,
        orgId: "org_1",
        parentRunArgs: {} as never,
        parentRunId: "run_test",
        prisma,
      },
    );

    expect(result.ok).toBe(false);
    expect(findFirst).toHaveBeenCalledWith({
      select: { contentType: true, r2Key: true, title: true },
      where: { id: "doc_ghost", orgId: "org_1" },
    });
  });

  it("returns the decoded content when the doc exists", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      contentType: "MARKDOWN",
      r2Key: "org_1/knowledge/abc.md",
      title: "Sample",
    });
    const prisma = { knowledgeDoc: { findFirst } } as never;
    vi.mocked(fetchAsset).mockResolvedValueOnce(new TextEncoder().encode("Hello world"));

    const result = await readKnowledgeDocSkill.execute(
      { docId: "doc_1" },
      {
        agentInstanceId: "ai_1",
        dispatcher: { enqueueAndAwait: vi.fn() } as never,
        orgId: "org_1",
        parentRunArgs: {} as never,
        parentRunId: "run_test",
        prisma,
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe("Hello world");
      expect(result.title).toBe("Sample");
    }
  });

  it("truncates content over 50_000 bytes and adds a notice", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      contentType: "MARKDOWN",
      r2Key: "org_1/knowledge/big.md",
      title: "Big",
    });
    const prisma = { knowledgeDoc: { findFirst } } as never;
    const big = new TextEncoder().encode("x".repeat(60_000));
    vi.mocked(fetchAsset).mockResolvedValueOnce(big);

    const result = await readKnowledgeDocSkill.execute(
      { docId: "doc_big" },
      {
        agentInstanceId: "ai_1",
        dispatcher: { enqueueAndAwait: vi.fn() } as never,
        orgId: "org_1",
        parentRunArgs: {} as never,
        parentRunId: "run_test",
        prisma,
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain("[... documento truncado");
      expect(result.content.length).toBeLessThanOrEqual(50_000 + 100);
    }
  });
});
