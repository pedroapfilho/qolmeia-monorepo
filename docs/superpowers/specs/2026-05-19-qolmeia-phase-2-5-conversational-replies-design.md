# Qolmeia — Phase 2.5: Conversational Replies + Sharpen Soul Fields

- **Date:** 2026-05-19
- **Status:** Approved design — ready for implementation planning
- **Scope:** Phase 2.5 only. Builds on Phase 0+1+2 on `main` (HEAD `e49853a`).
- **Author:** brainstormed with Pedro

---

## 1. Context & Goal

Phase 2 shipped extraction + 4 deterministic pt-BR reply templates. In live testing the limit surfaced fast: the bot can only ever say _"Anotei: …"_, _"Tudo capturado!"_, _"Não consegui captar nada útil…"_, or _"Tudo certo, nada novo por aqui."_ — feels rigid, can't answer questions, can't hold small talk, can't reflect the owner's brand tone.

Phase 2.5 makes the bot **conversational**:

- LLM writes every happy-path reply (fused with extraction in one Gateway call).
- Answers questions about the captured soul, with polite deflection of off-topic.
- Mirrors the owner's `brandVoice` in its tone once that field is captured.
- Sharpens the soul fields (5, all strings) for better downstream use in Phase 3+.

### Decisions locked (from brainstorming)

| Question            | Decision                                                                                                                                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope               | Small-talk + Q&A about the captured soul + polite deflection of off-topic (jokes, news, code, general knowledge).                                                                                                                                              |
| Reply path          | LLM writes every reply on the happy path via a **single fused `generateObject` call** returning `{ partial, reply }`. Deterministic copy retained only for error/edge branches (empty-text short-circuit, audio-download-fail, extract-fail, top-level catch). |
| Model               | `gemini-2.5-flash` via Vercel AI Gateway (unchanged).                                                                                                                                                                                                          |
| Reply length        | Zod `z.string().min(1).max(500)`; system prompt asks for 1–3 sentences pt-BR.                                                                                                                                                                                  |
| Persona             | Warm, profissional, breve. No bot name. Brand-voice mirroring **on by default** once `brandVoice` is captured.                                                                                                                                                 |
| Hallucination guard | "Nunca invente fatos sobre o negócio. Se não souber, pergunte."                                                                                                                                                                                                |
| Soul fields         | **5, all strings**: `whatYouDo` (merged in `whatYouDeliver`), `targetAudience`, `differentiator` (replaces `competitors`), `brandVoice` (new), `location` (new). `contextLinks` removed.                                                                       |
| DB migration        | None. `Organization.businessProfile` is a Json blob; old keys from the live test row will be silently ignored by the new code. Wipe via Prisma Studio if desired.                                                                                              |

### Final soul fields (pt-BR labels inlined in system prompt)

| Field            | pt-BR phrasing                          |
| ---------------- | --------------------------------------- |
| `whatYouDo`      | o que vocês fazem e entregam            |
| `targetAudience` | seu público-alvo                        |
| `differentiator` | o que diferencia vocês dos concorrentes |
| `brandVoice`     | tom de voz / personalidade da marca     |
| `location`       | cidade / região de atuação              |

---

## 2. Module changes

### Delete (dead after the switch)

- `apps/api/src/soul/reply.ts` + `apps/api/src/soul/reply.test.ts` — deterministic templates no longer used on the happy path; error/edge branches inline a static string.
- `apps/api/src/soul/labels.ts` + `apps/api/src/soul/labels.test.ts` — labels now embedded directly in the system prompt; no other consumers.

### Modify

- `apps/api/src/soul/soul.ts` — `SoulProfile` becomes `{ whatYouDo?, targetAudience?, differentiator?, brandVoice?, location?: string }`. Update `SOUL_FIELDS` to the new 5-key list (still consumed by `apply.ts` for the scalar patch-merge loop). Drop `missingSoulFields` (its only caller was the deleted `reply.ts`).
- `apps/api/src/lib/ai.ts` — schema is now `{ partial: <5 nullable strings>, reply: z.string().min(1).max(500) }`. Rewrite the system prompt (see §3). Return shape: `{ partial, reply, usage }`.
- `apps/api/src/lib/ai.test.ts` — assert the new schema field names + that `reply` propagates; existing call-shape assertions stay (model id, system prompt content, audio/text content parts).
- `apps/api/src/soul/extract.ts` — propagate `reply` through the orchestrator return type.
- `apps/api/src/soul/extract.test.ts` — add `reply` to the mock return; assert it propagates.
- `apps/api/src/soul/apply.ts` — drop the `contextLinks` array branch + `dedupe` helper; the merge is now pure scalar patch (overwrite on differ, `null`/`undefined` preserve). Field-by-field assignment narrows to the 5 new fields.
- `apps/api/src/soul/apply.test.ts` — drop the `contextLinks` union test; rename fields in the existing scalar tests; add a small test covering `differentiator` + `brandVoice` + `location` overwrite.
- `apps/api/src/telegram/handler.ts` — drop imports of `buildReply` (and `SoulProfile` if only used there). On the happy path: `await thread.post(result.reply)` (was `buildReply(newProfile, capturedFields)`). Empty-text short-circuit replies with a single inline static string: `"Recebi sua mensagem, mas não entendi. Pode tentar de novo?"`. The audio-download / extract / top-level catches keep their existing apology strings. Logging now records `replyLength: result.reply.length`.
- `apps/api/src/telegram/handler.test.ts` — default `extractFromMessage` mock returns `{ partial: { whatYouDo: "salão" }, reply: "Anotei que vocês são um salão!", usage }`. The "captured/missing summary" test asserts `thread.post` was called with the mocked `reply` string (not the deterministic template). Idempotency, audio download, audio-download-fail, extract-fail, function-stripping, and DB-write-apology tests unchanged.

