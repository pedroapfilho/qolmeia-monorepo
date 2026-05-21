import { env } from "./env";

type AspectRatio = "1:1" | "16:9" | "4:3" | "9:16";

type GenerateImageArgs = {
  aspectRatio: AspectRatio;
  prompt: string;
};

// OpenRouter exposes the OpenAI images API at this path. The response shape
// mirrors OpenAI's: `{ data: [{ b64_json: "..." }] }`. The default image model
// is Google's Nano Banana Pro (gemini-3-pro-image-preview); operators can
// hot-swap via env.IMAGE_GEN_MODEL — see https://openrouter.ai/google for the
// current list of image-capable model ids.
const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images/generations";

// Aspect-ratio → OpenAI-style size string mapping. Kept in case the chosen
// image model honors `size`; Nano Banana Pro currently ignores it (the prompt
// itself controls composition), but the OpenAI-compatible endpoint accepts the
// field regardless. "4:3" falls back to square because no exact 4:3 size exists.
const aspectToSize = (aspectRatio: AspectRatio): string => {
  if (aspectRatio === "16:9") {
    return "1536x1024";
  }
  if (aspectRatio === "9:16") {
    return "1024x1536";
  }
  return "1024x1024";
};

// Brand context (palette, voice) is folded into the prompt by the caller; we
// do not pass reference image bytes. Returns raw PNG bytes ready for R2 upload.
const generateBrandImageBytes = async (args: GenerateImageArgs): Promise<Uint8Array> => {
  const response = await fetch(OPENROUTER_IMAGES_URL, {
    body: JSON.stringify({
      model: env.IMAGE_GEN_MODEL,
      n: 1,
      prompt: args.prompt,
      size: aspectToSize(args.aspectRatio),
    }),
    headers: {
      authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "content-type": "application/json",
      "HTTP-Referer": env.WEB_APP_URL ?? "https://qolmeia.ai",
      "X-Title": "Qolmeia",
    },
    method: "POST",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Image gen failed (HTTP ${response.status}): ${body.slice(0, 400)}`);
  }

  const json = (await response.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("Image gen response missing data[0].b64_json");
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
};

export { generateBrandImageBytes };
export type { AspectRatio, GenerateImageArgs };
