import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/ai", () => ({
  extractSoul: vi.fn(),
  runAgent: vi.fn(),
}));

import { extractSoul as mockedExtract } from "../lib/ai";

import { extractFromMessage } from "./extract";

const mocked = vi.mocked(mockedExtract);

const stubReturn = (reply: string) =>
  mocked.mockResolvedValue({
    partial: {
      brandVoice: null,
      differentiator: null,
      location: null,
      targetAudience: null,
      whatYouDo: "salão",
    },
    reply,
    usage: { inputTokens: 1, outputTokens: 1 },
  });

describe("extractFromMessage", () => {
  it("builds a text input from a text message and passes the current context", async () => {
    stubReturn("Anotei!");
    const result = await extractFromMessage(
      { kind: "text", text: "sou um salão" },
      "# Business Context\n\nwhatYouDo: x",
    );
    expect(result.partial.whatYouDo).toBe("salão");
    expect(result.reply).toBe("Anotei!");
    expect(mocked).toHaveBeenCalledWith(
      { kind: "text", text: "sou um salão" },
      "# Business Context\n\nwhatYouDo: x",
    );
  });

  it("builds an audio input and forwards bytes + mediaType", async () => {
    stubReturn("Recebi seu áudio.");
    const bytes = new Uint8Array([9, 9]);
    const result = await extractFromMessage(
      { bytes, kind: "audio", mediaType: "audio/ogg" },
      "(perfil vazio)",
    );
    expect(result.reply).toBe("Recebi seu áudio.");
    expect(mocked).toHaveBeenCalledWith(
      { bytes, kind: "audio", mediaType: "audio/ogg" },
      "(perfil vazio)",
    );
  });
});
