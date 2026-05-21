import { describe, expect, it, vi } from "vitest";

import { getRecentActivity } from "./query";

describe("getRecentActivity", () => {
  it("queries by orgId, newest first, with the default limit", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { activityLog: { findMany } } as never;

    await getRecentActivity({ orgId: "org_1", prisma });

    expect(findMany).toHaveBeenCalledOnce();
    const arg = findMany.mock.calls[0]![0] as {
      orderBy: { createdAt: string };
      take: number;
      where: { orgId: string };
    };
    expect(arg.where.orgId).toBe("org_1");
    expect(arg.orderBy.createdAt).toBe("desc");
    expect(arg.take).toBe(50);
  });

  it("honours an explicit limit", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { activityLog: { findMany } } as never;

    await getRecentActivity({ limit: 10, orgId: "org_1", prisma });

    const arg = findMany.mock.calls[0]![0] as { take: number };
    expect(arg.take).toBe(10);
  });

  it("clamps an oversized limit to the safety cap", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { activityLog: { findMany } } as never;

    await getRecentActivity({ limit: 10_000, orgId: "org_1", prisma });

    const arg = findMany.mock.calls[0]![0] as { take: number };
    expect(arg.take).toBe(500);
  });

  it("clamps a zero/negative limit to at least 1", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { activityLog: { findMany } } as never;

    await getRecentActivity({ limit: 0, orgId: "org_1", prisma });

    const arg = findMany.mock.calls[0]![0] as { take: number };
    expect(arg.take).toBe(1);
  });
});
