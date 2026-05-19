# Qolmeia — Phase 2: Audio → Soul (extraction pipeline)

- **Date:** 2026-05-19
- **Status:** Approved design — ready for implementation planning
- **Scope:** Phase 2 only. Builds on the Phase 0+1 foundation already on `main` (HEAD `45fd419`).
- **Author:** brainstormed with Pedro

---

## 1. Context & Goal

Phase 1 proved the full pipe Telegram → API → Postgres → reply with all AI seams stubbed. Phase 2 turns inbound messages into a populated **soul** (`Organization.businessProfile`): the bot understands voice notes and text, extracts the 5 fields, merges them into the profile, and acknowledges in pt-BR what it captured + what's still missing — accepting corrections at any time (free-form accumulate).

What's already in place (foundation):
- `apps/api/src/telegram/handler.ts` — resolves org/conversation, persists `Message` (audio → `contentType=AUDIO` + attachment ref in `metadata`), replies with a fixed pt-BR ack. Phase 2 replaces only the ack-and-extract portion.
- `apps/api/src/soul/soul.ts` — `SoulProfile` types + `missingSoulFields()`.
- `apps/api/src/soul/knowledge-provider.ts` — **Seam #1**: `getBusinessContext(orgId)` serializes the current profile to a markdown block.
- `apps/api/src/telegram/bot.ts` — Chat SDK with Telegram + Redis state, `mode:"webhook"`.
- Env: `AI_GATEWAY_API_KEY` already in `apps/api/.env` (gitignored) and `.env.example` (placeholder), currently optional in the Zod schema — Phase 2 promotes to required.

### Decisions locked (from brainstorming)

| Question | Decision |
|---|---|
| Model | `gemini-2.5-flash` via Vercel AI Gateway model string `"google/gemini-2.5-flash"` |
| Call shape | One fused `generateObject` call (AI SDK structured-output) with a Zod schema mirroring `SoulProfile`; audio sent as a file content part |
| Inputs | Both **audio** and **text** messages feed extraction. Same call shape, only the user-content part differs |
| Merge | **Patch-merge** — scalars overwrite, `contextLinks` array union+dedupe (insertion order preserved), `undefined`/`null` from the model preserve existing |
| Reply | **Server-built** deterministic pt-BR templates keyed off captured-this-turn + `missingSoulFields(profile)`. No LLM-built replies in this phase |
| Prompt context | Current profile passed via `KnowledgeProvider.getBusinessContext(orgId)` so the model respects what's already filled and accepts corrections |
| Concurrency | Chat SDK `concurrency: "queue"` (per-chat serialization) prevents same-chat races; cross-chat races touch different rows |
| `competitors` shape | Stays `string` (not `Array<string>`) per existing `SoulProfile`. YAGNI for Phase 2; promote later if it bites |
| Failure mode | No silent fail: every extraction/download error is logged + the bot replies with a pt-BR apology + retry hint |

---

## 2. Module layout (new files in `apps/api/src/`)

| Path | Responsibility (one clear thing) |
|---|---|
| `lib/ai.ts` | Vercel AI Gateway client wrapper. Exports `extractSoul(input, currentContext): Promise<{ partial: PartialSoul; usage: { inputTokens; outputTokens } }>`. Builds the `generateObject` call (model id `"google/gemini-2.5-flash"`, system prompt, Zod schema, temperature 0.2). Reads `AI_GATEWAY_API_KEY` via `env`. **The single AI-provider seam.** |
| `soul/extract.ts` | Thin orchestrator: takes the inbound message + current profile, builds the `Input` (audio file part or text part), calls `lib/ai.extractSoul`, returns the partial. No persistence concerns. |
| `soul/apply.ts` | `applySoulUpdate(orgId, partial, prisma): Promise<{ newProfile; capturedFields }>` — patch-merge semantics in a single Prisma transaction. The only writer of `Organization.businessProfile`. |
| `soul/reply.ts` | `buildReply(newProfile, capturedFields): string` — deterministic pt-BR templates (three branches: some captured / all complete / nothing captured). |
| `soul/labels.ts` | The single source of pt-BR field labels (`whatYouDo→"o que vocês fazem"`, …). Used by `reply.ts`. |

Modified file:
- `apps/api/src/telegram/handler.ts` — replaces the fixed ack with: build `Input` for `TEXT` or `AUDIO` → `extract` → `apply` → `reply` → `thread.post(reply)`. Idempotency, org/conversation resolution, and Message persistence (Phase 1) are unchanged.

Modified bot wiring:
- `apps/api/src/telegram/bot.ts` — explicit `concurrency: "queue"` in the `new Chat({…})` config.

