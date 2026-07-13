# Qolmeia — Phase 4: Image Generation (NanoBanana Pro via Gateway)

- **Date:** 2026-05-20
- **Status:** Approved by directive (`don't stop until end-to-end`) — sensible defaults locked
- **Scope:** Phase 4. Builds on Phases 0+1+2+2.5+3 on `main` (HEAD `dc599aa`).
- **Author:** locked with Pedro

---

## 1. Context & Goal

After Phase 3 the bot can: receive voice → extract soul; receive image → upload to R2 + extract brand metadata (palette, style descriptors, typography); answer Q&A about the captured soul + assets. The locked roadmap's last MVP piece: **the bot can _generate_ an image when asked**, conditioned on the captured soul + brand assets, and post it back to Telegram. This closes the loop the user said they want working end-to-end.

### The promise to the user (acceptance criteria)

1. Owner sends a Telegram message like _"gere uma imagem para a minha promo de Black Friday"_ (or voice/image with similar intent).
2. Bot calls a `generateBrandImage` tool inside the agent loop.
3. Generated image is posted to Telegram (as a real image, not a URL).
4. Image visually reflects the captured soul (whatYouDo / brandVoice / location) and brand assets (palette / typography).

### Decisions locked

| Question | Decision |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | ------------------------------------------------------------------------------------------------------- |
| Trigger | LLM-detected via the agent loop. The model decides when to call `generateBrandImage` based on the user message (no slash commands). |
| Model | Gateway model id `"google/gemini-2.5-flash-image"` (NanoBanana family; image-output capable Gemini multimodal). |
| Provider options | `providerOptions: { google: { responseModalities: ["TEXT", "IMAGE"] } }` to request image output. |
| Reference images | Pull up to **3 most-recent** uploaded `BrandAsset` rows (source=`"uploaded"`) via `fetchAsset(r2Key)`; pass as `file` content parts in the image-gen call so the model can ground style. |
| Brand context | Compose a prompt with: the user's natural-language request + the soul's `whatYouDo`/`brandVoice`/`location` + a brand-style block constructed from existing assets' palette / styleDescriptors. |
| Aspect ratio | Default `"1:1"` (square 1024×1024). Tool input has optional `aspectRatio: "1:1"                                                                                                                                                                                                                                                                                                                    | "16:9" | "9:16" | "4:3"`(default`"1:1"`). Passed via prompt — Gemini's image output respects natural-language size hints. |
| Generated asset storage | Each generated image becomes a new `BrandAsset` row, marked via `metadata.source = "generated"` + `metadata.prompt = <prompt>` + `metadata.generatedAt = <ISO timestamp>`. Same R2 key scheme. SHA-256 deduplication still applies (a deterministic regeneration of the same prompt + reference would dedup; acceptable). |
| Schema migration | **None.** Use `metadata.source` as a JSON property; existing rows have no `source` key → treated as `"uploaded"` by default. Cheaper than adding a column. |
| Per-message cap | The model is instructed to call `generateBrandImage` AT MOST once per message. The `stopWhen: stepCountIs(5)` already bounds total tool calls. |
| Reply to user | After agent loop completes, handler inspects `result.generatedAssetIds` (a new return field). If non-empty, handler fetches the bytes via `fetchAsset(r2Key)` and posts via `thread.postImage({ bytes, caption? })` (Chat SDK image API — verified at implementation time). Then posts the agent's `result.text` as a separate message (or as the caption, if the Chat SDK image API accepts one). |
| Error handling | Image-gen failure inside tool execute → tool returns `{ error: "..." }`; the model can still produce a text-only reply. R2 upload failure on the generated image → log + tool returns `{ error }`; same. The handler's top-level catch still posts the global apology if everything fails. |

---

## 2. Module layout

### New file

