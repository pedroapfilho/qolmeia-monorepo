# P6 — More Channels, More Worker Types, Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make channel parity _real_. Add **Telegram, WhatsApp, Slack, Discord** connector adapters under the uniform `ConnectorAdapter` contract from the spec (no connector DO — all routing is the stateless Worker, decision 7). Add **`transcribeAudio`** so audio-in is just another input modality. Seed the catalog with **MarketingStrategist + Support + Sales** Worker templates so customers can hire a real Team. Wire **`this.schedule()` recurring agent work** so a Worker can run a weekly report or daily scan.

**Architecture:** Each channel is a pure module — `parseInbound`, `sendOutbound`, `verify`, `resolveIdentity` — registered in a typed `connectorRegistry`. Stateless Worker routes `/webhooks/:type/:connectorId` look up the `connector` row, verify the signature, idempotency-check via `webhook_event`, normalize to `NormalizedMessage`, resolve `companyId`, and RPC `corr:{companyId}`. Web chat keeps its first-class direct WebSocket path; everything else routes through the webhook adapter. Channels differ only below the `NormalizedMessage` line — streaming token-by-token on web, buffered + "digitando…" on Telegram, etc. — and that difference is fully encapsulated in each adapter's `sendOutbound`. `transcribeAudio` is a skill that the Correspondent calls when it receives an audio attachment; powered by Workers AI speech model. `this.schedule(cron, method, payload)` on a Worker DO runs a recurring tick — a heartbeat that scans the Worker's own tickets and decides actions.

**Tech stack:** native `fetch` for each provider's send-API (no third-party SDKs unless one is genuinely the only way), Workers AI speech model (`@cf/openai/whisper` or current best multilingual), `this.schedule` on the `agents` SDK `Agent`, `@cloudflare/vitest-pool-workers`.

**Builds on:** `main` after P5 merged.

**Architectural calls baked in** (T1.4 override):

1. **No third-party SDK per channel.** Telegram/WhatsApp/Slack/Discord APIs are simple HTTP — use `fetch`. A bot-framework SDK is a heavy dep when the spec's `ConnectorAdapter` shape is already a thinner API. Less weight, fewer transitive deps, no version churn.
2. **`transcribeAudio` runs on the Correspondent, not on a dedicated transcription Worker.** Audio-in is rare enough at launch that pinning a Worker for it adds latency and complexity; the Correspondent can call the skill inline.
3. **Scheduled work is per-Worker, not platform-wide.** `Routine`-style recurring jobs live on the Worker that owns them. `template.schedule` (JSON: `{ cron, method }`) declares them; `this.schedule()` registers them on first boot (idempotent).

---

## File map

| File                                                      | Tasks | Responsibility                                                                                              |
| --------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------- |
| `apps/agents/src/connectors/types.ts` (new)               | 2     | `ConnectorAdapter` contract + `NormalizedMessage` type                                                      |
| `apps/agents/src/connectors/registry.ts` (new)            | 2     | `connectorRegistry: Record<ConnectorType, ConnectorAdapter>` (total over the enum)                          |
| `apps/agents/src/connectors/telegram/adapter.ts` (new)    | 3     | Telegram inbound/outbound + HMAC verify                                                                     |
| `apps/agents/src/connectors/whatsapp/adapter.ts` (new)    | 4     | WhatsApp Meta Cloud + verify-token handshake + signature                                                    |
| `apps/agents/src/connectors/slack/adapter.ts` (new)       | 5     | Slack Events API + URL-verify + signing-secret                                                              |
| `apps/agents/src/connectors/discord/adapter.ts` (new)     | 6     | Discord interactions + Ed25519 verify                                                                       |
| `apps/agents/src/routes/webhooks.ts` (new)                | 2     | `POST /webhooks/:type/:connectorId` — the one stateless webhook handler                                     |
| `apps/agents/src/skills/transcribe-audio.ts` (new)        | 7     | Workers AI speech model; returns transcript text                                                            |
| `apps/agents/src/agents/correspondent.ts` (extend)        | 7     | Detects audio attachment in inbound `NormalizedMessage` → calls `transcribeAudio` first                     |
| `apps/agents/src/agents/worker.ts` (extend)               | 9     | `onStart` reads `template.schedule` and registers `this.schedule(cron, method)`                             |
| `apps/agents/migrations/0006_p6_more_templates.sql` (new) | 8     | Seed MarketingStrategist, Support, Sales templates + their `skill` overlays                                 |
| `apps/agents/wrangler.jsonc`                              | 7     | `ai` binding for transcription (added in P2 already if Vectorize deployed)                                  |
| `apps/agents/src/__tests__/*.test.ts` (new)               | 10    | Per-adapter parseInbound/sendOutbound · webhook handler dedup · transcribeAudio path · scheduled tick fires |

