import { z } from "zod";

import { buildSignedAssetUrl, uploadAsset } from "@/lib/r2";
import type { SkillContext, UnknownSkill } from "@/skills/registry";

// Image generation via OpenRouter's OpenAI-compatible images endpoint.
// Nano Banana Pro (`google/gemini-3-pro-image-preview`) is the default; the
// IMAGE_GEN_MODEL env var hot-swaps without a deploy.
//
// Bytes flow R2 → signed URL → message file part (the client renders it as
// an <img>). Asset metadata in D1 carries (company_id, sha256) for dedup.
const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images/generations";

const generateBrandImageInputSchema = z.object({
  aspectRatio: z.enum(["1:1", "16:9", "4:3", "9:16"]).optional(),
  prompt: z.string().min(1).max(2000),
});

type ImagesApiResponse = { data?: Array<{ b64_json?: string }> };

const aspectToSize = (aspect: string): string => {
  if (aspect === "16:9") {
    return "1536x1024";
  }
  if (aspect === "9:16") {
    return "1024x1536";
  }
  return "1024x1024";
};

const decodeBase64 = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.codePointAt(i) ?? 0;
  }
  return out;
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

type GenerateResult = { assetId: string; url: string } | { error: string };

const generateBrandImageSkill: UnknownSkill = {
  description:
    "Gera uma imagem alinhada à marca. Use quando o cliente pedir uma imagem, post visual, ou peça de design.",
  async execute(input: unknown, ctx: SkillContext): Promise<GenerateResult> {
    const { aspectRatio = "1:1", prompt } = generateBrandImageInputSchema.parse(input);

    let response: Response;
    try {
      response = await fetch(OPENROUTER_IMAGES_URL, {
        body: JSON.stringify({
          model: ctx.env.IMAGE_GEN_MODEL,
          n: 1,
          prompt,
          size: aspectToSize(aspectRatio),
        }),
        headers: {
          Authorization: `Bearer ${ctx.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": ctx.env.WORKER_PUBLIC_URL,
          "X-Title": "Qolmeia",
        },
        method: "POST",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: `Image gen network error: ${message}` };
    }

    if (!response.ok) {
      const body = await response.text();
      return { error: `Image gen HTTP ${response.status}: ${body.slice(0, 200)}` };
    }

    const json = (await response.json()) as ImagesApiResponse;
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) {
      return { error: "Image gen response missing data[0].b64_json" };
    }
    const bytes = decodeBase64(b64);
    const sha = await sha256Hex(bytes);
    const key = `org_${ctx.companyId}/${sha}.png`;
    const mime = "image/png";

    await uploadAsset(
      { ASSETS: ctx.env.ASSETS },
      { bytes, key, metadata: { aspectRatio, prompt }, mime },
    );

    // Dedup by (company_id, sha256). INSERT OR IGNORE handles concurrent
    // requests for the same image; the surviving id is whatever's already there.
    const assetId = crypto.randomUUID();
    const now = Date.now();
    await ctx.env.DB.prepare(
      `INSERT OR IGNORE INTO asset
         (id, company_id, kind, r2_key, sha256, mime, bytes, metadata, created_at)
       VALUES (?, ?, 'generated_image', ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        assetId,
        ctx.companyId,
        key,
        sha,
        mime,
        bytes.length,
        JSON.stringify({ aspectRatio, prompt }),
        now,
      )
      .run();
    const row = await ctx.env.DB.prepare(
      "SELECT id FROM asset WHERE company_id = ? AND sha256 = ? LIMIT 1",
    )
      .bind(ctx.companyId, sha)
      .first<{ id: string }>();
    const finalAssetId = row?.id ?? assetId;

    const url = await buildSignedAssetUrl(
      { ASSETS_SIGNING_KEY: ctx.env.ASSETS_SIGNING_KEY },
      ctx.env.WORKER_PUBLIC_URL,
      finalAssetId,
    );

    return { assetId: finalAssetId, url };
  },
  id: "generateBrandImage",
  inputSchema: generateBrandImageInputSchema,
};

export { generateBrandImageSkill };