### Net effect

4 files deleted, 7 modified. No new modules. Net line count decreases.

---

## 3. System prompt (pt-BR, inlined in `lib/ai.ts`)

The system prompt template (with `{{currentContext}}` interpolated per call):

```
Você é um assistente onboarding de negócio. O dono fala com você por texto ou áudio em português brasileiro.

Sua missão é dupla, em UMA resposta:
1) EXTRAIR (campo `partial`) qualquer informação sobre o negócio nas 5 áreas:
   - whatYouDo: o que vocês fazem e entregam
   - targetAudience: seu público-alvo
   - differentiator: o que diferencia vocês dos concorrentes
   - brandVoice: tom de voz / personalidade da marca
   - location: cidade / região de atuação
2) RESPONDER (campo `reply`) em pt-BR, 1-3 frases (máx 500 caracteres).

Perfil atual:
{{currentContext}}

Regras de `partial`:
- Atualize SOMENTE campos que a mensagem deixa explícitos.
- Preserve correções ("na verdade meu público é X" → targetAudience: X).
- Campos não mencionados ficam null.

Regras de `reply`:
- Se `brandVoice` está preenchido no perfil, adote esse tom na resposta. Se não, use um tom caloroso e profissional padrão.
- Se a mensagem trouxe informação nova: agradeça citando o que entendeu e peça naturalmente um campo que ainda falta.
- Se o perfil está completo e a pessoa só conversa: responda usando APENAS o que está no perfil. Se ela perguntar algo que não está no perfil, diga que ainda não sabe e ofereça registrar.
- Se a mensagem for fora do tema (piadas, notícias, código, conhecimento geral): redirecione com gentileza para o negócio.
- Nunca invente fatos sobre o negócio. Se não souber, pergunte.
```

When `businessProfile` is empty, `getBusinessContext(orgId)` returns `""`, and `renderSystemPrompt` substitutes `"(perfil vazio)"` into `{{currentContext}}` (unchanged from Phase 2).

---

## 4. Zod schema

```ts
const interactionSchema = z.object({
  partial: z.object({
    brandVoice: z.string().nullable(),
    differentiator: z.string().nullable(),
    location: z.string().nullable(),
    targetAudience: z.string().nullable(),
    whatYouDo: z.string().nullable(),
  }),
  reply: z.string().min(1).max(500),
});

type PartialSoul = z.infer<typeof interactionSchema>["partial"];
```

`generateObject` is called with `schema: interactionSchema`, `temperature: 0.2`, `system: renderSystemPrompt(currentContext)`, and the same user-content shape as Phase 2 (audio file part or text part). Return mapping: `{ partial: result.object.partial, reply: result.object.reply, usage: { inputTokens, outputTokens } }`.

---

## 5. Flow (per inbound message)

1-6 (unchanged from Phase 2): idempotency via `WebhookEvent` → identity (Organization + TelegramLink + Conversation) → persist `Message` → empty-text short-circuit (now with the inline static reply above) → audio download with apology on fail. 7. `result = await extractFromMessage(input, currentContext)` returns `{ partial, reply, usage }`. 8. `{ newProfile, capturedFields } = await applySoulUpdate(orgId, result.partial, prisma)` — scalar-only patch-merge. 9. **`await thread.post(result.reply)`** (the LLM reply). 10. `logger.info` with `capturedFields`, `replyLength`, `tokensIn`, `tokensOut`, `kind`.

---

## 6. Error / edge branches (deterministic, unchanged from Phase 2)

