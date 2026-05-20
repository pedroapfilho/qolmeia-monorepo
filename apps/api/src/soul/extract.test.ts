import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/ai", () => ({
  extractSoul: vi.fn(),
}));

import { extractSoul as mockedExtract } from "../lib/ai";

import { extractFromMessage } from "./extract";

const mocked = vi.mocked(mockedExtract);

const stubReturn = () =>
  mocked.mockResolvedValue({
    partial: {
      brandVoice: null,
      differentiator: null,
      location: null,
      targetAudience: null,
      whatYouDo: "salão",
    },
    usage: { inputTokens: 1, outputTokens: 1 },
  } as never);

describe("extractFromMessage", () => {
  it("builds a text input from a text message and passes the current context", async () => {
    stubReturn();
    const result = await extractFromMessage(
      { kind: "text", text: "sou um salão" },
      "# Business Context\n\nwhatYouDo: x",
    );
    expect(result.partial.whatYouDo).toBe("salão");
    expect(mocked).toHaveBeenCalledWith(
      { kind: "text", text: "sou um salão" },
      "# Business Context\n\nwhatYouDo: x",
    );
  });

  it("builds an audio input and forwards bytes + mediaType", async () => {
    stubReturn();
    const bytes = new Uint8Array([9, 9]);
    await extractFromMessage(
      { bytes, kind: "audio", mediaType: "audio/ogg" },
      "(perfil vazio)",
    );
    expect(mocked).toHaveBeenCalledWith(
      { bytes, kind: "audio", mediaType: "audio/ogg" },
      "(perfil vazio)",
    );
  });
});
