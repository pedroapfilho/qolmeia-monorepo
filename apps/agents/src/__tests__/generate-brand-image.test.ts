import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateBrandImageSkill } from "#/skills/generate-brand-image";
import type { SkillContext } from "#/skills/registry";

const COMPANY_ID = "co_img_test";
const AGENT_INSTANCE_ID = "agent_img_test";
const originalFetch = globalThis.fetch;

// A 1x1 red PNG, base64-encoded.
const RED_PIXEL_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// OpenRouter's chat-completions image response shape — see
// apps/agents/src/skills/generate-brand-image.ts. The image is delivered
// as a `data:image/png;base64,…` URL on choices[0].message.images[0].image_url.url.
const buildChatImageResponse = (b64: string) =>
  Response.json({
    choices: [
      {
        message: {
          content: "",
          images: [
            {
              image_url: { url: `data:image/png;base64,${b64}` },
              type: "image_url",
            },
          ],
          role: "assistant",
        },
      },
    ],
  });

const ctx: SkillContext = {
  agentInstanceId: AGENT_INSTANCE_ID,
  companyId: COMPANY_ID,
  get env() {
    return env;
  },
};

beforeEach(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO company
       (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'Img Test', 'img-test', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("generateBrandImage", () => {
  it("uploads to R2, writes an asset row, returns a signed URL", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(buildChatImageResponse(RED_PIXEL_B64)));

    const result = (await generateBrandImageSkill.execute(
      { aspectRatio: "1:1", prompt: "uma onça pintada estilizada" },
      ctx,
    )) as { assetId: string; url: string };

    expect(result.assetId).toBeTruthy();
    expect(result.url).toContain("/assets/");
    expect(result.url).toContain("token=");

    const row = await env.DB.prepare("SELECT kind, mime, bytes, r2_key FROM asset WHERE id = ?")
      .bind(result.assetId)
      .first<{ bytes: number; kind: string; mime: string; r2_key: string }>();
    expect(row?.kind).toBe("generated_image");
    expect(row?.mime).toBe("image/png");
    expect(row?.bytes).toBeGreaterThan(0);

    if (row) {
      const obj = await env.ASSETS.get(row.r2_key);
      expect(obj).not.toBeNull();
    }
  });

  it("surfaces OpenRouter HTTP errors without throwing", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response("rate limit", { status: 429 })));
    const result = (await generateBrandImageSkill.execute({ prompt: "x" }, ctx)) as {
      error: string;
    };
    expect(result.error).toContain("429");
  });

  it("returns an error when the response has no image content", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        Response.json({
          choices: [{ message: { content: "no image here", images: [], role: "assistant" } }],
        }),
      ),
    );
    const result = (await generateBrandImageSkill.execute({ prompt: "x" }, ctx)) as {
      error: string;
    };
    expect(result.error).toContain("image_url");
  });

  it("dedups on (company_id, sha256) — same bytes return the same asset id", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(buildChatImageResponse(RED_PIXEL_B64)));
    const first = (await generateBrandImageSkill.execute({ prompt: "a" }, ctx)) as {
      assetId: string;
    };
    const second = (await generateBrandImageSkill.execute({ prompt: "b" }, ctx)) as {
      assetId: string;
    };
    expect(second.assetId).toBe(first.assetId);
  });
});