| Path                            | Responsibility                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/lib/image-gen.ts` | `generateBrandImageBytes({ prompt, referenceImages, aspectRatio }): Promise<Uint8Array>`. Wraps `generateText({ model: gateway("google/gemini-2.5-flash-image"), messages, providerOptions: { google: { responseModalities: ["TEXT","IMAGE"] } } })`. Extracts generated image from `result.files` (the AI SDK exposes generated files there for multimodal-output models). Throws on no-image-returned. |

### Modified files

| Path                                    | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/soul/brand-asset.ts`      | Add `ingestGeneratedAsset({ orgId, bytes, mimeType, prisma, storage?, prompt }): Promise<{ assetId: string }>` — same dedup + R2 upload pipeline as `ingestBrandAsset`, but the row's `metadata` is `{ source: "generated", prompt, generatedAt }`. Reuses the existing flow.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/api/src/lib/ai.ts`                | Add `generateBrandImage` tool to `runAgent`'s `tools` object. Closure captures `orgId`/`prisma`. Tool: (a) parses input `{ prompt, aspectRatio? }`; (b) loads up to 3 most-recent uploaded assets via `prisma.brandAsset.findMany({ where: { orgId, /* source not "generated" */ }, orderBy: { createdAt: "desc" }, take: 3 })`; (c) fetches bytes via `storage.fetchAsset(row.r2Key)`; (d) calls `generateBrandImageBytes`; (e) calls `ingestGeneratedAsset` to store result; (f) returns `{ assetId, r2Key }`. Update `runAgent` return type to include `generatedAssetIds: Array<string>` (collected from `generateBrandImage` tool returns). Update `AGENT_SYSTEM_TEMPLATE` to describe the third tool. |
| `apps/api/src/telegram/handler.ts`      | After `runAgent` completes: if `result.generatedAssetIds.length > 0`, for each id: `prisma.brandAsset.findUnique({ where: { id }, select: { r2Key, mimeType } })` → `storage.fetchAsset(r2Key)` → `thread.postImage({ bytes, mimeType, caption? })` (verify Chat SDK API at implementation time — fallback to `thread.post` with a URL if image-posting requires a different signature). Then `thread.post(result.text)` for the text reply (or fold into caption if supported). Log adds `generatedAssetIds`.                                                                                                                                                                                              |
| `apps/api/src/lib/ai.test.ts`           | Add `generateBrandImage` tool test; assert `result.generatedAssetIds` aggregation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/api/src/lib/image-gen.test.ts`    | New test file with `vi.mock("ai")`. Verify call shape + image extraction from `files`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/api/src/soul/brand-asset.test.ts` | Add tests for `ingestGeneratedAsset` (sets `metadata.source="generated"` + `prompt` + `generatedAt`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/api/src/telegram/handler.test.ts` | Add a test: when `runAgent` mock returns `generatedAssetIds`, handler queries the row, fetches bytes, calls `thread.postImage`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### No Prisma migration

`BrandAsset.metadata` is `Json`. The new `source`/`prompt`/`generatedAt` keys live inside it. No `db:push` required for Phase 4 itself.

### Dependency on Chat SDK image API

`thread.post(text)` is verified working. For images, the Chat SDK Telegram adapter likely exposes one of:

- `thread.postImage({ data, mimeType, caption? })` (rich-message API), OR
- `thread.post({ attachments: [{ type: "image", data, mimeType }], caption? })`, OR
- a method like `thread.sendPhoto(...)`.

Implementer verifies via `node_modules/chat`/`node_modules/@chat-adapter/telegram` type defs at Task 4.4 and adapts. **Fallback**: if Chat SDK image-sending is unavailable or awkward, use the raw Telegram Bot API directly: `POST https://api.telegram.org/bot<token>/sendPhoto` with the multipart form. Both work; pick whichever is cleaner with the installed SDK.

---

## 3. New `generateBrandImage` tool

```ts
const generateBrandImageToolInput = z.object({
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3"]).default("1:1"),
  prompt: z.string().min(1).max(2000),
});

const generateBrandImageTool = tool({
  description:
    "Gere uma imagem para o dono baseada no perfil do negócio (soul + brand assets). Use APENAS quando o dono pedir explicitamente por uma imagem/post/criativo. AT MOST one call per message.",
  inputSchema: generateBrandImageToolInput,
  execute: async ({ aspectRatio, prompt }) => {
    try {
      // Load up to 3 reference assets (uploaded only).
      const refRows = await prisma.brandAsset.findMany({
        orderBy: { createdAt: "desc" },
        select: { metadata: true, mimeType: true, r2Key: true },
        take: 3,
        where: { orgId },
      });
      const refRowsFiltered = refRows.filter((r) => {
        const meta = r.metadata as { source?: string } | null;
        return meta?.source !== "generated";
      });

      const referenceImages: Array<{ bytes: Uint8Array; mimeType: string }> = [];
      for (const row of refRowsFiltered) {
        try {
          const bytes = await fetchAsset(row.r2Key);
          referenceImages.push({ bytes, mimeType: row.mimeType });
        } catch (error) {
          // Skip individual asset fetch failures, don't block generation.
          logger.warn({ error, r2Key: row.r2Key }, "image-gen.reference_fetch_failed");
        }
      }

      const palette = collectPalette(refRowsFiltered);
      const fullPrompt = buildImagePrompt({ aspectRatio, palette, userPrompt: prompt });

      const bytes = await generateBrandImageBytes({
        aspectRatio,
        prompt: fullPrompt,
        referenceImages,
      });

      const { assetId } = await ingestGeneratedAsset({
        bytes,
        mimeType: "image/png",
        orgId,
        prisma,
        prompt,
      });

      generatedAssetIds.push(assetId);
      return { assetId, ok: true };
    } catch (error) {
      logger.error({ error, orgId }, "image-gen.failed");
      return { error: String(error), ok: false };
    }
  },
});
```

`generatedAssetIds` is a `let`-array in the `runAgent` closure; collected by the tool, returned in `AgentResult`.

`collectPalette(rows)` extracts the union of `metadata.palette` arrays from the reference rows (dedup, up to 8 colors). `buildImagePrompt({ aspectRatio, palette, userPrompt })` composes a single string instructing the model: aspect ratio, brand palette as hex, brand voice from soul if available, the user's request.

---

## 4. `generateBrandImageBytes` shape (in `lib/image-gen.ts`)

```ts
type GenerateImageArgs = {
  aspectRatio: "1:1" | "16:9" | "9:16" | "4:3";
  prompt: string;
  referenceImages?: ReadonlyArray<{ bytes: Uint8Array; mimeType: string }>;
};

const generateBrandImageBytes = async (args: GenerateImageArgs): Promise<Uint8Array> => {
  const contentParts: Array<
    { data: Uint8Array; mediaType: string; type: "file" } | { text: string; type: "text" }
  > = [];
  for (const ref of args.referenceImages ?? []) {
    contentParts.push({ data: ref.bytes, mediaType: ref.mimeType, type: "file" });
  }
  contentParts.push({ text: args.prompt, type: "text" });

  const result = await generateText({
    messages: [{ content: contentParts, role: "user" }],
    model: gateway("google/gemini-2.5-flash-image"),
    providerOptions: { google: { responseModalities: ["IMAGE", "TEXT"] } },
  });

  // Gemini multimodal-output returns generated files in result.files.
  const file = (
    result as { files?: Array<{ mediaType: string; uint8Array?: Uint8Array; base64?: string }> }
  ).files?.[0];
  if (!file) {
    throw new Error("Image generation returned no image file");
  }
  if (file.uint8Array) return file.uint8Array;
  if (file.base64) return new Uint8Array(Buffer.from(file.base64, "base64"));
  throw new Error("Image file has neither uint8Array nor base64 payload");
};
```

> Implementer note: confirm the exact field name (`uint8Array` vs `data` vs `bytes`) by inspecting installed `node_modules/ai` types. The above is the v6 documented shape; adapt as needed.

---

## 5. Updated system prompt (`AGENT_SYSTEM_TEMPLATE` in `lib/ai.ts`)

Add a third tool block to the "Você tem N ferramentas" enumeration:

```
3) generateBrandImage — chame APENAS quando o dono pedir explicitamente por uma imagem ou criativo (ex.: "gera uma imagem pra promo", "faz um post"). NUNCA por iniciativa própria. AT MOST 1 call por mensagem. O prompt deve ser curto e descritivo (até 2000 chars). Use o aspectRatio que faz sentido (1:1 padrão, 16:9 para banners, 9:16 para stories, 4:3 para web).
```

And add a rule under "Regras de `reply`":

```
- Se você chamou generateBrandImage com sucesso, comente brevemente o que foi gerado (1 frase). Não descreva tecnicamente; fale do resultado para o dono.
- Se generateBrandImage falhou (retornou ok:false), peça desculpa e ofereça tentar de novo.
```

---

## 6. Data flow (per inbound message)

Phase 3 unchanged through step 7 (runAgent call). New steps after:

8. `runAgent` result now includes `generatedAssetIds: string[]`.
9. **If `generatedAssetIds.length > 0`**: for each `assetId`:
   - `row = await prisma.brandAsset.findUnique({ where: { id: assetId }, select: { r2Key: true, mimeType: true } })`.
   - `bytes = await fetchAsset(row.r2Key)`.
   - `await thread.postImage({ bytes, caption?: result.text if this is the only/last asset, mimeType: row.mimeType })` (or equivalent Chat SDK API). If the SDK accepts a caption, fold the text reply into the LAST image's caption to keep the message thread clean.
10. **If no generated assets**: post `result.text` as text (existing behavior).
11. Log adds `generatedAssetIds`.

If `postImage` fails (e.g., R2 fetch error, Telegram API error): log + post the text reply alone with a brief "(não consegui te mostrar a imagem, vou te enviar de novo já)" suffix.

---

## 7. Tool input + return type updates (`AgentResult`)

```ts
type AgentResult = {
  generatedAssetIds: Array<string>; // NEW in Phase 4
  text: string;
  toolCallSummary: {
    extractSoul: number;
    generateBrandImage: number; // NEW in Phase 4
    labelBrandAsset: number;
  };
  usage: { inputTokens: number; outputTokens: number };
};
```

---

## 8. Error handling

- **Reference fetch failure** (R2 GET error on a single asset) → log, skip that reference, continue with remaining refs.
- **`generateBrandImageBytes` failure** → caught in the tool's `try/catch`, returns `{ error, ok: false }`. The agent loop's model sees the error and produces an apology reply text. No crash.
- **`ingestGeneratedAsset` failure** (R2 PUT or DB error) → caught in the tool's `try/catch`, returns `{ error }`. Same outcome.
- **`postImage` failure in handler** → log + post the text reply with apology suffix.
- **Top-level catch** in handler preserved — `EXTRACT_FAILED_REPLY` for any unhandled throw. Spec §6 "never silent-fail" continues to hold.

---

## 9. Testing (Vitest, no live AI, no live R2)

- `lib/image-gen.test.ts` — `vi.mock("ai")`; verify `generateText` called with `model: gateway("google/gemini-2.5-flash-image")`, `providerOptions.google.responseModalities = ["IMAGE", "TEXT"]`, reference images in content parts, prompt text in content parts; extract bytes from `result.files[0].uint8Array` mock.
- `soul/brand-asset.test.ts` — add 2 tests: `ingestGeneratedAsset` sets `metadata.source = "generated"` + `prompt` + ISO timestamp; dedup still works for generated assets.
- `lib/ai.test.ts` — extend `runAgent` tests: when `generateBrandImage` tool is called, `result.generatedAssetIds` includes the returned asset IDs; `toolCallSummary.generateBrandImage` increments.
- `telegram/handler.test.ts` — new test: runAgent mock returns `generatedAssetIds: ["asset_new"]`; handler queries the BrandAsset row, calls fetchAsset, calls `thread.postImage` (or whatever the actual Chat SDK API is — test asserts a "post image" method was called with bytes); handler then posts `result.text` separately OR as caption (whichever matches the implementation).

---

## 10. Out of scope (Phase 4)

- Multi-image generation in one call (cap at 1 per message).
- Image editing of an existing generated asset (regenerate from scratch).
- User selecting from N variations (single image per call).
- High-resolution / batch generation (use defaults).
- Streaming generation status to user ("gerando…" → image) — handler is request/response; would require a webhook-side UX update.

---

## 11. Future roadmap (post-Phase-4)

The MVP loop is complete after Phase 4. Future:

- **Phase 5** — customer-facing chat (transcript memory).
- **Phase 6+** — web UI / canvas (streaming, approval queue).

---

## 12. Seams preserved

1. `KnowledgeProvider.getBusinessContext` — still the only `businessProfile` reader.
2. `applySoulUpdate` — still the only `businessProfile` writer; called via the `extractSoul` tool.
3. `lib/ai.runAgent` — the AI seam, now with 3 tools instead of 2.
4. `lib/storage` — S3-compatible interface; still the only R2 client.
5. `soul/brand-asset.ingestBrandAsset` / `ingestGeneratedAsset` — the only `brandAsset.create` callers.
