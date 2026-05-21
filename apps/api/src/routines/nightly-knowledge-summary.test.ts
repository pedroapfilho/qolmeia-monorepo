import { describe, expect, it, vi } from "vitest";

import { nightlyKnowledgeSummary } from "./nightly-knowledge-summary";

const makePrisma = (
  docs: ReadonlyArray<{
    createdAt: Date;
    summary: string;
    tags: ReadonlyArray<string>;
    title: string;
  }>,
) => {
  const findMany = vi.fn().mockResolvedValue(docs);
  return {
    knowledgeDoc: { findMany },
    mocks: { findMany },
    organization: { findUnique: vi.fn() },
  };
};

describe("nightlyKnowledgeSummary", () => {
  it("falls back to the no-news prompt when there are zero recent docs", async () => {
    const prisma = makePrisma([]);
    const prompt = await nightlyKnowledgeSummary.buildPrompt(
      { maxDocs: 5 },
      { orgId: "org_1", prisma: prisma as never },
    );
    expect(prompt).toContain("Nenhum documento novo");
    expect(prompt).toContain("últimas 24h");
    expect(prompt).toContain("pt-BR");
  });

  it("queries KnowledgeDoc rows for the last 24h, scoped to the org, with the configured maxDocs", async () => {
    const prisma = makePrisma([
      { createdAt: new Date(), summary: "Sumário 1", tags: ["x"], title: "Doc A" },
    ]);
    await nightlyKnowledgeSummary.buildPrompt(
      { maxDocs: 3 },
      { orgId: "org_42", prisma: prisma as never },
    );
    expect(prisma.mocks.findMany).toHaveBeenCalledOnce();
    const call = prisma.mocks.findMany.mock.calls[0]![0] as {
      take: number;
      where: { createdAt: { gte: Date }; orgId: string };
    };
    expect(call.take).toBe(3);
    expect(call.where.orgId).toBe("org_42");
    // gte should be ~24h ago, give it a generous 60s margin for test wall-clock jitter.
    const expectedSince = Date.now() - 24 * 60 * 60 * 1000;
    expect(Math.abs(call.where.createdAt.gte.getTime() - expectedSince)).toBeLessThan(60_000);
  });

  it("formats the docs into a numbered list with title, tags, and summary", async () => {
    const prisma = makePrisma([
      {
        createdAt: new Date(),
        summary: "Resumo do tom de voz da marca.",
        tags: ["brand", "voice"],
        title: "Tom de voz",
      },
      {
        createdAt: new Date(),
        summary: "Lista de serviços e preços.",
        tags: [],
        title: "Cardápio",
      },
    ]);
    const prompt = await nightlyKnowledgeSummary.buildPrompt(
      { maxDocs: 5 },
      { orgId: "org_1", prisma: prisma as never },
    );
    expect(prompt).toContain("1. Tom de voz [brand, voice]");
    expect(prompt).toContain("Resumo do tom de voz da marca.");
    expect(prompt).toContain("2. Cardápio");
    expect(prompt).not.toContain("2. Cardápio [");
    expect(prompt).toContain("2 documento(s)");
  });

  it("defaults maxDocs to 5 when the config is malformed", async () => {
    const prisma = makePrisma([]);
    await nightlyKnowledgeSummary.buildPrompt({}, { orgId: "o", prisma: prisma as never });
    const callA = prisma.mocks.findMany.mock.calls[0]![0] as { take: number };
    expect(callA.take).toBe(5);

    await nightlyKnowledgeSummary.buildPrompt(
      { maxDocs: -3 },
      { orgId: "o", prisma: prisma as never },
    );
    const callB = prisma.mocks.findMany.mock.calls[1]![0] as { take: number };
    expect(callB.take).toBe(5);

    await nightlyKnowledgeSummary.buildPrompt({ maxDocs: "ten" } as never, {
      orgId: "o",
      prisma: prisma as never,
    });
    const callC = prisma.mocks.findMany.mock.calls[2]![0] as { take: number };
    expect(callC.take).toBe(5);
  });

  it("exposes the canonical name, default agent template, and cron schedule", () => {
    expect(nightlyKnowledgeSummary.name).toBe("nightly-knowledge-summary");
    expect(nightlyKnowledgeSummary.defaultAgentTemplate).toBe("controller");
    expect(nightlyKnowledgeSummary.defaultSchedule).toBe("0 3 * * *");
    expect(nightlyKnowledgeSummary.defaultConfig).toEqual({ maxDocs: 5 });
  });
});
