# Qolmeia — Phase 3: R2 Brand Assets + Tool Calling

- **Date:** 2026-05-20
- **Status:** Approved design — ready for implementation planning
- **Scope:** Phase 3. Builds on Phases 0+1+2+2.5 on `main` (HEAD `7b88268`).
- **Author:** brainstormed with Pedro

---

## 1. Context & Goal

The customer can now send voice notes or text and the bot extracts the 5 soul fields + replies conversationally (Phase 2.5). Images sent via Telegram currently hit the empty-text branch — nothing useful happens. Phase 3 adds the next pillar of Qolmeia's vision: **brand assets**. When the customer sends an image (logo, screenshot, brand reference), we upload it to Cloudflare R2, extract brand metadata via the same Gemini multimodal model (palette, style descriptors, typography hint), and persist it as a queryable `BrandAsset` row attached to the Organization. The locked roadmap also says this is where **tool / function calling** lands — the model gains tools (`extractSoul`, `labelBrandAsset`) and decides what to call based on the message content.

Phase 4 (next) builds on this: NanoBanana Pro reads the soul + brand assets to generate branded images on demand.

### Decisions locked

| Question | Decision |
|---|---|
| Architecture | **Tool calling** via Vercel AI SDK `generateText({ tools, stopWhen })`. Two tools: `extractSoul` (Phase 2.5's schema, executes `applySoulUpdate`) and `labelBrandAsset` (new, executes `prisma.brandAsset.update`). Final agent text is the bot's reply. |
| Vision metadata captured | `palette` (1-8 hex strings), `styleDescriptors` (1-6 free-form pt-BR), `typography` (`serif`/`sans`/`script`/`handwritten`/`decorative`/`unknown`). |
| Storage model | New Prisma `BrandAsset` (1-to-many with `Organization`), `@@unique([orgId, sha256])`. |
| Dedup | SHA-256 of bytes per org. Skip R2 PUT + vision call when a row already exists for that (`orgId`, `sha256`). |
| R2 key | `org_<orgId>/<sha256>.<ext>` |
| Allowed attachments | `mimeType.startsWith("image/")` only. Other attachment types persist as `Message` but are ignored by the asset pipeline (deferred). |
| Multi-attachment | All image attachments processed in order; each becomes its own row. |
| Oversize | Skip image if downloaded bytes > 20 MB (Gemini vision cap). The model is told in the system prompt so it can mention it in the reply. |
| Reply | Free-text from the agent loop (`generateText` final text). Phase 2.5's deterministic error/edge apologies preserved. |
| Phase 2.5 fused schema | **Removed.** `extractSoul` is now a tool with the same Zod shape, not a fused-call output field. The bot's reply is no longer schema-validated; it's the agent's `text`. Length still ~1-3 sentences per system prompt instruction. |
| Naming | `extractFromMessage` → `runAgent`. Honest rename — the function is now an agent loop, not an extraction call. |

### R2 env vars

All 6 vars exist from Phase 1 (`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_REGION`). They were `.optional()` in `env.ts`; promote to required in this phase. Add stubs to `vitest-setup.ts`.

---

## 2. Module layout

### New files

| Path | Responsibility |
|---|---|
| `apps/api/src/lib/storage.ts` | R2 (S3-compatible) client wrapper. Exports `uploadAsset({ key, bytes, mimeType })`, `assetKey(orgId, sha256, ext)`, `fetchAsset(key): Promise<Uint8Array>` (Phase 4 uses fetch). Uses `@aws-sdk/client-s3` against `R2_ENDPOINT`. |
| `apps/api/src/soul/brand-asset.ts` | `ingestBrandAsset({ orgId, bytes, mimeType, prisma, storage }): Promise<{ assetId; deduped: boolean }>` — SHA-256 → dedup check → R2 upload (if new) → `BrandAsset` row creation with empty `metadata`. The deterministic side. |

### Modified files

| Path | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | Add `BrandAsset` model + back-relation on `Organization`. |
| `apps/api/src/lib/env.ts` | Promote 6 `R2_*` vars from `.optional()` to `.string().min(1)`. |
| `apps/api/src/lib/vitest-setup.ts` | Add `R2_*` stubs (6 lines). |
| `apps/api/src/lib/ai.ts` | Replace `extractSoul(input, currentContext)` (the `generateObject` call) with `runAgent({ orgId, prisma, input, currentContext, newAssets, oversizeCount })` using `generateText({ tools, stopWhen: stepCountIs(5), system, messages })`. Defines `extractSoulTool` + `labelBrandAssetTool` closures over `orgId`/`prisma`. Returns `{ text, toolCallSummary, usage }`. |
| `apps/api/src/lib/ai.test.ts` | Drop the `generateObject`-based call-shape tests; mock `generateText` to return scripted `toolCalls` + `text`; assert tool definitions reach the call, system prompt content, image file parts wire correctly. |
| `apps/api/src/soul/extract.ts` | Rename `extractFromMessage` → `runAgent`. Thin pass-through to `lib/ai.runAgent`. Update type re-exports. |
| `apps/api/src/soul/extract.test.ts` | Update tests to the new `runAgent` shape. |
| `apps/api/src/soul/apply.ts` | **Unchanged.** Still the single `businessProfile` writer. Called by the `extractSoul` tool's `execute`. |
| `apps/api/src/telegram/handler.ts` | Drop `extractFromMessage`/`applySoulUpdate`/`getBusinessContext` DI overrides → introduce `runAgent`/`ingestBrandAsset`/`getBusinessContext`/`storage` DI overrides. Image-attachment pre-processing pipeline (download → size-check → ingest). Agent input assembly (audio/text/image parts + `newAssets` metadata). Call `runAgent`. Post `result.text`. Error/edge branches preserved. |
| `apps/api/src/telegram/handler.test.ts` | Update default mock to the `runAgent` shape (`{ text, toolCallSummary, usage }`). Existing tests reshape; new tests cover image ingest, dedup short-circuit, oversize skip, multi-attachment. |

### New dependency

`@aws-sdk/client-s3` — added to `apps/api/package.json`. Used only by `lib/storage.ts`.

---

## 3. Prisma schema addition

```prisma
model BrandAsset {
  id        String   @id @default(cuid())
  orgId     String
  org       Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  r2Key     String
  sha256    String
  mimeType  String
  size      Int
  metadata  Json     @default("{}")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([orgId, sha256])
  @@index([orgId, createdAt])
}
```

Add to `Organization`:
```prisma
  brandAssets BrandAsset[]
```

DB migration: `prisma db push` against local Docker (`localhost:5436`) — same as Phase 1.

---

## 4. Tool schemas

```ts
// In lib/ai.ts, inside runAgent — tools close over orgId, prisma.

const extractSoulInput = z.object({
  brandVoice: z.string().nullable(),
  differentiator: z.string().nullable(),
  location: z.string().nullable(),
  targetAudience: z.string().nullable(),
  whatYouDo: z.string().nullable(),
});

const labelBrandAssetInput = z.object({
  assetId: z.string().min(1),
  palette: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/i)).min(1).max(8),
  styleDescriptors: z.array(z.string().min(1)).min(1).max(6),
  typography: z.enum(["serif", "sans", "script", "handwritten", "decorative", "unknown"]),
});

const tools = {
  extractSoul: {
    description: "Atualize os 5 campos do perfil de negócio do dono (whatYouDo, targetAudience, differentiator, brandVoice, location). Use SOMENTE quando a mensagem trouxer informação nova ou correção. Campos não mencionados ficam null.",
    inputSchema: extractSoulInput,
    execute: async (partial: z.infer<typeof extractSoulInput>) => {
      const { capturedFields } = await applySoulUpdate(orgId, partial, prisma);
      return { capturedFields };
    },
  },
  labelBrandAsset: {
    description: "Anote metadados visuais de UM asset de marca que o dono enviou. Use o assetId fornecido em 'Novos assets'. Extraia palette (até 8 cores hex), styleDescriptors (até 6, em pt-BR), e typography. Chame uma vez por novo assetId.",
    inputSchema: labelBrandAssetInput,
    execute: async (args: z.infer<typeof labelBrandAssetInput>) => {
      await prisma.brandAsset.update({
        where: { id: args.assetId },
        data: { metadata: { palette: args.palette, styleDescriptors: args.styleDescriptors, typography: args.typography } },
      });
      return { ok: true };
    },
  },
};
```

---

## 5. System prompt (pt-BR, builds on Phase 2.5)

```
Você é um assistente onboarding de negócio. O dono fala com você por texto, áudio ou imagem em português brasileiro.

Você tem 2 ferramentas:
1) extractSoul — chame quando a mensagem trouxer informação sobre o negócio (5 campos: whatYouDo, targetAudience, differentiator, brandVoice, location).
2) labelBrandAsset — chame UMA VEZ por assetId listado em "Novos assets" abaixo. Olhe a imagem correspondente e extraia palette (hex), styleDescriptors (pt-BR), typography.

Perfil atual:
{{currentContext}}

Assets de marca já anotados:
{{existingAssetsBlock}}

Novos assets nesta mensagem (já salvos no R2, aguardando label):
{{newAssetsBlock}}

Imagens grandes ignoradas (> 20 MB): {{oversizeCount}}

Depois das ferramentas, escreva UMA resposta em pt-BR (1-3 frases, máx 500 caracteres) — não chame ferramentas dentro do texto da resposta:
- Se brandVoice está preenchido no perfil, adote esse tom.
- Acknowledge cada asset novo ("Recebi sua logo!") citando o que viu (cores, estilo).
- Se houver oversize, mencione: "Alguma imagem não coube; tenta menor?".
- Se a mensagem trouxer info do perfil, agradeça e peça naturalmente um campo soul que ainda falte.
- Se o perfil já está completo e a pessoa só conversa, responda usando APENAS o perfil + os assets conhecidos. Se ela perguntar algo que não está em nenhum dos dois, diga que ainda não sabe e ofereça registrar.
- Se a mensagem for fora do tema, redirecione com gentileza.
- Nunca invente fatos.
```

`{{newAssetsBlock}}` is a rendered list:
```
- assetId: clr_abc123, mimeType: image/jpeg
- assetId: clr_def456, mimeType: image/png (já estava no perfil — não precisa labelar)
```

---

## 6. Data flow per inbound message

1. Idempotency / org-conversation-message persist — Phase 2 unchanged.
2. **Pre-process attachments** (NEW): for each `att` with `mimeType.startsWith("image/")`:
   - `bytes = await att.fetchData()`.
   - If `bytes.byteLength > 20_000_000`: increment `oversizeCount`, skip (no upload, no row).
   - Else `{ assetId, deduped } = await ingestBrandAsset({ orgId: link.orgId, bytes, mimeType: att.mimeType ?? "application/octet-stream", prisma, storage })`.
   - Push `{ assetId, mimeType, bytes, deduped }` into `newAssets` (we keep `bytes` to pass into the model's user content as a file part).
3. **Empty-message short-circuit**: if `!hasAudio && text.length === 0 && newAssets.length === 0 && oversizeCount === 0` → post `EMPTY_TEXT_REPLY`, return.
4. **Audio fetch** (existing): if audio attachment, `fetchData()` → bytes; failure → `DOWNLOAD_FAILED_REPLY`.
5. **`currentContext = await getBusinessContext(orgId)`** (unchanged from Phase 2.5).
   **`existingAssets = await prisma.brandAsset.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take: 20 })`** — a slim summary (id, mimeType, metadata) gets serialized into `{{existingAssetsBlock}}` so the model can answer Q&A about previously labeled assets and avoid re-labeling.
6. **Build agent input** (`Input` becomes a discriminated/composed shape):
   - `kind: "agent"` (single kind now; the `kind: "text" | "audio"` distinction is internal to content-part assembly).
   - User content parts: audio file part (if any) + text part (if any) + image file parts (one per new non-deduped asset).
   - `newAssets` (assetIds + mimeType + dedup flag) passed alongside for the `{{newAssetsBlock}}` template substitution.
   - `oversizeCount`.
7. **`result = await runAgent({ orgId, prisma, input, currentContext, newAssets, oversizeCount })`**. The agent loop runs ≤5 steps; tools execute side effects; final text is the reply.
8. **Post `result.text`** to thread.
9. **Log** structured: `toolCallSummary` (which tools called, count), `tokensIn`/`Out`, `assetIds`, `oversizeCount`, `replyLength: result.text.length`.

---

## 7. `runAgent` shape

```ts
type AgentInput = {
  audioBytes?: Uint8Array;
  audioMime?: string;
  text?: string;
  imageBytes: Array<{ assetId: string; bytes: Uint8Array; mimeType: string }>;  // new, non-dedup
};

type AgentSummary = {
  text: string;
  toolCallSummary: { extractSoul: number; labelBrandAsset: number };
  usage: { inputTokens: number; outputTokens: number };
};

const runAgent = async (args: {
  orgId: string;
  prisma: PrismaClient;
  input: AgentInput;
  currentContext: string;
  newAssets: Array<{ assetId: string; mimeType: string; deduped: boolean }>;
  oversizeCount: number;
}): Promise<AgentSummary> => { /* … */ };
```

Inside: build `messages` (single `user` message with mixed content parts), build tools closing over `orgId`/`prisma`, call `generateText({ model: gateway("google/gemini-2.5-flash"), system, messages, tools, stopWhen: stepCountIs(5) })`, return `{ text: result.text, toolCallSummary: aggregate(result.toolCalls), usage }`.

---

## 8. Error handling

- **R2 upload fail** inside `ingestBrandAsset` → throws; caught by handler; log + apology reply ("Não consegui salvar sua imagem, pode reenviar?"); other attachments in the message continue if possible (per-attachment try/catch).
- **Vision/tool-call/agent fail** inside `runAgent` → bubbles to handler; existing top-level try/catch + `EXTRACT_FAILED_REPLY`.
- **`attachment.fetchData()` fail for an image** → log per-attachment; skip that asset; continue. If ALL attachments fail, treat as "nothing came through" and reply accordingly.
- **Oversize** → silently skipped (no upload), mentioned to the model so reply acknowledges.
- **Tool returns error inside execute** (e.g., Prisma update fails on labelBrandAsset for a nonexistent assetId) → tool error surfaces in `result.toolCalls`; agent can retry or just produce a reply. Handler doesn't crash.
- "Never silent-fail" preserved end-to-end via the top-level try/catch posting `EXTRACT_FAILED_REPLY` on any unhandled throw.

---

## 9. Testing (Vitest, no live AI, no live R2)

- `lib/storage.test.ts` — mock `@aws-sdk/client-s3` `S3Client.send`; verify `PutObjectCommand` has `Bucket`/`Key`/`Body`/`ContentType`; verify `fetchAsset` returns the bytes from a `GetObjectCommand`.
- `soul/brand-asset.test.ts` — mock storage + Prisma; verify SHA-256 computed deterministically, dedup check skips upload on hit, row created with empty `metadata`, `deduped` flag set correctly. No real bytes — use `new Uint8Array([1,2,3])` etc.
- `lib/ai.test.ts` — `vi.mock("ai")` exposes `generateText`, `gateway`, `stepCountIs`. Mock `generateText` to resolve with scripted `{ text, toolCalls, usage }`. Tests: (a) tool calls reach the `tools` argument; (b) system prompt contains the templated `{{currentContext}}` + new-asset list; (c) image bytes flow as file parts; (d) returned `toolCallSummary` aggregates correctly.
- `soul/extract.test.ts` — rename + updated mock for new `runAgent` shape.
- `telegram/handler.test.ts` — extend with:
  - "ingests image attachment → calls runAgent with newAssets + image bytes"
  - "deduped image → skip ingest's R2 PUT branch (verified by `deduped: true` flag from mocked ingestBrandAsset)"
  - "oversize image → not ingested, oversizeCount=1 passed to runAgent"
  - "multi-attachment: 2 images → 2 newAssets in order"
  - All existing tests reshaped to new mock surface.

---

## 10. Out of scope (Phase 3)

- PDF / sticker / video processing (deferred indefinitely; only image MIME types).
- Signed-URL public access to assets (Phase 4 will fetch by `r2Key` server-side via `fetchAsset`).
- Asset deletion / replacement UX.
- Brand-summary aggregation (the model reads asset metadata on demand in Phase 4 prompts).
- Background-job retry for failed vision labeling (`labelBrandAsset` failure just means the row stays with empty `metadata`; owner can re-send).
- Per-asset thumbnails.
- Image transformations / format conversion.

---

## 11. Future roadmap (continued from Phase 2.5)

- **Phase 4 (next, this session per goal): image generation** — owner asks for an image; bot uses soul + recent `BrandAsset.metadata` + reference image bytes (via `fetchAsset`) → NanoBanana Pro (Gemini multimodal text→image via Gateway) → replies with the generated image. Likely adds a third tool `generateBrandImage` to the agent loop.
- **Phase 5 (later): customer-facing chat** — bot replies on behalf of the salon to its actual customers. Adds multi-turn transcript memory provider.
- **Phase 6+ (later): web UI / canvas** — Approval Queue, streaming, owner dashboard.

---

## 12. Seams preserved

1. `KnowledgeProvider.getBusinessContext(orgId)` — still the only reader of `businessProfile`. Phase 3 reads brand assets via Prisma directly (`runAgent` does not need to consult `businessProfile` extra; Phase 4 will read both).
2. `applySoulUpdate(orgId, partial, prisma)` — still the only writer of `businessProfile`. Now called inside the `extractSoul` tool's `execute`.
3. `lib/ai.runAgent` — the new AI seam. Phase 4 extends the tools list (`generateBrandImage`); architecture unchanged.
4. `lib/storage.ts` — new seam, S3-compatible interface. Could be swapped for any S3 provider.
5. Chat SDK adapter + handler split — unchanged. Telegram-specific code stays in the bot init / webhook route.
