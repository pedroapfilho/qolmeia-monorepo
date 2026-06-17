import { z } from "zod";

import { buildSignedAssetUrl, uploadAsset } from "@/lib/r2";
import type { SkillContext, UnknownSkill } from "@/skills/registry";

// Image generation via OpenRouter's chat-completions endpoint with the
// `modalities: ["image","text"]` extension. OpenRouter does NOT expose
// OpenAI's dedicated `/images/generations` endpoint — image generation on
// every supported model (Google Gemini, OpenAI GPT-5 Image, etc.) routes
// through chat completions and returns base64 data URLs on
// `choices[0].message.images[i].image_url.url`.
//
// Default model: `google/gemini-3.1-flash-image-preview` (Nano Banana 2 —
// Pro quality at Flash speed; Google's latest image model as of Feb 2026).
// Hot-swap via IMAGE_GEN_MODEL — `google/gemini-3-pro-image-preview` (Nano
// Banana Pro, highest fidelity, slower/pricier) and
// `google/gemini-2.5-flash-image` (original Nano Banana) are both valid
// alternates.
//
// Bytes flow R2 → signed URL → message file part (the client renders it as
// an <img>). Asset metadata in D1 carries (company_id, sha256) for dedup.
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

const generateBrandImageInputSchema = z.object({
  aspectRatio: z.enum(["1:1", "16:9", "4:3", "9:16"]).optional(),
  prompt: z.string().min(1).max(2000),
});

type ImageContent = { image_url?: { url?: string }; type?: string };
type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      images?: Array<ImageContent>;
    };
  }>;
};

const aspectHint = (aspect: string): string => {
  // Gemini's image model honours aspect-ratio cues in the prompt itself
  // (there's no `size` parameter on chat completions). We append a short
  // pt-BR hint so the model picks the closest supported resolution.
  if (aspect === "16:9") {
    return " (proporção 16:9, formato horizontal)";
  }
  if (aspect === "9:16") {
    return " (proporção 9:16, formato vertical)";
  }
  if (aspect === "4:3") {
    return " (proporção 4:3)";
  }
  return " (proporção 1:1, quadrado)";
};

const decodeBase64 = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.codePointAt(i) ?? 0;
  }
  return out;
};

const encodeBase64 = (bytes: Uint8Array): string => {
  let bin = "";
  for (const byte of bytes) {
    bin += String.fromCodePoint(byte);
  }
  return btoa(bin);
};

// Cap the number of brand references sent so the request payload stays bounded.
const MAX_BRAND_REFS = 3;

type BrandRefRow = { mime: string; r2_key: string };

// Loads the company's brand assets from R2 as data URLs so the image model can
// use them as visual references (cores, estilo, logotipo). Best-effort: a
// missing R2 object is skipped, not fatal.
const loadBrandReferences = async (ctx: SkillContext): Promise<Array<string>> => {
  const { results } = await ctx.env.DB.prepare(
    `SELECT r2_key, mime FROM asset
       WHERE company_id = ? AND kind = 'brand_asset'
       ORDER BY created_at DESC
       LIMIT ?`,
  )
    .bind(ctx.companyId, MAX_BRAND_REFS)
    .all<BrandRefRow>();

  const settled = await Promise.allSettled(
    results.map(async (row) => {
      const object = await ctx.env.ASSETS.get(row.r2_key);
      if (!object) {
        return null;
      }
      const bytes = new Uint8Array(await object.arrayBuffer());
      return `data:${row.mime};base64,${encodeBase64(bytes)}`;
    }),
  );
  return settled.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
};

// Pulls the `data:image/png;base64,…` payload out of a data URL. Returns
// null when the URL isn't a data URL we can decode locally (e.g. if a
// future model returns an https://… link, the caller should fetch + upload
// instead).
const parseDataUrl = (url: string): { bytes: Uint8Array; mime: string } | null => {
  const match = url.match(/^data:(?<mime>[^;]+);base64,(?<b64>.+)$/v);
  if (!match) {
    return null;
  }
  const { b64, mime } = match.groups ?? {};
  if (!mime || !b64) {
    return null;
  }
  return { bytes: decodeBase64(b64), mime };
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const extByMime = (mime: string): string => {
  if (mime === "image/jpeg" || mime === "image/jpg") {
    return "jpg";
  }
  if (mime === "image/webp") {
    return "webp";
  }
  return "png";
};

type GenerateResult = { assetId: string; url: string } | { error: string };

const generateBrandImageSkill: UnknownSkill = {
  description:
    "Gera uma imagem alinhada à marca. Use quando o cliente pedir uma imagem, post visual, ou peça de design.",
  async execute(input: unknown, ctx: SkillContext): Promise<GenerateResult> {
    const { aspectRatio = "1:1", prompt } = generateBrandImageInputSchema.parse(input);
    const fullPrompt = `${prompt}${aspectHint(aspectRatio)}`;

    // When the company uploaded brand assets, send them as visual references so
    // the output matches the brand. Falls back to a plain text prompt otherwise.
    const brandRefs = await loadBrandReferences(ctx);
    const userContent =
      brandRefs.length > 0
        ? [
            {
              text: `${fullPrompt}\n\nUse as imagens de referência da marca anexadas para manter a identidade visual (cores, estilo, logotipo).`,
              type: "text",
            },
            ...brandRefs.map((url) => ({ image_url: { url }, type: "image_url" })),
          ]
        : fullPrompt;

    let response: Response;
    try {
      response = await fetch(OPENROUTER_CHAT_URL, {
        body: JSON.stringify({
          messages: [{ content: userContent, role: "user" }],
          modalities: ["image", "text"],
          model: ctx.env.IMAGE_GEN_MODEL,
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

    const json = (await response.json()) as ChatCompletionResponse;
    const imageUrl = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imageUrl) {
      return { error: "Image gen response missing choices[0].message.images[0].image_url.url" };
    }

    const decoded = parseDataUrl(imageUrl);
    if (!decoded) {
      return { error: `Image gen returned non-data URL we can't ingest: ${imageUrl.slice(0, 60)}` };
    }
    const { bytes, mime } = decoded;
    const sha = await sha256Hex(bytes);
    const key = `org_${ctx.companyId}/${sha}.${extByMime(mime)}`;

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

    // 7-day TTL: the URL goes into the model's reply as markdown and is then
    // persisted in chat history, where bubbles re-render long after the
    // generation. Default 15-min TTL would 401 well before the chat lifetime.
    const url = await buildSignedAssetUrl(
      { ASSETS_SIGNING_KEY: ctx.env.ASSETS_SIGNING_KEY },
      ctx.env.WORKER_PUBLIC_URL,
      finalAssetId,
      7 * 24 * 60 * 60 * 1000,
    );

    return { assetId: finalAssetId, url };
  },
  id: "generateBrandImage",
  inputSchema: generateBrandImageInputSchema,
};

export { generateBrandImageSkill };
