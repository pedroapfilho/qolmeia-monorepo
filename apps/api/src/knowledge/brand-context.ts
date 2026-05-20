import type { PrismaClient } from "@repo/db";

type BrandContext = {
  palette: ReadonlyArray<string>;
  styles: ReadonlyArray<string>;
  typography?: string;
};

type BrandAssetMetadataShape = {
  palette?: ReadonlyArray<string>;
  source?: string;
  styleDescriptors?: ReadonlyArray<string>;
  typography?: string;
};

// Reads the 3 most-recent uploaded BrandAssets for an org and aggregates
// their visual metadata (palette, styles, typography). Generated assets
// (metadata.source === "generated") are skipped — they were created by
// the agent and contain no original brand intent.
const getBrandContext = async (
  orgId: string,
  prisma: Pick<PrismaClient, "brandAsset">,
): Promise<BrandContext> => {
  const rows = await prisma.brandAsset.findMany({
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
    take: 3,
    where: { orgId },
  });

  const palette = new Set<string>();
  const styles = new Set<string>();
  let typography: string | undefined;

  for (const row of rows) {
    const meta = row.metadata as BrandAssetMetadataShape | null;
    if (!meta || meta.source === "generated") {
      continue;
    }
    for (const hex of meta.palette ?? []) {
      palette.add(hex);
    }
    for (const s of meta.styleDescriptors ?? []) {
      styles.add(s);
    }
    if (!typography && meta.typography && meta.typography !== "unknown") {
      typography = meta.typography;
    }
  }

  return { palette: [...palette], styles: [...styles], typography };
};

// Composes the agent's user prompt with brand context + aspect ratio hints.
// Returns the enriched string that gets sent to the image-gen model.
const enrichPromptWithBrand = (
  prompt: string,
  aspectRatio: string,
  brand: BrandContext,
): string => {
  const brandLines: Array<string> = [];
  if (brand.palette.length > 0) {
    brandLines.push(`Brand palette: ${brand.palette.join(", ")}.`);
  }
  if (brand.styles.length > 0) {
    brandLines.push(`Brand style: ${brand.styles.join(", ")}.`);
  }
  if (brand.typography) {
    brandLines.push(`Typography hint: ${brand.typography}.`);
  }
  return `${prompt}\n\nAspect ratio: ${aspectRatio}.${brandLines.length > 0 ? `\n\n${brandLines.join(" ")}` : ""}`;
};

export { enrichPromptWithBrand, getBrandContext };
export type { BrandContext };
