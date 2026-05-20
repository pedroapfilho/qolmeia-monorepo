import { z } from "zod";

import { applySoulUpdate } from "../../knowledge/apply";

import { defineSkill } from "./types";

const extractSoulInput = z.object({
  brandVoice: z.string().nullable(),
  differentiator: z.string().nullable(),
  location: z.string().nullable(),
  targetAudience: z.string().nullable(),
  whatYouDo: z.string().nullable(),
});

type ExtractSoulInput = z.infer<typeof extractSoulInput>;

type ExtractSoulOutput = {
  capturedFields: ReadonlyArray<keyof ExtractSoulInput>;
};

const extractSoulSkill = defineSkill<ExtractSoulInput, ExtractSoulOutput>({
  description:
    "Atualize os 5 campos do perfil do dono. Use SOMENTE quando a mensagem trouxer info ou correção. Campos não mencionados ficam null.",
  displayName: "Extract Soul",
  execute: async (args, ctx) => {
    const out = await applySoulUpdate(ctx.orgId, args, ctx.prisma);
    return { capturedFields: out.capturedFields };
  },
  id: "extractSoul",
  inputSchema: extractSoulInput,
  requiredConnectorTypes: [],
  requiresApprovalDefault: false,
});

export { extractSoulSkill };
export type { ExtractSoulInput, ExtractSoulOutput };
