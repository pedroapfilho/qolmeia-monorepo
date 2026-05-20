import { gateway, generateText } from "ai";

import { env } from "./env";

void env.AI_GATEWAY_API_KEY;

type AspectRatio = "1:1" | "16:9" | "4:3" | "9:16";

type GenerateImageArgs = {
  aspectRatio: AspectRatio;
  prompt: string;
  referenceImages?: ReadonlyArray<{ bytes: Uint8Array; mimeType: string }>;
};

const generateBrandImageBytes = async (args: GenerateImageArgs): Promise<Uint8Array> => {
  const contentParts: Array<
    | { data: Uint8Array; mediaType: string; type: "file" }
    | { text: string; type: "text" }
  > = [];

  for (const ref of args.referenceImages ?? []) {
    contentParts.push({ data: ref.bytes, mediaType: ref.mimeType, type: "file" });
  }
  contentParts.push({ text: args.prompt, type: "text" });

  const result = (await generateText({
    messages: [{ content: contentParts, role: "user" }],
    model: gateway("google/gemini-2.5-flash-image"),
    providerOptions: { google: { responseModalities: ["IMAGE", "TEXT"] } },
  })) as { files?: Array<{ base64?: string; mediaType: string; uint8Array?: Uint8Array }> };

  const file = result.files?.[0];
  if (!file) {
    throw new Error("Image generation returned no image file");
  }
  if (file.uint8Array) {
    return file.uint8Array;
  }
  if (file.base64) {
    return new Uint8Array(Buffer.from(file.base64, "base64"));
  }
  throw new Error("Image file has neither uint8Array nor base64 payload");
};

export { generateBrandImageBytes };
export type { AspectRatio, GenerateImageArgs };