---

## Tasks

### T1: Setup

- [ ] Branch from `main` → `feat/p6-channels-workers-scheduling`. Baseline gates green.
- [ ] Confirm baked-in calls (no per-channel SDKs, transcription on Correspondent, scheduled work per-Worker).
- [ ] Inventory the credentials each channel needs at deploy: Telegram bot token + webhook secret; WhatsApp phone number id + access token + app secret + verify token; Slack bot token + signing secret; Discord application public key + bot token. These go into `connector.config_ref` (secret store reference) per company.

### T2: ConnectorAdapter contract + webhook router

- [ ] `src/connectors/types.ts` — the contract from spec §6.1: `verify`, `parseInbound`, `sendOutbound`, `resolveIdentity`.
- [ ] `src/connectors/registry.ts` — total over the `ConnectorType` enum; unknown channel returns a `NotImplemented` placeholder so the type is still exhaustive.
- [ ] `src/routes/webhooks.ts` — one Hono route `POST /webhooks/:type/:connectorId`. Pipeline: load `connector` row → `adapter.verify` → `webhook_event` dedup → `adapter.parseInbound` (null → 200, no DO call — receipts/typing indicators) → `adapter.resolveIdentity` → upsert `conversation` → RPC `env.CORRESPONDENT.get(...).handleInbound(normalized)` → 200.

### T3: Telegram adapter

- [ ] `src/connectors/telegram/adapter.ts` — `parseInbound`: pulls text + audio + photos from the update; `sendOutbound`: `POST https://api.telegram.org/bot<token>/sendMessage` (or `sendPhoto` for image messages); `verify`: header `X-Telegram-Bot-Api-Secret-Token` matches the connector secret.
- [ ] Audio: passes `file_id` through `parseInbound`; the Correspondent fetches via `getFile` lazily during transcription.

### T4: WhatsApp adapter

- [ ] Meta Cloud API: `verify` covers (a) the `GET ?hub.verify_token=...` setup handshake (return the challenge) and (b) the `X-Hub-Signature-256` HMAC on POSTs. `parseInbound` handles text + image + audio + interactive replies. `sendOutbound`: `POST https://graph.facebook.com/v22.0/{phoneNumberId}/messages`.
- [ ] Salvage the existing `apps/api/src/connectors/whatsapp/adapter.ts` shape — the project already has a working WhatsApp adapter; port the verification + payload-parsing helpers (concepts only, not the Node code).

### T5: Slack adapter

- [ ] Events API: `verify` covers (a) the `url_verification` challenge (echo `challenge`) and (b) the `X-Slack-Signature` HMAC. `parseInbound` for `message.im` events. `sendOutbound`: `chat.postMessage`.

### T6: Discord adapter

- [ ] Interactions endpoint: `verify` is Ed25519 over `X-Signature-Ed25519` + `X-Signature-Timestamp` + body. `parseInbound` for `MESSAGE_CREATE` events (gateway is heavier; sticking to the interactions/webhook surface where possible). `sendOutbound`: webhook execute or `POST /channels/{id}/messages` with a bot token.

### T7: `transcribeAudio` skill + Correspondent integration

- [ ] `src/skills/transcribe-audio.ts` — input `{ assetId | bytes; mime; locale? }`. Calls `env.AI.run("@cf/openai/whisper" or current best multilingual)`. Returns `{ text, language, confidence? }`.
- [ ] In `correspondent.ts` `handleInbound(normalized)`: if the message has an audio attachment, call `transcribeAudio` first, append `[áudio: <transcript>]` to the user message text before running the chat loop.

