import { z } from "zod";

const BRIEF_SCHEMA_VERSION = 1;

const channelEnum = z.enum([
  "discord",
  "email",
  "instagram",
  "other",
  "slack",
  "telegram",
  "web",
  "whatsapp",
]);

const brandSchema = z.object({
  palette: z
    .string()
    .max(200)
    .optional()
    .describe("Cores principais e secundárias (texto curto: hex ou nomes)."),
  references: z.string().max(500).optional().describe("Marcas ou estilos de inspiração."),
  voice: z
    .string()
    .max(200)
    .optional()
    .describe("Tom da marca (formal, descontraído, técnico, etc.)."),
});

const companyBriefSchema = z.object({
  audience: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe("Quem é o cliente final do negócio (perfil, dor, contexto)."),
  brand: brandSchema.optional(),
  channels: z.array(channelEnum).optional().describe("Canais onde o negócio quer (ou já) atua."),
  industry: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Setor do negócio (ex: alimentação, beleza, SaaS)."),
  locale: z.string().default("pt-BR"),
  primaryGoal: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe("Objetivo principal nos próximos 3 meses."),
  schemaVersion: z.number().default(BRIEF_SCHEMA_VERSION),
});

type CompanyBrief = z.infer<typeof companyBriefSchema>;
type CompanyBriefPartial = z.infer<typeof companyBriefSchema>;

const mergeBrief = (
  existing: Partial<CompanyBrief>,
  updates: Partial<CompanyBrief>,
): CompanyBrief => {
  const definedUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined),
  );
  const parsed = companyBriefSchema.partial().parse({ ...existing, ...definedUpdates });
  return {
    ...parsed,
    locale: parsed.locale ?? "pt-BR",
    schemaVersion: parsed.schemaVersion ?? BRIEF_SCHEMA_VERSION,
  };
};

const hasText = (value: string | undefined): boolean => value !== undefined && value !== "";

const jsonValueSchema = z.json();
type BriefInput = Parameters<typeof jsonValueSchema.safeParse>[0];

const parseBrief = (raw: BriefInput): Partial<CompanyBrief> => {
  if (raw === null || raw === undefined || raw === "") {
    return {};
  }
  try {
    const parsed = typeof raw === "string" ? jsonValueSchema.parse(JSON.parse(raw)) : raw;
    const result = companyBriefSchema.partial().safeParse(parsed);
    return result.success ? result.data : {};
  } catch {
    return {};
  }
};

const isBriefEmpty = (brief: Partial<CompanyBrief> | null | undefined): boolean => {
  if (!brief) {
    return true;
  }
  const brand = brief.brand;
  const hasBrand =
    brand !== undefined &&
    (hasText(brand.palette) || hasText(brand.voice) || hasText(brand.references));
  return (
    !hasText(brief.industry) && !hasText(brief.primaryGoal) && !hasText(brief.audience) && !hasBrand
  );
};

const BRIEF_REQUIRED_FIELDS = [
  "industry",
  "primaryGoal",
  "audience",
  "brand.voice",
  "brand.palette",
  "brand.references",
] as const;

type BriefFieldId = (typeof BRIEF_REQUIRED_FIELDS)[number];

const BRIEF_FIELD_FILLED = {
  audience: (brief) => hasText(brief.audience),
  "brand.palette": (brief) => hasText(brief.brand?.palette),
  "brand.references": (brief) => hasText(brief.brand?.references),
  "brand.voice": (brief) => hasText(brief.brand?.voice),
  industry: (brief) => hasText(brief.industry),
  primaryGoal: (brief) => hasText(brief.primaryGoal),
} satisfies Record<BriefFieldId, (brief: Partial<CompanyBrief>) => boolean>;

const isBriefFieldFilled = (brief: Partial<CompanyBrief>, field: BriefFieldId): boolean =>
  BRIEF_FIELD_FILLED[field](brief);

type BriefCompleteness = {
  filled: Array<BriefFieldId>;
  isComplete: boolean;
  missing: Array<BriefFieldId>;
  percent: number;
};

const briefCompleteness = (brief: Partial<CompanyBrief> | null | undefined): BriefCompleteness => {
  const safe = brief ?? {};
  const filled: Array<BriefFieldId> = [];
  const missing: Array<BriefFieldId> = [];
  for (const field of BRIEF_REQUIRED_FIELDS) {
    if (isBriefFieldFilled(safe, field)) {
      filled.push(field);
    } else {
      missing.push(field);
    }
  }
  return {
    filled,
    isComplete: missing.length === 0,
    missing,
    percent: Math.round((filled.length / BRIEF_REQUIRED_FIELDS.length) * 100),
  };
};

export {
  BRIEF_SCHEMA_VERSION,
  briefCompleteness,
  companyBriefSchema,
  isBriefEmpty,
  mergeBrief,
  parseBrief,
};
export type { BriefCompleteness, BriefFieldId, CompanyBrief, CompanyBriefPartial };
