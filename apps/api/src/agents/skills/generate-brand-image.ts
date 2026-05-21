import { z } from "zod";

import { ingestGeneratedAsset } from "../../knowledge/brand-asset";
import { enrichPromptWithBrand, getBrandContext } from "../../knowledge/brand-context";
import { generateBrandImageBytes } from "../../lib/image-gen";
import { logger } from "../../lib/logger";

import { defineSkill } from "./types";

const generateBrandImageInput = z.object({
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3"]).default("1:1"),
  prompt: z.string().min(1).max(2000),
});

type GenerateBrandImageInput = z.infer<typeof generateBrandImageInput>;

type GenerateBrandImageOutput = { assetId: string; ok: true } | { error: string; ok: false };

const generateBrandImageSkill = defineSkill<GenerateBrandImageInput, GenerateBrandImageOutput>({
  description:
    "Gere uma imagem para o dono baseada no perfil do negócio (soul + brand assets). Use APENAS quando o dono pedir explicitamente. AT MOST 1 call por mensagem.",
  displayName: "Generate Brand Image",
  execute: async ({ aspectRatio, prompt }, ctx) => {
    try {
      const brand = await getBrandContext(ctx.orgId, ctx.prisma);
      const fullPrompt = enrichPromptWithBrand(prompt, aspectRatio, brand);
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
  // External, owner-visible side effect. On owner-side connectors the
  // approval rule still short-circuits to AUTO_APPROVED; flipping this to
  // true gates the skill behind explicit approval the moment a CUSTOMER
  // connector exists (Phase 5h+) so the agent can't burn image-gen budget
  // or post off-brand visuals into a customer thread.
  requiresApprovalDefault: true,
});

export { generateBrandImageSkill };
export type { GenerateBrandImageInput, GenerateBrandImageOutput };
