# Qolmeia — Telegram + Soul Foundation (Phase 0 + Phase 1)

- **Date:** 2026-05-19
- **Status:** Approved design — ready for implementation planning
- **Scope:** Phase 0 (prune unneeded apps/packages + rename `acme`→`qolmeia`, one commit) + Phase 1 (Telegram + Soul foundation, no AI yet)
- **Author:** brainstormed with Pedro

---

## 1. Context & Goal

`qolmeia-monorepo` is currently a generic template (everything still named `acme`). Qolmeia is an AI workforce platform; this MVP builds the **ingestion foundation**: a Telegram bot that will (in later phases) receive a business owner's voice notes and distill them into a structured "soul" (business profile) for that owner's Organization.

This spec covers only **Phase 0 + Phase 1**. Phases 2–4 each get their own spec when reached.

### Divergence from canonical plan (acknowledged)

`00-start/mvp.md` states v0 is **web-only** and "Chat SDK is **post-MVP**." Pedro's instruction **overrides** this for this build: Telegram-only, no frontend, Chat SDK now. The canonical schema seams (`Organization`, `Customer`, `Conversation`/`Message`, `WebhookEvent`, `KnowledgeProvider`) are still honored so the work survives v1/v2.

### Decisions locked (from brainstorming)

| Question | Decision |
|---|---|
| Sequencing | Phase 0 = prune + rename in **one combined commit**, verified green; then Phase 1 |
| Pruning | No frontend in MVP → remove `apps/web`, `apps/landing`, `@repo/ui`, `@repo/tailwind-config`. Identity = Telegram chat → remove **Better Auth** entirely (`@repo/auth`, api auth code, 5 auth models). No email → remove `@repo/transactional`. API-only → remove Playwright e2e. Keep: `apps/api`, `@repo/db`, `@repo/config-vitest`, `@repo/typescript-config`, repo tooling. |
| Conversation model | Free-form accumulate (send audio anytime; fields updated/corrected incrementally) |
| Identity | Telegram chat = one `Organization` being onboarded (owner is the tenant) |
| Brand assets / image gen | In scope — but **Phases 3 & 4**, not Phase 1 |
| AI access | **Single key.** Vercel AI Gateway (`AI_GATEWAY_API_KEY`) for everything — text/vision/image **and audio**. Transcription = Telegram voice file sent as an audio input part to a Gemini multimodal model via `generateText` through the Gateway (no `transcribe()`, no OpenAI key). Transcription + 5-field extraction can fuse into one Gateway call. |
| Telegram I/O | Webhook only; local dev via tunnel (cloudflared/ngrok) |
| Post-message UX | Acknowledge + list still-missing fields + accept corrections; no explicit "done" |
| Spec split | Phase 0 + Phase 1 in this one spec; Phases 2–4 separate specs later |
| Local dev infra | `docker-compose.yml` runs **local Postgres + local Redis**. Dev uses local URLs; production Railway `DATABASE_URL`/`REDIS_URL` kept **commented** in git-ignored `.env`. Prevents `db:push` hitting production. |
| Resolved review points | `Customer` model kept in Phase 1 (avoids later FK migration); first contact auto-creates `Organization` with placeholder name; env var is `TELEGRAM_BOT_TOKEN` (not `_ID`). |

### The 5 soul fields

1. Who are you / what does your business do
2. Who is your target audience
3. What you deliver to your customers
4. Who are your competitors
5. Context links (URLs about the business)

---

## 2. Phase 0 — Prune + Rename (one commit)

Trim the template to only what the Telegram/Soul MVP needs, then rename `acme`→`qolmeia` on the slimmed tree. One combined commit, no feature code.

### 2.1 Remove (delete)