| Branch                                               | Reply                                                                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty text + no audio                                | `"Recebi sua mensagem, mas não entendi. Pode tentar de novo?"` (inline static, replacing the Phase 2 `buildReply({}, [])` call which is no longer applicable) |
| `audio.download_failed`                              | `DOWNLOAD_FAILED_REPLY = "Não consegui baixar seu áudio, pode reenviar?"`                                                                                     |
| `extract.failed`                                     | `EXTRACT_FAILED_REPLY = "Tive um problema processando sua mensagem, pode tentar de novo?"`                                                                    |
| Top-level catch (DB, applySoulUpdate, anything else) | `EXTRACT_FAILED_REPLY`                                                                                                                                        |

The Phase 2 "never silent-fail" wrap stays in handler.ts.

---

## 7. DB migration

None. `Organization.businessProfile` is a Json blob; the schema doesn't constrain its shape. The single existing row from the live test will silently carry orphan keys (`whatYouDeliver`, `competitors`, `contextLinks`) that the new code ignores. Either wipe via Prisma Studio or just send new messages to repopulate with the new shape.

---

## 8. Testing (Vitest, no live AI)

- `lib/ai.test.ts` — call-shape assertions remain (model id, system prompt contains "(perfil vazio)" + Portuguese keywords, audio/text content parts). Mock `generateObject` to return `{ object: { partial: { whatYouDo: "X", … }, reply: "..." }, usage: { … } }`. Add an assertion that `result.reply` and `result.partial.whatYouDo` propagate.
- `soul/extract.test.ts` — update mocked return to include `reply`; assert it's passed through unchanged.
- `soul/apply.test.ts` — drop `contextLinks` test; rename fields; assert scalar overwrite on `differentiator`/`brandVoice`/`location`; null preserves; capturedFields correctness.
- `telegram/handler.test.ts` — default mock includes `reply`; the "captured/missing summary" test now asserts `thread.post(result.reply)`. Empty-text test asserts the inline static string. All other tests unchanged.
- `soul/soul.ts` no longer exports `missingSoulFields` (only `reply.ts` consumed it, deleted). `SOUL_FIELDS` is updated to the new 5-key list but still exported (consumed by `apply.ts`).

---

## 9. Future roadmap (planned, not implemented here)

The four items previously listed as "out of scope" are explicitly phased now:

- **Tool / function calling** → **Phase 3** (R2 brand assets). Needed because Phase 3 wants the model to _call_ something (`store_brand_asset`, `extract_palette`) rather than have the handler imperatively route. Phase 3's brainstorm must decide whether to extend `generateObject` with tools or split into a separate "agent mode" handler using `generateText({ tools })`. This is the natural moment because Phase 3 is the first phase with more than one possible action the model could choose.
- **Multi-turn transcript memory** → **Phase 5** (customer-facing chat — bot replies to the _salon's_ customers, not just the owner). For owner-onboarding (Phase 2.5), the soul IS the memory. The `Conversation`/`Message` tables already exist in the schema; Phase 5 adds a memory provider that injects last-N messages into the prompt alongside `getBusinessContext`.
- **Streaming replies** → **Phase 6+** (web UI / canvas). Telegram has no partial-message UI; streaming is wasted there. Light up when there's a frontend that can render token-by-token (the Approval Queue / dashboard from the canonical briefing).
- **Per-user persona** → **landed in Phase 2.5** via `brandVoice` + the brand-voice-mirroring prompt rule. No further phase needed unless we want overrides beyond `brandVoice` (e.g. per-channel tone, per-customer-segment tone), which can wait.

The canonical phase roadmap (running tally):

| Phase   | Scope                                                                    | Status          |
| ------- | ------------------------------------------------------------------------ | --------------- |
| 0       | Prune `acme` template + rename                                           | ✅              |
| 1       | Telegram + Soul foundation (no AI)                                       | ✅              |
| 2       | Audio→Soul extraction                                                    | ✅              |
| **2.5** | **Conversational replies + sharpen soul fields + brand-voice mirroring** | **this spec**   |
| 3       | R2 brand assets (introduces tool calling)                                | next brainstorm |
| 4       | Image generation (NanoBanana Pro via Gateway, uses Phase 3 tools)        | later           |
| 5       | Customer-facing chat (introduces multi-turn transcript memory)           | later           |
| 6+      | Web UI / canvas (introduces streaming, Approval Queue)                   | later           |

---

## 10. Seams preserved

1. `KnowledgeProvider.getBusinessContext(orgId)` — still the only reader of `businessProfile`. The new system prompt consumes its output verbatim.
2. `applySoulUpdate(orgId, partial, prisma)` — still the only writer of `businessProfile`. Simplified internally (no array branch) but the signature is identical.
3. `lib/ai.extractSoul` — still the only AI seam. The return shape grows by one field (`reply`); existing callers see the additional field as an additive change.
4. Chat SDK adapter + handler split — unchanged. Channel-agnostic.
5. The Phase 2 "never silent-fail" wrap + `toJsonSafe` payload sanitizer — unchanged.
