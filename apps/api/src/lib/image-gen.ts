import { env } from "./env";

void env.AI_GATEWAY_API_KEY;

type AspectRatio = "1:1" | "16:9" | "4:3" | "9:16";

type GenerateImageArgs = {
  aspectRatio: AspectRatio;
  prompt: string;
};

const GATEWAY_IMAGES_URL = "https://ai-gateway.vercel.sh/v1/images/generations";
const MODEL = "openai/gpt-image-1";

// gpt-image-1 accepts a fixed set of sizes. Map our aspect-ratio enum to the
// closest available; "4:3" falls back to square since the model has no 4:3 size.
const aspectToSize = (aspectRatio: AspectRatio): string => {
  if (aspectRatio === "16:9") {
    return "1536x1024";
  }
  if (aspectRatio === "9:16") {
    return "1024x1536";
  }
  return "1024x1024";
};

// gpt-image-1 takes a text prompt only. Brand context (palette, voice) is
// folded into the prompt by the caller — we do not pass reference image bytes.
// We switched from Gemini-image-via-generateText because Vercel's AI Gateway
// currently restricts that model on free credits; gpt-image-1 is unrestricted.
const generateBrandImageBytes = async (args: GenerateImageArgs): Promise<Uint8Array> => {
  const response = await fetch(GATEWAY_IMAGES_URL, {
    body: JSON.stringify({
      model: MODEL,
      n: 1,
      prompt: args.prompt,
      size: aspectToSize(args.aspectRatio),
    }),
    headers: {
      authorization: `Bearer ${env.AI_GATEWAY_API_KEY}`,
      "content-type": "application/json",
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