- **Apps:** `apps/web/`, `apps/landing/`
- **Packages:** `packages/ui/`, `packages/tailwind-config/`, `packages/auth/`, `packages/transactional/`
- **API auth code:** `apps/api/src/lib/auth.ts`, `apps/api/src/middleware/auth.ts` (+ `.test`), `apps/api/src/routes/v1/users.ts`, `apps/api/src/services/user.service.ts` (+ `.test`)
- **E2E:** `tests/` (whole dir), `playwright.config.ts`
- **Root:** `verify-auth.js`
- Workspace refs to deleted packages in remaining `package.json`s; `@playwright/test` + `test:e2e`/`test:e2e:ui` scripts in root `package.json`; pnpm `onlyBuiltDependencies` entries that are now unused (e.g. `sharp`, `msw`, `@tailwindcss/oxide`, `vue-demi`).

### 2.2 Prisma schema after prune

Better Auth models (`User`, `Session`, `Account`, `Verification`, `RateLimit`) are **removed**. The Phase 1 models (§3.4) become the entire schema. (v1 web app re-adds auth from the canonical schema later.)

### 2.3 API after prune

`apps/api/src/index.ts`: remove the `/api/v1/users` route, the auth middleware, and CORS origins for web/landing. Keep `requestId`, `compress`, `securityHeaders`, rate limiting, `/healthz`, `/readyz`, OpenAPI. `apps/api/src/middleware/security.ts` stays (no Better Auth dependency). Better-Auth-derived rate limiting is gone; `hono-rate-limiter` (in-memory) stays.

### 2.4 docker-compose

`docker-compose.yml` — `name`/`container_name`/`POSTGRES_*`/healthcheck → `qolmeia`/`qolmeia123`/`qolmeia`. **Add a `redis` service** (`redis:7-alpine`, port 6379, healthcheck) so dev has local Postgres + Redis. Local `.env` uses `localhost` URLs; Railway production URLs stay commented.

### 2.5 Rename `acme` → `qolmeia` (case-preserving) on what remains

Across all surviving files: `acme`→`qolmeia`, `Acme`→`Qolmeia`, `ACME`→`QOLMEIA`. Notable: root `package.json` `name`; portless `--name acme.api` in `apps/api/package.json`; `apps/api/src/lib/openapi.ts` contact email + server URLs; `apps/api/src/index.ts` OpenAPI title; remaining `.env.example` files; `README.md`, `AGENTS.md`. Env var cleanup: drop `BETTER_AUTH_SECRET`, `AUTH_ALLOWED_HOSTS`, `TRUSTED_ORIGINS`, `RESEND_API_KEY`, `FROM_EMAIL`, `NEXT_PUBLIC_*`, `WEB_APP_URL`, web/landing CORS origins from `env.ts`/`.env.example`/`turbo.json`.

### 2.6 Exit gate

`pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test` all green, `grep -rniI acme` returns nothing in tracked files. Single combined commit before Phase 1.

---

## 3. Phase 1 — Telegram + Soul Foundation (no AI)

Goal: prove the full pipe — Telegram → API → Postgres → reply — with all later-phase seams stubbed. **No transcription, extraction, R2, or image gen in Phase 1.**

### 3.1 Where it lives

Inside `apps/api` (existing Hono app). Rationale: reuses env loader, Prisma singleton, middleware stack, OpenAPI, Pino logger; `chat-sdk.md` confirms Chat SDK runs on Hono; matches "use our api app." Structured as a deep module behind a thin route so it can later be lifted into `apps/agent` without a rewrite.

### 3.2 Module layout (`apps/api/src/`)