Modified env:
- `apps/api/src/lib/env.ts` — `AI_GATEWAY_API_KEY` becomes required (`z.string().min(1)`) instead of optional. `apps/api/src/lib/vitest-setup.ts` adds a stub value so tests don't break.

Dependencies added to `apps/api`:
- `ai` (Vercel AI SDK) and `@ai-sdk/google` (for the `google/gemini-2.5-flash` model via the Gateway routing). Versions to be resolved at install time.

---

## 3. Data flow (per inbound message)

1. Webhook → handler (Phase 1 unchanged: idempotency via `WebhookEvent`, org/`TelegramLink`/`Conversation` resolution, `Message` persisted).
2. Read current context: `currentContext = await getBusinessContext(orgId)` (empty string on first contact).
3. Build `Input`:
   - `contentType === "AUDIO"`: download via `attachment.fetchData()`; `Input = { kind: "audio", bytes, mediaType: attachment.mimeType ?? "audio/ogg" }`.
   - `contentType === "TEXT"`: `Input = { kind: "text", text: message.text ?? "" }`. If `text` is empty/whitespace, skip extraction and go to step 7 with `capturedFields = []`.
4. `partial = await extractSoul(input, currentContext)` — single fused call.
5. `{ newProfile, capturedFields } = await applySoulUpdate(orgId, partial, prisma)` — patch-merge in one transaction.
6. `reply = buildReply(newProfile, capturedFields)`.
7. `await thread.post(reply)`; log structured (orgId, messageId, model, tokens, capturedFields, missingFields, latency).

---

## 4. Prompt + schema

**System prompt (pt-BR, in `lib/ai.ts`):**

> Você extrai informações de negócio do dono. Aqui está o perfil atual:
> `{{currentContext}}`
> A mensagem do usuário pode estar em áudio ou texto, em português brasileiro. Atualize SOMENTE os campos que a mensagem deixa explícitos. Preserve correções (ex.: "na verdade meus concorrentes são X"). Não invente; deixe campos não mencionados como `null`.

**Zod schema (`PartialSoul`):**
```ts
const partialSoulSchema = z.object({
  whatYouDo: z.string().nullable(),
  targetAudience: z.string().nullable(),
  whatYouDeliver: z.string().nullable(),
  competitors: z.string().nullable(),
  contextLinks: z.array(z.string()).nullable(),
});
```
Every field nullable — the model returns `null` for fields it can't extract from this message.

**Call shape (`generateObject`):**
```ts
await generateObject({
  model: "google/gemini-2.5-flash",   // resolved through AI Gateway
  schema: partialSoulSchema,
  temperature: 0.2,
  system: renderSystemPrompt(currentContext), // interpolates {{currentContext}}
  messages: [{ role: "user", content: [<inputPart>] }],
});
```
`<inputPart>` is `{ type: "file", data: bytes, mediaType }` for audio, or `{ type: "text", text }` for text. The current-profile context lives **only** in the system prompt — not duplicated in the user turn.

> Implementer note: the AI SDK version installed determines the exact model-passing shape (string `"google/gemini-2.5-flash"` resolved via Gateway provider routing, vs imported `google()` from `@ai-sdk/google`). Plan-time will verify against installed `.d.ts` and adjust import; spec captures intent.

---

## 5. Merge semantics (`applySoulUpdate`)

In a single Prisma transaction:
1. Read `existing = org.businessProfile ?? {}`.
2. For each field key in `SoulProfile`:
   - `partial[k] === undefined` → keep `existing[k]`.
   - `partial[k] === null` → keep `existing[k]` (model said "not in this message").
   - Field is `contextLinks` (array): `new[k] = dedupe([...(existing[k] ?? []), ...partial[k]])` (preserve insertion order; dedupe by exact string match).
   - Otherwise (scalar string): `new[k] = partial[k]` (overwrite).
3. `capturedFields = keys where new[k] !== existing[k]`.
4. Write `new` back to `Organization.businessProfile` and return `{ newProfile: new, capturedFields }`.

Idempotency / no-op: if `capturedFields` is empty, still write (cheap upsert) and proceed; caller uses the empty array to drive the "nothing captured" reply branch.

---

## 6. Reply templates (pt-BR, in `soul/reply.ts`)

Let `missing = missingSoulFields(newProfile)` and `captured = capturedFields`. Field labels come from `soul/labels.ts`.

- `captured.length > 0 && missing.length > 0`
  → `"Anotei: {captured_labels_pt}. Ainda preciso saber: {missing_labels_pt}."`
- `captured.length > 0 && missing.length === 0`
  → `"Tudo capturado! Você pode me corrigir a qualquer momento."`
