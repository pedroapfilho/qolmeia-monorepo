// Customer-side API surface for the company brief. Types mirror the agents
// API output; the channel list mirrors the server's channelEnum (small, stable).

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? "";

type ChannelValue =
  | "discord"
  | "email"
  | "instagram"
  | "other"
  | "slack"
  | "telegram"
  | "web"
  | "whatsapp";

const CHANNELS: ReadonlyArray<{ label: string; value: ChannelValue }> = [
  { label: "Instagram", value: "instagram" },
  { label: "WhatsApp", value: "whatsapp" },
  { label: "Telegram", value: "telegram" },
  { label: "E-mail", value: "email" },
  { label: "Site / Web", value: "web" },
  { label: "Slack", value: "slack" },
  { label: "Discord", value: "discord" },
  { label: "Outro", value: "other" },
];

type Brand = {
  palette?: string;
  references?: string;
  voice?: string;
};

type CompanyBrief = {
  audience?: string;
  brand?: Brand;
  channels?: ReadonlyArray<ChannelValue>;
  industry?: string;
  locale?: string;
  primaryGoal?: string;
  schemaVersion?: number;
};

type BriefFieldId =
  | "audience"
  | "brand.palette"
  | "brand.references"
  | "brand.voice"
  | "channels"
  | "industry"
  | "primaryGoal";

type BriefCompleteness = {
  filled: ReadonlyArray<BriefFieldId>;
  isComplete: boolean;
  missing: ReadonlyArray<BriefFieldId>;
  percent: number;
};

type CompanyResponse = {
  company: { brief: CompanyBrief; id: string; slug: string; status: string };
  completeness: BriefCompleteness;
};

type BriefPatch = {
  audience?: string;
  brand?: Brand;
  channels?: ReadonlyArray<ChannelValue>;
  industry?: string;
  primaryGoal?: string;
};

const apiUrl = (path: string): string => `${AGENTS_URL}${path}`;

const fetchCompany = async (): Promise<CompanyResponse> => {
  const res = await fetch(apiUrl("/api/me/company"), { credentials: "include" });
  if (!res.ok) {
    throw new Error(`GET /api/me/company failed (${res.status})`);
  }
  return (await res.json()) as CompanyResponse;
};

const patchCompanyBrief = async (patch: BriefPatch): Promise<CompanyResponse> => {
  const res = await fetch(apiUrl("/api/me/company"), {
    body: JSON.stringify(patch),
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
  if (!res.ok) {
    throw new Error(`PATCH /api/me/company failed (${res.status})`);
  }
  return (await res.json()) as CompanyResponse;
};

type BrandCategory = "logo" | "other" | "post" | "reference";

const BRAND_CATEGORIES: ReadonlyArray<{ label: string; value: BrandCategory }> = [
  { label: "Logotipo", value: "logo" },
  { label: "Post de exemplo", value: "post" },
  { label: "Referência visual", value: "reference" },
  { label: "Outro", value: "other" },
];

const BRAND_CATEGORY_LABEL: Record<BrandCategory, string> = {
  logo: "Logotipo",
  other: "Outro",
  post: "Post de exemplo",
  reference: "Referência visual",
};

type BrandAsset = {
  category: BrandCategory;
  createdAt: string;
  id: string;
  mimeType: string;
  name: string | null;
  url: string;
};

const fetchBrandAssets = async (): Promise<Array<BrandAsset>> => {
  const res = await fetch(apiUrl("/api/me/brand-assets"), { credentials: "include" });
  if (!res.ok) {
    throw new Error(`GET /api/me/brand-assets failed (${res.status})`);
  }
  return ((await res.json()) as { items: Array<BrandAsset> }).items;
};

const uploadBrandAsset = async (file: File, category: BrandCategory): Promise<void> => {
  const form = new FormData();
  form.append("file", file);
  form.append("category", category);
  const res = await fetch(apiUrl("/api/me/brand-assets"), {
    body: form,
    credentials: "include",
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`POST /api/me/brand-assets failed (${res.status})`);
  }
};

const deleteBrandAsset = async (id: string): Promise<void> => {
  const res = await fetch(apiUrl(`/api/me/brand-assets/${id}`), {
    credentials: "include",
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(`DELETE /api/me/brand-assets/${id} failed (${res.status})`);
  }
};

export {
  BRAND_CATEGORIES,
  BRAND_CATEGORY_LABEL,
  CHANNELS,
  deleteBrandAsset,
  fetchBrandAssets,
  fetchCompany,
  patchCompanyBrief,
  uploadBrandAsset,
};
export type {
  BrandAsset,
  BrandCategory,
  BriefCompleteness,
  BriefFieldId,
  BriefPatch,
  ChannelValue,
  CompanyBrief,
  CompanyResponse,
};