### T8: More templates

- [ ] Migration `0006` inserts MarketingStrategist, Support, Sales templates with their respective system prompts (pt-BR) and `skill_ids`. Default `default_policies` per spec §4.4 (anything publishing-external = `require-approval`).
- [ ] Catalog operators can edit any of these in the backoffice editor (P5).

### T9: `this.schedule()` on the Worker

- [ ] Add an optional `schedule` JSON column on `template` (or reuse `default_policies` shape). For the MarketingStrategist seed: `{ cron: "0 13 * * 1", method: "weeklyReport" }`.
- [ ] In `WorkerAgent.onStart()`, read the template's schedule entries and `await this.schedule(entry.cron, entry.method, {}, { idempotent: true })`. Idempotent registration survives restarts.
- [ ] Implement `weeklyReport()` on the Worker — the heartbeat tick from §4.4: query open tickets in this Worker's queue, decide actions, file a summary as an Action (so the user approves the report rather than auto-publishing). Long multi-step work dispatches to a Workflow (P4).

### T10: Tests

- [ ] One adapter test per channel — fixture payloads in, scripted `fetch` for outbound, assert `NormalizedMessage` + outbound call shape.
- [ ] `webhook-handler.test.ts` — full pipeline including `webhook_event` dedup (replay same `externalId` → 200, no second DO RPC).
- [ ] `transcribe-audio.test.ts` — mocked `env.AI.run` returning a canned transcript; assert the chat loop sees `[áudio: ...]` prepended.
- [ ] `scheduled-tick.test.ts` — advance Miniflare time past a cron tick; assert `weeklyReport` ran; assert idempotency.
- [ ] All exit 0.

### T11: Wrap

- [ ] Gates, PR `feat/p6-channels-workers-scheduling → main`, acceptance:
  - [ ] A customer messages on Telegram → Correspondent receives via the webhook adapter → replies via Telegram's send API.
  - [ ] Same customer sends a voice note → Correspondent transcribes inline → responds in text.
  - [ ] Same customer hires a MarketingStrategist → at the next cron tick, the Worker files a weekly-report Action; Correspondent presents it for approval.
  - [ ] Channel parity at the agent layer: the Correspondent code is byte-identical whether the inbound was web, Telegram, or WhatsApp.

---

## Risks

- **Provider secret storage.** `connector.config_ref` points into a secret store rather than holding tokens in D1. P3 flagged this; P6 _must_ solve it because there will be multiple companies × multiple channels × multiple secrets. Options: Workers Secrets per-company (binding explosion), or a dedicated `kv` namespace keyed by `connector.id`. Pick in T1; commit to one.
- **Webhook signature verification timing.** Each provider uses a different timing-tolerance window for replay-protection. Get the windows right per provider or risk silent rejection of legitimate requests under clock drift.
- **WhatsApp Meta-Cloud onboarding friction.** Real WhatsApp requires Meta Business verification — local dev is impractical without a sandbox number. Document that in `LOCAL_DEV.md`; ship Telegram first for the live demo.
- **Discord gateway vs webhook surface.** The interactions endpoint (webhook) covers slash commands + components but _not_ free-form DM messages. If the customer expects free-form Discord DMs, the gateway is required — which adds a persistent connection (Worker can't hold one indefinitely; needs a separate process). Decide the Discord scope explicitly in T6.
- **Scheduled-tick budget.** `this.schedule` ticks run inside the DO's 15-min wall-time / 30-sec CPU window. A `weeklyReport` that takes longer must dispatch to a Workflow (P4) and the tick just kicks it off. Don't let work creep inline.
- **Audio file fetch.** Each provider's audio comes via a different mechanism (Telegram `file_id` → `getFile` → URL; WhatsApp `/media/<id>`; Slack `files.info`). `transcribeAudio` should accept either `assetId` (already-downloaded R2) or `{ providerType, externalId }` and resolve via the right adapter — keep the indirection in the skill, not the Correspondent.