- `captured.length === 0 && missing.length > 0`
  → `"Não consegui captar nada útil dessa mensagem. Pode tentar descrever {first_missing_label_pt}?"`
- `captured.length === 0 && missing.length === 0`
  → `"Tudo certo, nada novo por aqui."` (unlikely path — already complete, nothing new)

Labels (`soul/labels.ts`):
- `whatYouDo` → `"o que vocês fazem"`
- `targetAudience` → `"seu público-alvo"`
- `whatYouDeliver` → `"o que vocês entregam"`
- `competitors` → `"seus concorrentes"`
- `contextLinks` → `"links sobre o negócio"`

Lists joined with `", "` and final `" e "` (e.g., `"X, Y e Z"`).

---

## 7. Errors, concurrency, observability

- `attachment.fetchData()` throws → log `audio.download_failed` with `messageId`/`attachment.name`; `thread.post("Não consegui baixar seu áudio, pode reenviar?")`; return.
- `extractSoul` throws (Gateway/rate-limit/safety/timeout) → log `extract.failed` with the error; `thread.post("Tive um problema processando sua mensagem, pode tentar de novo?")`; return.
- `applySoulUpdate` Prisma error → bubbles up to the outer handler's error path (no silent catch). Logged + generic apology reply.
- Empty text (`text.trim() === ""`) → skip extraction entirely; reply uses the "nothing captured" branch.
- **Never silent-fail.** Every error has a log + a user-visible reply.

Concurrency: Chat SDK `concurrency: "queue"` (set in `bot.ts`). Per-chat serialization ensures two voice notes from the same Telegram chat can't race against the same `businessProfile` row. Cross-chat parallelism is fine (different rows).

Observability: Pino structured log per handled message:
```json
{ "orgId", "messageId", "channel": "TELEGRAM", "kind": "audio"|"text",
  "model": "google/gemini-2.5-flash", "tokensIn", "tokensOut",
  "capturedFields", "missingFields", "latencyMs" }
```

---

## 8. Env change

`apps/api/src/lib/env.ts`:
- `AI_GATEWAY_API_KEY: z.string().min(1)` — promote from `.optional()`.

`apps/api/src/lib/vitest-setup.ts`:
- Add `vi.stubEnv("AI_GATEWAY_API_KEY", "test-key")` so the env-load throw at module import doesn't break the test suite.

No other env additions.

---

## 9. Testing (Vitest, no live AI)

- `lib/ai.test.ts` — mock the underlying AI SDK (`vi.mock("ai", ...)` or inject a fake client); verify `extractSoul` builds the right `generateObject` args (model id, schema, system prompt includes the passed `currentContext`, user message includes the audio file part or text part).
- `soul/extract.test.ts` — given a stubbed `lib/ai` return, verify pass-through and Zod conformance.
- `soul/apply.test.ts` — patch-merge: scalar overwrite, `contextLinks` union+dedupe (preserves order), `null` preserves, `undefined` preserves; `capturedFields` correctness; runs in a Prisma transaction (mock).
- `soul/reply.test.ts` — each of the four branches (some / all / none captured, + the all-complete-nothing-new edge); label rendering with `", "` and `" e "`.
- `soul/labels.test.ts` — every `SoulProfile` key has a label (compile-time and runtime).
- `telegram/handler.test.ts` (extended) — TEXT triggers extract; AUDIO triggers `fetchData` + extract; reply derived from missing list; idempotency still holds; extraction failure → apology reply (no throw out of handler).

---

## 10. Out of scope (later phases / explicit non-goals)

- R2 brand assets (Phase 3).
- Image generation / NanoBanana Pro (Phase 4).
- Explicit "done" / lock-soul UX — locked decision: no explicit done.
- LLM-built reply text — deterministic only at MVP.
- Multi-language detection — pt-BR assumed.
- Admin/owner commands (`/reset`, `/show`, `/start`) — deferred.
- Promoting `competitors` to `Array<string>` — deferred (YAGNI).
- Background-job retry queue for failed extractions — deferred (current behavior: user re-sends).
- Cost dashboard / per-tenant token accounting — deferred.

---

## 11. Seams that must survive (continued from Phase 1)

1. **`KnowledgeProvider.getBusinessContext(orgId)`** — still the only path readers use to consume `businessProfile`. Phase 2's `extract.ts` reads through this; nothing reads the JSON directly.
2. **`applySoulUpdate(orgId, partial, prisma)`** — the only writer of `businessProfile`. v1 swaps the storage backend (wiki) without touching callers.
3. **`lib/ai.ts.extractSoul`** — provider-agnostic. Swapping models/providers is a single-file change.
4. **Chat SDK adapter / handler split** — unchanged from Phase 1; channel-agnostic handler still applies.