| Path | Responsibility (Phase 1) |
|---|---|
| `telegram/bot.ts` | Chat SDK `Chat` singleton: `@chat-adapter/telegram` + `@chat-adapter/state-redis`. Adapter auto-validates the `X-Telegram-Bot-Api-Secret-Token` header (via `TELEGRAM_WEBHOOK_SECRET_TOKEN`) and dedups updates (`dedupeTtlMs`) — no hand-rolled verifier needed |
| `telegram/handler.ts` | `onSubscribedMessage`/`onNewMention` logic: org/conversation resolution, durable `WebhookEvent` audit row (keyed by `message.id`), persist `Message`, `thread.post()` ack reply |
| `routes/telegram/webhook.ts` | Thin Hono route at `POST /telegram/webhook` → `bot.webhooks.telegram(c.req.raw)` |
| `soul/knowledge-provider.ts` | **Seam #1.** `getBusinessContext(orgId): Promise<string>` — serializes `Organization.businessProfile` JSON to a markdown block (returns "" when empty) |
| `soul/soul.ts` | Soul field types + `applySoulUpdate()` write path through Prisma (used Phase 2; Phase 1 defines types + interface only) |
| `lib/redis.ts` | Raw Redis client for the Phase 2 accumulation buffer — **deferred to Phase 2** (Phase 1 uses Chat SDK's `createRedisState()` which auto-detects `REDIS_URL`) |
| `lib/ai.ts` | Vercel AI Gateway client wrapper — **stub/interface in Phase 1** |
| `lib/storage.ts` | R2 (S3) client wrapper — **stub/interface in Phase 1** |

Callers depend only on `KnowledgeProvider`, `transcribeAudio()` (Phase 2), `storage`, `ai` interfaces — never on raw JSON, Redis keys, or provider SDKs directly.

### 3.3 Environment additions

Added to `apps/api/src/lib/env.ts` Zod schema, `apps/api/.env.example`, and `turbo.json` `env` list:

| Var | Notes |
|---|---|
| `REDIS_URL` | Chat SDK state + Phase 2 buffer. Dev = local docker (`redis://localhost:6379`); Railway production URL kept commented in git-ignored `.env`. |
| `TELEGRAM_BOT_TOKEN` | Pedro said "TELEGRAM_BOT_ID" — Telegram bot auth is a **token**. Auto-detected by `@chat-adapter/telegram` |
| `TELEGRAM_WEBHOOK_SECRET_TOKEN` | Secret-token registered with `setWebhook`; validated **by the adapter** per request. Exact name the adapter expects |
| `TELEGRAM_BOT_USERNAME` | Bot @username; required by `@chat-adapter/telegram` |
| `AI_GATEWAY_API_KEY` | Provided. Stored in git-ignored `apps/api/.env`; placeholder in `.env.example`. Used for text/vision/image **and audio** (Gemini audio part). The only AI key. |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_REGION` | Cloudflare R2 / S3-compatible brand-asset storage (used Phase 3; vars defined Phase 1). All provided (account `6d4f…51ef`, bucket `qolmeia`, region `auto`). Stored in git-ignored `apps/api/.env`; placeholders in `.env.example`. |

Optional vars (Phase 3+ usage: R2) are `.optional()` in Zod so Phase 1 boots without them; `REDIS_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET_TOKEN`, `TELEGRAM_BOT_USERNAME` are required. `AI_GATEWAY_API_KEY` is optional in Phase 1 (no AI yet), required from Phase 2.

### 3.4 Schema (`packages/db/prisma/schema.prisma`)

After Phase 0 removes the Better Auth models, these are the **entire** schema. Canonical shapes from `13-stack/database.md`, trimmed to Phase-1 fields. No `Agent`/`Mission`/billing yet (later phases).

- `Organization` — `id`, `name`, `slug @unique`, `timezone @default("America/Sao_Paulo")`, `currency @default("BRL")`, **`businessProfile Json?`** (the soul; accessed only via `KnowledgeProvider`), timestamps.
- `TelegramLink` — `telegramChatId String @unique`, `orgId`, relation to `Organization`, timestamps. (Maps a Telegram chat to the Organization being onboarded.)
- `Customer` — canonical shape (`orgId`, `phone?`, `email?`, `name?`, `meta?`), `@@unique([orgId, phone])`, `@@unique([orgId, email])`. Defined now for schema stability; not heavily used in Phase 1.
- `Conversation` — `channel Channel @default(TELEGRAM)` (Telegram-only MVP), `externalId?`, `status`, `orgId`, `customerId?`, timestamps.
- `Message` — canonical: `conversationId`, `externalId?`, `sender MessageSender`, `content`, `contentType ContentType @default(TEXT)`, `metadata?`, `@@unique([conversationId, externalId])`.
- `WebhookEvent` — canonical: `provider`, `externalId`, `payload Json`, `status @default("processed")`, `@@unique([provider, externalId])`.
- Enums: extend `Channel` with `TELEGRAM`; reuse canonical `ConversationStatus`, `MessageSender`, `ContentType` (`TEXT`/`AUDIO`/`IMAGE`/...).

Run `pnpm db:generate` + `pnpm db:push`.

### 3.5 Phase 1 flow (no AI)

1. Telegram → `POST /telegram/webhook` → `bot.webhooks.telegram(c.req.raw)`.
2. The `@chat-adapter/telegram` adapter validates the `X-Telegram-Bot-Api-Secret-Token` header (`TELEGRAM_WEBHOOK_SECRET_TOKEN`) and dedups raw updates (`dedupeTtlMs`) — built-in, no app code.
3. Adapter normalizes the update and invokes the `onSubscribedMessage`/`onNewMention` handler with `(thread, message)`.
4. Durable audit/idempotency: upsert `WebhookEvent(provider="telegram", externalId=message.id)`. If already present → return (no-op).
5. Resolve identity: find `TelegramLink` by `thread.id` (Telegram chat id); if absent, create `Organization` (placeholder name from message/thread, generated slug) + `TelegramLink` + a `Conversation` (`channel=TELEGRAM`).
6. Persist inbound `Message` (text → `contentType=TEXT`; voice → `contentType=AUDIO`, attachment ref in `metadata`, **not yet transcribed**).
7. `thread.post()` reply (pt-BR): `"Recebi sua mensagem 👋 Em breve vou transformar seus áudios no perfil do seu negócio."`

### 3.6 Error handling

- The adapter returns the HTTP response; the handler persists `WebhookEvent` before side effects. Handler failures set `WebhookEvent.status="failed"` + structured Pino log (no silent catch); replayable later.
- Invalid secret-token → adapter rejects (built-in); logged by the adapter.
- Redis unavailable → request fails loudly with a logged error; no degraded silent path.
- `KnowledgeProvider.getBusinessContext` returns `""` for empty/missing profile (explicit, not an error).

### 3.7 Testing (Vitest + integration)

- Unit: `KnowledgeProvider` (empty → `""`; populated → markdown block); env schema parsing (required vs optional); the handler logic against a mocked Prisma + a fake `thread`/`message` (org/conversation/message created, ack `thread.post` called, duplicate `message.id` → single row set).
- Local dev doc: `cloudflared tunnel --url http://localhost:4000` (or ngrok) → Telegram `setWebhook` with the tunnel URL + `TELEGRAM_WEBHOOK_SECRET_TOKEN`. Documented in README, not automated.

### 3.8 Explicitly out of Phase 1

Transcription, soul extraction, Redis accumulation buffer logic, R2 uploads, brand-asset metadata, image generation. Phase 1 ships **interfaces/stubs** for `ai`, `storage`, `transcribeAudio`, and `soul` write path so Phases 2–4 are additive.

---

## 4. Future phases (separate specs)

- **Phase 2 — Audio → Soul:** download Telegram voice file → send as an audio input part to a Gemini multimodal model via Gateway `generateText` (transcription + structured incremental extraction of the 5 fields, fused into one call where practical) → `applySoulUpdate()` → bot acknowledges + lists missing + accepts corrections.
- **Phase 3 — Brand assets:** Telegram image/doc → R2 upload → Gateway vision extracts palette/fonts → attached to `businessProfile`.
- **Phase 4 — Image generation:** NanoBanana Pro (Gemini image via Gateway `generateText` `files`) using soul + brand metadata → image returned to Telegram.

## 5. Key seams that must survive v1/v2

1. `KnowledgeProvider.getBusinessContext(orgId)` — callers never read `businessProfile` JSON directly.
2. Canonical `WebhookEvent` / `Conversation` / `Message` / `Customer` shapes (additive subset now).
3. Audio handling isolated behind `transcribeAudio()` — implemented via the AI Gateway (Gemini audio part); provider-agnostic seam, swappable without touching callers.
4. Telegram delivery behind the Chat SDK adapter — channel-agnostic handler.
