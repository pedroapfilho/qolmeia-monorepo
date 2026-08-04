import { z } from "zod";

import { getDb } from "#/db/client";
import { persistAsset } from "#/lib/asset-store";
import { buildSignedAssetUrl } from "#/lib/r2";
import type { SkillContext, UnknownSkill } from "#/skills/registry";

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

const MAX_BRAND_REFS = 3;

const loadBrandReferences = async (ctx: SkillContext): Promise<Array<string>> => {
  const results = await getDb(ctx.env).asset.findMany({
    orderBy: { createdAt: "desc" },
    select: { mime: true, r2Key: true },
    take: MAX_BRAND_REFS,
    where: { companyId: ctx.companyId, kind: "brand_asset", mime: { not: "image/svg+xml" } },
  });

  const settled = await Promise.allSettled(
    results.map(async (row) => {
      const object = await ctx.env.ASSETS.get(row.r2Key);
      if (!object) {
        return null;
      }
      const bytes = new Uint8Array(await object.arrayBuffer());
      return `data:${row.mime};base64,${encodeBase64(bytes)}`;
    }),
  );
  return settled.flatMap((result) =>
    result.status === "fulfilled" && result.value !== null && result.value !== ""
      ? [result.value]
      : [],
  );
};

const parseDataUrl = (url: string): { bytes: Uint8Array; mime: string } | null => {
  const match = /^data:(?<mime>[^;]+);base64,(?<b64>.+)$/v.exec(url);
  if (!match) {
    return null;
  }
  const { b64, mime } = match.groups ?? {};
  if (!mime || !b64) {
    return null;
  }
  return { bytes: decodeBase64(b64), mime };
};

type GenerateResult = { assetId: string; url: string } | { error: string };

const generateBrandImageSkill: UnknownSkill = {
  description:
    "Gera uma imagem alinhada à marca. Use quando o cliente pedir uma imagem, post visual, ou peça de design.",
  async execute(input: unknown, ctx: SkillContext): Promise<GenerateResult> {
    const { aspectRatio = "1:1", prompt } = generateBrandImageInputSchema.parse(input);
    const fullPrompt = `${prompt}${aspectHint(aspectRatio)}`;

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

    const json = await response.json<ChatCompletionResponse>();
    const imageUrl = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (imageUrl === undefined || imageUrl === "") {
      return { error: "Image gen response missing choices[0].message.images[0].image_url.url" };
    }

    const decoded = parseDataUrl(imageUrl);
    if (!decoded) {
      return { error: `Image gen returned non-data URL we can't ingest: ${imageUrl.slice(0, 60)}` };
    }
    const { bytes, mime } = decoded;
    const { assetId } = await persistAsset(ctx.env, {
      bytes,
      companyId: ctx.companyId,
      // The generator can hand back a mime the map doesn't cover; these are
      // images, so name them .png rather than .bin.
      fallbackExt: "png",
      kind: "generated_image",
      metadata: { aspectRatio, prompt },
      mime,
      uploadMetadata: { aspectRatio, prompt },
      visibility: "customer",
    });

    const url = await buildSignedAssetUrl(
      { ASSETS_SIGNING_KEY: ctx.env.ASSETS_SIGNING_KEY },
      ctx.env.WORKER_PUBLIC_URL,
      assetId,
      7 * 24 * 60 * 60 * 1000,
    );

    return { assetId, url };
  },
  id: "generateBrandImage",
  inputSchema: generateBrandImageInputSchema,
};

export { generateBrandImageSkill };
