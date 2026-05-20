import { describe, expect, it, vi } from "vitest";

import { enrichPromptWithBrand, getBrandContext } from "./brand-context";

describe("getBrandContext", () => {
  it("returns empty context when there are no brand assets", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { brandAsset: { findMany } } as never;
    const ctx = await getBrandContext("org_1", prisma);
    expect(ctx).toEqual({ palette: [], styles: [], typography: undefined });
    expect(findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
      take: 3,
      where: { orgId: "org_1" },
    });
  });

  it("aggregates palette, styles, typography across multiple uploaded assets", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        metadata: {
          palette: ["#112233", "#445566"],
          styleDescriptors: ["minimalista", "moderno"],
          typography: "sans",
        },
      },
      {
        metadata: {
          palette: ["#112233", "#778899"], // overlaps + new
          styleDescriptors: ["clean"],
          typography: "serif", // first non-unknown wins
        },
      },
    ]);
    const prisma = { brandAsset: { findMany } } as never;
    const ctx = await getBrandContext("org_1", prisma);
    expect(ctx.palette.toSorted()).toEqual(["#112233", "#445566", "#778899"]);
    expect(ctx.styles.toSorted()).toEqual(["clean", "minimalista", "moderno"]);
    expect(ctx.typography).toBe("sans");
  });

  it("skips generated assets (metadata.source === 'generated')", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        metadata: {
          palette: ["#shouldBeIgnored"],
          source: "generated",
        },
      },
      {
        metadata: {
          palette: ["#FF0000"],
          styleDescriptors: ["bold"],
        },
      },
    ]);
    const prisma = { brandAsset: { findMany } } as never;
    const ctx = await getBrandContext("org_1", prisma);
    expect(ctx.palette).toEqual(["#FF0000"]);
    expect(ctx.styles).toEqual(["bold"]);
  });

  it("skips typography when value is 'unknown'", async () => {
    const findMany = vi.fn().mockResolvedValue([{ metadata: { typography: "unknown" } }]);
    const prisma = { brandAsset: { findMany } } as never;
    const ctx = await getBrandContext("org_1", prisma);
    expect(ctx.typography).toBeUndefined();
  });

  it("handles null metadata gracefully", async () => {
    const findMany = vi.fn().mockResolvedValue([{ metadata: null }, { metadata: undefined }]);
    const prisma = { brandAsset: { findMany } } as never;
    const ctx = await getBrandContext("org_1", prisma);
    expect(ctx).toEqual({ palette: [], styles: [], typography: undefined });
  });
});

describe("enrichPromptWithBrand", () => {
  it("returns the base prompt + aspect-ratio when brand context is empty", () => {
    const out = enrichPromptWithBrand("Banner de Black Friday", "1:1", {
      palette: [],
      styles: [],
      typography: undefined,
    });
    expect(out).toBe("Banner de Black Friday\n\nAspect ratio: 1:1.");
  });

  it("appends palette + styles + typography lines when present", () => {
    const out = enrichPromptWithBrand("Promo de fim de ano", "16:9", {
      palette: ["#FF0000", "#FFFFFF"],
      styles: ["minimalista"],
      typography: "sans",
    });
    expect(out).toContain("Promo de fim de ano");
    expect(out).toContain("Aspect ratio: 16:9.");
    expect(out).toContain("Brand palette: #FF0000, #FFFFFF.");
    expect(out).toContain("Brand style: minimalista.");
    expect(out).toContain("Typography hint: sans.");
  });
});
