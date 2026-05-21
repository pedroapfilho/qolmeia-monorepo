import { z } from "zod";

import { logger } from "../../lib/logger";

import { defineSkill } from "./types";

const draftMarketingStrategyInput = z.object({
  audience: z.string().min(1).max(500).optional(),
  goal: z.string().min(1).max(500),
  occasion: z.string().min(1).max(200).optional(),
});

type DraftMarketingStrategyInput = z.infer<typeof draftMarketingStrategyInput>;

type DraftMarketingStrategyOutput = {
  channelMix: ReadonlyArray<string>;
  copyDirection: string;
  headline: string;
  ok: true;
  visualConcept: string;
};

const draftMarketingStrategySkill = defineSkill<
  DraftMarketingStrategyInput,
  DraftMarketingStrategyOutput
>({
  description:
    "Rascunhe uma estratégia de marketing curta para o objetivo dado (ex: Black Friday, lançamento de serviço, fidelização). Retorna headline + direção de copy + conceito visual + canais sugeridos. Stub v0 — produz estratégia genérica em pt-BR; iterações futuras incorporam o perfil do negócio.",
  displayName: "Draft Marketing Strategy",
  execute: ({ audience, goal, occasion }, ctx) => {
    logger.info(
      { audience: audience ?? null, goal, occasion: occasion ?? null, orgId: ctx.orgId },
      "draftMarketingStrategy.invoked",
    );

    // Stub v0: produces a generic-but-coherent strategy. The richness comes
    // from the Designer's brand-context aggregation when this gets combined
    // into actual visual output.
    const headlinePrefix = occasion ? `${occasion}: ` : "";
    const audienceHint = audience ? ` para ${audience}` : "";
    return Promise.resolve({
      channelMix: ["Instagram Stories", "WhatsApp broadcast", "Cartaz na loja"],
      copyDirection: `Tom acolhedor e direto. Frase de abertura curta, call-to-action claro no final. Mencionar exclusividade ou prazo${audienceHint}. Evitar jargão.`,
      headline: `${headlinePrefix}${goal} ${audienceHint}`.trim(),
      ok: true as const,
      visualConcept: `Composição centrada com paleta da marca, espaço para texto à direita. ${occasion ? `Elementos visuais sugerindo ${occasion}. ` : ""}Foto de produto ou pessoa em primeiro plano, fundo limpo.`,
    });
  },
  id: "draftMarketingStrategy",
  inputSchema: draftMarketingStrategyInput,
  requiredConnectorTypes: [],
  // Produces external-facing copy/strategy. Owner-side runs still auto-
  // approve; CUSTOMER-side runs require approval before the draft is acted
  // on. Future iterations may split this into draft (no approval) +
  // publish (approval) once the runtime separates proposal from execution.
  requiresApprovalDefault: true,
});

export { draftMarketingStrategySkill };
export type { DraftMarketingStrategyInput, DraftMarketingStrategyOutput };
