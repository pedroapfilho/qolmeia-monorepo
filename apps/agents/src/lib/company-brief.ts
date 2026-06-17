import { z } from "zod";

// The typed shape the Planner crystallizes during onboarding. Versioned so a
// future schema change has a migration path (read old; transform; write new).
// Partial during the debrief (the Planner fills in as it learns); the full
// schema validates at proposeTeam time.

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

// Merges two briefs — partial updates land on top of existing data, never
// overwriting a field with an undefined.
const mergeBrief = (
  existing: Partial<CompanyBrief>,
  updates: Partial<CompanyBrief>,
): CompanyBrief => {
  const merged: Partial<CompanyBrief> = { ...existing };
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  const parsed = companyBriefSchema.partial().parse(merged);
  return {
    ...parsed,
    locale: parsed.locale ?? "pt-BR",
    schemaVersion: parsed.schemaVersion ?? BRIEF_SCHEMA_VERSION,
  } as CompanyBrief;
};

const parseBrief = (raw: string | null | undefined): Partial<CompanyBrief> => {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = companyBriefSchema.partial().safeParse(parsed);
    return result.success ? result.data : {};
  } catch {
    return {};
  }
};

// True when the brief carries no meaningful business info — only then does
// the Planner open the conversation. locale/schemaVersion are defaults.
const isBriefEmpty = (brief: Partial<CompanyBrief> | null | undefined): boolean => {
  if (!brief) {
    return true;
  }
  const brand = brief.brand;
  const hasBrand = !!brand && (!!brand.palette || !!brand.voice || !!brand.references);
  return (
    !brief.industry &&
    !brief.primaryGoal &&
    !brief.audience &&
    (!brief.channels || brief.channels.length === 0) &&
    !hasBrand
  );
};

// The fields the customer must fill before the Correspondent stops asking.
// Order is the display/ask order. brand.* are nested under `brand`.
const BRIEF_REQUIRED_FIELDS = [
  "industry",
  "primaryGoal",
  "audience",
  "channels",
  "brand.voice",
  "brand.palette",
  "brand.references",
] as const;

type BriefFieldId = (typeof BRIEF_REQUIRED_FIELDS)[number];

// pt-BR labels for prompts and any server-side rendering. The client mirrors
// these in its own form copy.
const BRIEF_FIELD_LABELS: Record<BriefFieldId, string> = {
  audience: "Público-alvo",
  "brand.palette": "Cores da marca",
  "brand.references": "Referências de marca",
  "brand.voice": "Tom da marca",
  channels: "Canais",
  industry: "Setor",
  primaryGoal: "Objetivo principal (próximos 3 meses)",
};

const BRIEF_FIELD_FILLED: Record<BriefFieldId, (brief: Partial<CompanyBrief>) => boolean> = {
  audience: (brief) => !!brief.audience,
  "brand.palette": (brief) => !!brief.brand?.palette,
  "brand.references": (brief) => !!brief.brand?.references,
  "brand.voice": (brief) => !!brief.brand?.voice,
  channels: (brief) => !!brief.channels && brief.channels.length > 0,
  industry: (brief) => !!brief.industry,
  primaryGoal: (brief) => !!brief.primaryGoal,
};

const isBriefFieldFilled = (brief: Partial<CompanyBrief>, field: BriefFieldId): boolean =>
  BRIEF_FIELD_FILLED[field](brief);

type BriefCompleteness = {
  filled: Array<BriefFieldId>;
  isComplete: boolean;
  missing: Array<BriefFieldId>;
  percent: number;
};

// Completeness over the required-field set — the single definition both the
// API (what the form shows) and the Correspondent prompt (what to ask next)
// read from, so they never drift.
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
  BRIEF_FIELD_LABELS,
  BRIEF_REQUIRED_FIELDS,
  BRIEF_SCHEMA_VERSION,
  briefCompleteness,
  companyBriefSchema,
  isBriefEmpty,
  mergeBrief,
  parseBrief,
};
export type { BriefCompleteness, BriefFieldId, CompanyBrief, CompanyBriefPartial };
