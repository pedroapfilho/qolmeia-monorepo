import { z } from "zod";

import type { Skill } from "./types";

const labelBrandAssetInput = z.object({
  assetId: z.string().min(1),
  palette: z
    .array(z.string().regex(/^#[0-9A-Fa-f]{6}$/iv))
    .min(1)
    .max(8),
  styleDescriptors: z.array(z.string().min(1)).min(1).max(6),
  typography: z.enum(["serif", "sans", "script", "handwritten", "decorative", "unknown"]),
});

type LabelBrandAssetInput = z.infer<typeof labelBrandAssetInput>;

type LabelBrandAssetOutput = { ok: true };

const labelBrandAssetSkill: Skill<LabelBrandAssetInput, LabelBrandAssetOutput> = {
  description:
    "Anote metadados visuais de UM asset que o dono enviou. Use um assetId de 'Novos assets'. Chame uma vez por assetId.",
  displayName: "Label Brand Asset",
  execute: async (args, ctx) => {
    await ctx.prisma.brandAsset.update({
      data: {
        metadata: {
          palette: args.palette,
          styleDescriptors: args.styleDescriptors,
          typography: args.typography,
        },
      },
      where: { id: args.assetId },
    });
    return { ok: true };
  },
  id: "labelBrandAsset",
  inputSchema: labelBrandAssetInput,
  requiredConnectorTypes: [],
  requiresApprovalDefault: false,
};

export { labelBrandAssetSkill };
export type { LabelBrandAssetInput, LabelBrandAssetOutput };
