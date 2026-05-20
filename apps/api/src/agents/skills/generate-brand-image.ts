import { z } from "zod";

import { ingestGeneratedAsset } from "../../knowledge/brand-asset";
import { generateBrandImageBytes } from "../../lib/image-gen";
import { logger } from "../../lib/logger";

import type { Skill } from "./types";

const generateBrandImageInput = z.object({
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3"]).default("1:1"),
  prompt: z.string().min(1).max(2000),
});

type GenerateBrandImageInput = z.infer<typeof generateBrandImageInput>;

type GenerateBrandImageOutput = { assetId: string; ok: true } | { error: string; ok: false };

type BrandAssetMetadata = {
  palette?: ReadonlyArray<string>;
  source?: string;
  styleDescriptors?: ReadonlyArray<string>;
  typography?: string;
} | null;

const generateBrandImageSkill: Skill<GenerateBrandImageInput, GenerateBrandImageOutput> = {
  description:
    "Gere uma imagem para o dono baseada no perfil do negócio (soul + brand assets). Use APENAS quando o dono pedir explicitamente. AT MOST 1 call por mensagem.",
  displayName: "Generate Brand Image",
  execute: async ({ aspectRatio, prompt }, ctx) => {
    try {
      const refRows = await ctx.prisma.brandAsset.findMany({
        orderBy: { createdAt: "desc" },
        select: { metadata: true },
        take: 3,
        where: { orgId: ctx.orgId },
      });

      const palette = new Set<string>();
      const styles = new Set<string>();
      let typography: string | undefined;
      for (const row of refRows) {
        const meta = row.metadata as BrandAssetMetadata;
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

      const brandLines: Array<string> = [];
      if (palette.size > 0) {
        brandLines.push(`Brand palette: ${[...palette].join(", ")}.`);
      }
      if (styles.size > 0) {
        brandLines.push(`Brand style: ${[...styles].join(", ")}.`);
      }
      if (typography) {
        brandLines.push(`Typography hint: ${typography}.`);
      }
      const fullPrompt = `${prompt}\n\nAspect ratio: ${aspectRatio}.${brandLines.length > 0 ? `\n\n${brandLines.join(" ")}` : ""}`;

      const bytes = await generateBrandImageBytes({ aspectRatio, prompt: fullPrompt });
      const { assetId } = await ingestGeneratedAsset({
        bytes,
        mimeType: "image/png",
        orgId: ctx.orgId,
        prisma: ctx.prisma,
        prompt,
      });
      return { assetId, ok: true };
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      logger.error({ error: message, orgId: ctx.orgId }, "generateBrandImage.failed");
      return { error: message, ok: false };
    }
  },
  id: "generateBrandImage",
  inputSchema: generateBrandImageInput,
  requiredConnectorTypes: [],
  requiresApprovalDefault: false,
};

export { generateBrandImageSkill };
export type { GenerateBrandImageInput, GenerateBrandImageOutput };
