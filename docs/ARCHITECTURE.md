# Qolmeia — Architecture Overview

> What's shipped on `main` after the post-Phase-5h restructure (Groups 1 + 2 + 3). Replaces the pre-restructure `8371163`-era doc. Reflects: AgentConnectorBinding-driven inbound routing, the connector adapter scaffold, owner-curated reserved files, BullMQ coalescing, the AgentSkillEnablement join table, the AgentRun + ContextSnapshot pair, the ActivityLog timeline, customer-side approval gating, and the routine scheduler.

The visual companion (`docs/architecture/current-state-2026-05-20.md`) still tracks the pre-restructure diagram set; refresh as a follow-up PR.

---

## 1. What Qolmeia is (one paragraph)

Qolmeia is an AI workforce platform for Brazilian local businesses. The MVP ships **one channel** (a Telegram bot, `@qolmeia_mvp_v0_bot`) and **three seeded agents** working as a delegation DAG plus **one paused-by-default routine** that exercises the proactive-trigger path: a **Controller** that talks to the owner, conducts the briefing, and routes work; a **Marketing Strategist** that drafts campaigns and may ask the Designer for visuals; and a **Designer** that captures the business "soul," annotates uploaded brand assets, and generates branded images. The Controller delegates via the `delegateToSpecialist` skill. Every dispatch creates an **AgentRun** row with a frozen `contextSnapshot`, every tool call persists as an **AgentAction** (auto-approved for the owner, **DRAFTED** for customer-side requests on approval-gated skills), and every business event lands in a per-org **ActivityLog** that the future web UI will render. Execution can be **serial** (default) or **async via BullMQ** on the same Redis Chat SDK uses for state; `DISPATCH_MODE=queue` + `pnpm dev:worker` enables the queue path, where duplicate webhooks and re-issued delegations coalesce by deterministic jobIds. The repo is a pnpm + Turborepo monorepo: one app (`apps/api`, Hono on Node 24) and three packages (`@repo/db`, `@repo/config-vitest`, `@repo/typescript-config`).

---

## 2. The system at a glance

```
                                      ┌─────────────────────────┐
                                      │   Telegram (Pedro's     │
                                      │      phone/desktop)     │
                                      └────────┬────────────────┘
                                               │ HTTPS
                                               ▼
                                  ┌──────────────────────────┐
                                  │  cloudflared tunnel       │   (local dev)
                                  │  → public HTTPS URL       │
                                  └────────┬─────────────────┘
                                           │ POST /connectors/telegram/:connectorInstanceId/webhook
                                           │ X-Telegram-Bot-Api-Secret-Token: <secret>
                                           ▼
       ┌────────────────────────────────────────────────────────────────┐
       │  apps/api (Hono on Node, port 4000)                            │
       │                                                                │
       │  routes/connectors/telegram.ts   (single route, no legacy)     │
       │     │                                                          │
       │     ▼                                                          │
       │  telegram/bot.ts  (Chat SDK Chat singleton)                    │
       │     │                                                          │
       │     ▼                                                          │
       │  inbox/pipeline.ts                                             │
       │     ├─ ingest.ts             dedup + ConnectorInstance lookup  │
       │     │                        (returns orgId + senderRole +     │
       │     │                         connectorInstanceId)             │
       │     ├─ owner-commands.ts     /instrucoes /ideia /rotinas       │ ───┐
       │     │                        /ligar /desligar /correr          │    │
       │     │                        (gated to senderRole=OWNER)       │    │
       │     ├─ attachments.ts        image + audio download/ingest     │    │
       │     ├─ agent-step.ts         buildContextSnapshot +            │    │
       │     │                        createAgentRun + dispatch + post  │    │
       │     └─ json-safe.ts          strip non-JSON-safe values        │    │
       │                                                                │    │
       │  agents/main-dispatcher → dispatcher.enqueueAndAwait           │    │
       │     ├─ SerialDispatcher  (DISPATCH_MODE=serial, inline)        │    │
       │     └─ BullMQDispatcher  (DISPATCH_MODE=queue, coalesce by     │    │
       │                          jobId = inbox:<connector>:<thread>:   │    │
       │                          <msgId>  OR  delegate:<parentRun>:    │    │
       │                          <child>:<subtaskHash>)                │    │
       │                                                                │    │
       │  agents/runtime.runAgentInstance                               │    │
       │     · reads systemPrompt + senderRole + runId from args        │    │
       │     · resolveEnabledSkills via AgentSkillEnablement (or        │    │
       │       template defaults when zero rows)                        │    │
       │     · generateText with tools                                  │    │
       │     · recordAgentAction (per tool call, status resolved by     │    │
       │       resolveActionStatus(senderRole, requiresApproval))       │    │
       │     · logActivity on every action (EXECUTED / FAILED /         │    │
       │       DRAFTED) + budget-warn 80/100                            │    │
       │     · agents/skills/delegate-to-specialist creates child       │    │
       │       AgentRun (parentRunId), buildContextSnapshot for child,  │    │
       │       dispatcher.enqueueAndAwait re-enters                     │    │
       └────────────────┬───────────────────────────────────────────────┘    │
                        │                                                    │
                        │   ┌────────────────────────────────────────────┐   │
                        │   │  workers/index.ts (pnpm dev:worker)        │   │
                        │   │   ├─ agent-runner   BullMQ Worker (4)      │   │
                        │   │   └─ routine-scheduler  Worker + JobSched  │◀──┘
                        │   │       · reconciles BullMQ JobSchedulers    │
                        │   │         from Routine rows on boot + on     │
                        │   │         /ligar/desligar                    │
                        │   │       · executor reads Routine + builds    │
                        │   │         prompt + createAgentRun + dispatch │
                        │   └────────────────────────────────────────────┘
                        ▼
         ┌──────────────────┐  ┌──────────────┐  ┌──────────────────────┐
         │  Postgres (5436) │  │  Redis (6382)│  │ Cloudflare R2        │
         │  Prisma 7        │  │  Chat SDK    │  │ (S3-compatible)       │
         │  + adapter-pg    │  │  state +     │  │ Bucket "qolmeia"      │
         │                  │  │  BullMQ jobs │  │ keys: org_<id>/       │
         │  Organization    │  │  + Routine   │  │       <sha256>.<ext>  │
         │   .agentInstr.   │  │  JobScheduler│  │                       │
         │   .businessIdea  │  │              │  │ Uploaded logos +      │
         │  Conversation    │  │              │  │ generated images +    │
         │  Message         │  │              │  │ KnowledgeDocs         │
         │  WebhookEvent    │  │              │  └──────────────────────┘
         │  BrandAsset      │  │              │
         │  KnowledgeDoc    │  │              │
         │  AgentTemplate   │  │              │
         │  AgentInstance   │  │              │
         │  Skill           │  │              │
         │  AgentSkillEnab. │  │              │      ┌────────────────────┐
         │  ConnectorInst.  │  │              │      │ Vercel AI Gateway  │
         │  AgentConnBind.  │  │              │      │  (single API key)  │
         │  AgentRun ★      │  │              │      │                    │
         │  AgentAction     │  │              │      │ google/gemini-2.5  │
         │  ActivityLog ★   │  │              │      │   -flash (agents)  │
         │  Routine ★       │  │              │      │ openai/gpt-image-1 │
         └──────────────────┘  └──────────────┘      │   (image gen)      │
                                                     └────────────────────┘
                                                             ▲
                                                             │
                                                  runtime + lib/image-gen
```

ASCII reduction of the moving parts:

- **One inbound HTTP route.** `POST /connectors/telegram/:connectorInstanceId/webhook`. The legacy `/telegram/webhook` is deleted.
- **Two worker queues.** `qolmeia-agent-run` (reactive — every inbound + every delegation) and `qolmeia-routine-run` (proactive — owner-enabled scheduled jobs). Both run inside the same `pnpm dev:worker` process.
- **AgentRun is the unit of replayability.** Each dispatch (inbound or delegation) creates one `AgentRun` row with `contextSnapshot` + `systemPrompt` frozen at dispatch time. The runtime never re-reads the soul.
- **ActivityLog is a side-effect of everything.** Pipeline, runs, runtime, owner commands, budget checks, routines — they all `logActivity(...)`. Writes are best-effort (errors swallowed). Pino logs remain source-of-truth for ops; ActivityLog is the durable UI feed.
- **Approval gating has two branches.** Owner-side and CUSTOMER-side with `!requiresApprovalDefault` skills both auto-approve. CUSTOMER-side + approval-gated skills (`generateBrandImage`, `draftMarketingStrategy`) record DRAFTED rows; the four `approvals.ts` helpers (`approve` / `reject` / `edit` / `executeApproved`) are wired but unrendered.

**Dispatch modes.** `DISPATCH_MODE=serial` (default) runs the agent loop inline inside the webhook handler; one process, no queue. `DISPATCH_MODE=queue` enqueues a BullMQ job; the worker process consumes it; webhook returns 200 immediately. Delegation skills enqueue child jobs through the same dispatcher. Worker concurrency is 4 (agent-runner) + 2 (routine scheduler).

---

## 3. Where the code lives (skimmer's guide)

### Apps

- **`apps/api/`** — the only application. Hono on Node 24, bundled by tsdown. `:4000`. Entry: `src/index.ts` (also runs `syncSkills` + `syncTemplates` at boot; routine seed is explicit via `scripts/sync-routines.ts`).
- **`apps/api/src/workers/index.ts`** — separate Node process (`pnpm dev:worker`). Mounts `agent-runner` + `routine-scheduler`.

### Packages

- **`@repo/db`** — Prisma 7 schema (`packages/db/prisma/schema.prisma`) + singleton `prisma` client. Uses `@prisma/adapter-pg`.
- **`@repo/config-vitest`** — shared Vitest config.
- **`@repo/typescript-config`** — shared `tsconfig` bases.

### Inside `apps/api/src/`

| Path                                                                                                                                  | Owns                                                                                                                                                                                                                                  | When to read                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `index.ts`                                                                                                                            | Hono bootstrap, middleware wiring, `syncSkills` + `syncTemplates` at boot, graceful shutdown                                                                                                                                          | Top of the call graph.                                                                                         |
| `routes/connectors/telegram.ts`                                                                                                       | `POST /connectors/telegram/:connectorInstanceId/webhook` — the **only** inbound route                                                                                                                                                 | HTTP entry. Legacy `/telegram/webhook` was deleted in Group 1.                                                 |
| `telegram/bot.ts`                                                                                                                     | Chat SDK `Chat` singleton; injects `{ dispatcher, prisma }` into the pipeline                                                                                                                                                         | How webhook events become handler calls. (Chat SDK still owns inbound; adapter scaffold is dormant — see §16.) |
| `inbox/pipeline.ts`                                                                                                                   | Orchestrator. Owner-command short-circuit, dedup, attachment processing, dispatch, postback                                                                                                                                           | Read after you know the stages.                                                                                |
| `inbox/ingest.ts`                                                                                                                     | WebhookEvent dedup, ConnectorInstance lookup (REQUIRES a `ConnectorInstance(type=TELEGRAM)` row — throws if missing), Conversation upsert, **returns `senderRole` + `connectorInstanceId` (non-nullable through the pipeline)**       | First stage of every inbound.                                                                                  |
| `inbox/attachments.ts`                                                                                                                | Image + audio download, R2 upload via `ingestBrandAsset`, oversize tracking                                                                                                                                                           | Pre-LLM data prep.                                                                                             |
| `inbox/agent-step.ts`                                                                                                                 | `runAgentForInbound` — calls `buildContextSnapshot`, `createAgentRun`, `dispatcher.enqueueAndAwait`, `finalizeAgentRun`, then `postAgentResult`                                                                                       | The interesting middle.                                                                                        |
| `inbox/owner-commands.ts`                                                                                                             | `parseOwnerCommand` + `handleOwnerCommand`. `/instrucoes`, `/ideia`, `/rotinas`, `/ligar`, `/desligar`, `/correr`. Owner-only via senderRole gate                                                                                     | Owner UX surface.                                                                                              |
| `inbox/json-safe.ts`                                                                                                                  | `toJsonSafe(value)` — strips functions/undefined for Prisma JSON columns                                                                                                                                                              | Tiny utility.                                                                                                  |
| `connectors/types.ts`                                                                                                                 | `ConnectorAdapter` interface, `NormalizedMessage`, `NormalizedAttachment`, `NotImplementedError`                                                                                                                                      | The future inbound contract.                                                                                   |
| `connectors/registry.ts`                                                                                                              | `ADAPTERS: Record<ConnectorType, ConnectorAdapter>` + `getAdapter(type)`. Total over the enum so callers never get `undefined`                                                                                                        | Adapter dispatch.                                                                                              |
| `connectors/telegram/adapter.ts`                                                                                                      | Real `TelegramAdapter` — native fetch, `parseInboundPayload`, `sendOutbound` (sendMessage + sendDocument), `validateConfig`                                                                                                           | Wired into the registry, NOT yet into the inbound pipeline.                                                    |
| `connectors/whatsapp/adapter.ts`                                                                                                      | Stub — `parseInboundPayload` parses Meta Cloud API webhooks into `NormalizedMessage`; `sendOutbound` throws `NotImplementedError`                                                                                                     | First pass at the WhatsApp follow-up.                                                                          |
| `connectors/fresha/adapter.ts`                                                                                                        | Typed placeholder; every method throws `NotImplementedError`                                                                                                                                                                          | Reserves the registry slot.                                                                                    |
| `agents/dispatcher.ts`                                                                                                                | `AgentDispatcher` interface + `createSerialDispatcher` + `buildCoalesceKey(origin)` + `DispatchOrigin` discriminator                                                                                                                  | The seam.                                                                                                      |
| `agents/main-dispatcher.ts`                                                                                                           | Module singleton; picks Serial vs BullMQ off `env.DISPATCH_MODE`                                                                                                                                                                      | Six lines.                                                                                                     |
| `agents/bullmq-dispatcher.ts`                                                                                                         | `createBullMQDispatcher` — `queue.add('run', payload, { jobId })` coalesces identical dispatches; `waitUntilFinished(120s)`                                                                                                           | The queue path.                                                                                                |
| `agents/runtime.ts`                                                                                                                   | `runAgentInstance(args)` — reads `runId` + `systemPrompt` + `senderRole` from args, runs `generateText`, persists one `AgentAction` per tool call (status via `resolveActionStatus`), emits ACTION\_\* + budget-warn ActivityLog rows | The "heart." Does NOT load context anymore.                                                                    |
| `agents/runs.ts`                                                                                                                      | `createAgentRun`, `finalizeAgentRun` (status transition + cost rollup), `hashSubtask` (delegation coalesce key)                                                                                                                       | Run lifecycle. Emits AGENT*RUN*\* ActivityLog rows.                                                            |
| `agents/context-snapshot.ts`                                                                                                          | `buildContextSnapshot({ orgId, mission, newAssets, existingAssets, oversizeCount, ... })` — composes the JSON blob stored on `AgentRun.contextSnapshot`                                                                               | Built at dispatch time, frozen on the row.                                                                     |
| `agents/actions.ts`                                                                                                                   | `recordAgentAction`, `resolveActionStatus` (Phase 5 §8 rule), `computeActionStatus` (folds in failure)                                                                                                                                | Single writer for `AgentAction` rows.                                                                          |
| `agents/approvals.ts`                                                                                                                 | `approveAction`, `rejectAction`, `editAction`, `executeApprovedAction` (4 programmatic helpers — no HTTP yet)                                                                                                                         | The customer-side branch's exit door. Awaits a web UI.                                                         |
| `agents/cost.ts`                                                                                                                      | `computeRunCost`, `checkBudgetThresholds` (emits Pino warn + BUDGET_WARN_80/100 ActivityLog at 80%/100%)                                                                                                                              | Soft budget gate.                                                                                              |
| `agents/step-aggregator.ts`                                                                                                           | `aggregateSteps`, `extractActionsFromSteps` — walks AI SDK v6 `step.content[]`                                                                                                                                                        | Provider-specific quarantined.                                                                                 |
| `agents/agent-instance.ts`                                                                                                            | `ensureAgentInstance` (upserts an AgentInstance per (orgId, templateSlug)) + `findInboundAgentInstanceForConnector` (resolves the agent via `AgentConnectorBinding(direction: INBOUND                                                 | BOTH)`; returns `found`/`none`/`ambiguous`)                                                                    | The hardcoded-controller lookup is gone. |
| `agents/connector-binding-seed.ts`                                                                                                    | `ensureInboundBindingForTelegramConnector` — idempotent INBOUND binding upsert. Seeded on ConnectorInstance creation + by the one-shot backfill script                                                                                | Boot-time data integrity.                                                                                      |
| `agents/skills/registry.ts`                                                                                                           | `ALL_SKILLS` typed tuple, `findSkillById`, `syncSkills` (Zod → JSON Schema). Zero `as unknown` casts                                                                                                                                  | Boot seeds the Skill table.                                                                                    |
| `agents/skills/types.ts`                                                                                                              | `Skill<TInput, TOutput>`, `SkillContext` (now carries `parentRunId`), `AnySkill`, `defineSkill<T>()`                                                                                                                                  | Skill contract.                                                                                                |
| `agents/skills/delegate-to-specialist.ts`                                                                                             | Built-in skill. `canDelegateTo` check + `ensureAgentInstance` + `buildContextSnapshot` for child + `createAgentRun(parentRunId)` + `dispatcher.enqueueAndAwait({ dispatchOrigin: { kind: "delegation", parentRunId, subtaskHash } })` | The DAG-maker.                                                                                                 |
| `agents/skills/{extract-soul,label-brand-asset,generate-brand-image,draft-marketing-strategy,search-knowledge,read-knowledge-doc}.ts` | The 6 domain skills. `generateBrandImage` and `draftMarketingStrategy` are flagged `requiresApprovalDefault: true`                                                                                                                    | Skill bodies.                                                                                                  |
| `agents/templates/{controller,marketing-strategist,designer,registry,renderer,types}.ts`                                              | Three seeded templates + registry (`syncTemplates` + `validateCanDelegateTo`) + pure-function renderer                                                                                                                                | Agent prompts + DAG topology.                                                                                  |
| `activity/log.ts`                                                                                                                     | `logActivity` — single write-point for `ActivityLog` rows. Errors swallowed, logged via Pino                                                                                                                                          | The seam.                                                                                                      |
| `activity/query.ts`                                                                                                                   | `getRecentActivity({ orgId, limit })` — clamped to 500, newest-first                                                                                                                                                                  | UI-facing read.                                                                                                |
| `routines/types.ts`                                                                                                                   | `RoutineDefinition` (`name`, `description`, `defaultSchedule`, `defaultAgentTemplate`, `defaultConfig`, `buildPrompt(config, ctx)`)                                                                                                   | The code contract.                                                                                             |
| `routines/registry.ts`                                                                                                                | `ALL_ROUTINES` + `findRoutineByName` + `syncRoutines` (paused-by-default, idempotent, preserves owner customisations)                                                                                                                 | The code-defined catalog.                                                                                      |
| `routines/nightly-knowledge-summary.ts`                                                                                               | The seed routine — 03:00 daily, builds a digest of the last 24h of `KnowledgeDoc` rows                                                                                                                                                | The reference shape.                                                                                           |
| `routines/queue.ts`                                                                                                                   | `createRoutineQueue` — separate BullMQ queue `qolmeia-routine-run` so routine drift never starves the reactive queue                                                                                                                  | Isolation.                                                                                                     |
| `routines/reconcile.ts`                                                                                                               | `reconcileRoutines({ prisma, queue })` — drives BullMQ JobSchedulers toward DB rows: add/remove/update                                                                                                                                | The reconciler.                                                                                                |
| `routines/scheduler-control.ts`                                                                                                       | `triggerReconcile` — lazy queue + reconcile. Called from owner-commands after enable/disable                                                                                                                                          | Owner-driven reconcile path.                                                                                   |
| `routines/executor.ts`                                                                                                                | `executeRoutine({ routineId })` — loads the row + code definition, builds prompt, dispatches via the agent runtime, updates `lastRunAt` + `lastRunStatus`. Swallows its own errors                                                    | One fire of a routine.                                                                                         |
| `workers/agent-runner.ts`                                                                                                             | BullMQ Worker on `qolmeia-agent-run`, concurrency 4. Re-attaches `prisma` + `dispatcher` from module singletons                                                                                                                       | Async path.                                                                                                    |
| `workers/routine-scheduler.ts`                                                                                                        | BullMQ Worker on `qolmeia-routine-run`, concurrency 2. On boot, reconciles JobSchedulers from `Routine` rows. Wired in `workers/index.ts` alongside `agent-runner`                                                                    | Routine path.                                                                                                  |
| `workers/index.ts`                                                                                                                    | Single `pnpm dev:worker` entry point. Starts both workers                                                                                                                                                                             | One process, two queues.                                                                                       |
| `knowledge/provider.ts`                                                                                                               | `getBusinessContext(orgId)` — renders `Organization.businessIdea` + `Organization.agentInstructions` (owner-curated, BEFORE the AI-extracted soul) + the serialized `businessProfile`. Skills cannot write the first two              | The read seam now spans 3 reserved fields.                                                                     |
| `knowledge/{soul,apply,brand-asset,brand-context,knowledge-doc}.ts`                                                                   | Soul types + single-writer `applySoulUpdate` (now emits `BUSINESS_IDEA_UPDATED` via owner commands — soul writes themselves are silent) + BrandAsset single-writer + brand-context aggregation + KnowledgeDoc CRUD                    | Per-table writer seams.                                                                                        |
| `scripts/sync-routines.ts`                                                                                                            | `pnpm tsx apps/api/src/scripts/sync-routines.ts [<orgSlug>]` — seeds Routine rows for one org or all. Paused-by-default, never flips `enabled` on existing rows                                                                       | Explicit, run on demand.                                                                                       |
| `scripts/migrate-enabled-skills-to-enablements.ts`                                                                                    | One-shot: migrates legacy `AgentInstance.enabledSkillIds` Json arrays into `AgentSkillEnablement` rows. Safe to re-run                                                                                                                | Already executed; archived for history.                                                                        |
| `scripts/backfill-controller-inbound-bindings.ts`                                                                                     | One-shot: backfills `AgentConnectorBinding(INBOUND)` rows for Telegram ConnectorInstances that predate binding-driven routing                                                                                                         | Already executed.                                                                                              |
| `lib/{env,logger,storage,image-gen}.ts`                                                                                               | Zod env loader; Pino logger; R2 wrapper; `generateBrandImageBytes` (gpt-image-1 via Gateway)                                                                                                                                          | Unchanged by the restructure.                                                                                  |
| `middleware/{security,error-handler}.ts`                                                                                              | CORS, security headers, rate limiting, body size limit; top-level error handler + 404                                                                                                                                                 | Unchanged.                                                                                                     |

**Removed by the restructure:** `routes/telegram/webhook.ts` (legacy route, deleted in PR #1), `scripts/migrate-telegram-link-to-connector.ts` (replaced by the new backfill script for bindings), the `TelegramLink` Prisma model (dropped in PR #1 — `Organization.telegramLink` relation is gone; `connectorInstanceId` is now non-nullable through the pipeline). Single inbound route remains: `POST /connectors/telegram/:connectorInstanceId/webhook`.

---

## 4. Data model

Schema lives in `packages/db/prisma/schema.prisma`. Provider: `postgresql`. Generator: `prisma-client` with `@prisma/adapter-pg`. Stars (`★`) mark models added or substantially extended in the restructure.

```
Organization                                       (the tenant)
  id, name, slug @unique
  timezone, currency                              "America/Sao_Paulo", "BRL" defaults
  businessProfile Json?                           ★ THE AI-EXTRACTED SOUL — single-writer via knowledge/apply.ts
  agentInstructions String?  @db.Text             ★ NEW — owner-curated AGENTS.md equivalent
  businessIdea      String?  @db.Text             ★ NEW — owner-curated IDEA.md equivalent
  agentInstances · connectorInstances · activityLogs · routines · brandAssets · knowledgeDocs · customers · conversations

Customer (orgId, phone?, email?, name?, meta?)    @@unique by (orgId, phone) / (orgId, email)

Conversation
  channel, externalId?, status, orgId, customerId?
  connectorInstanceId String?                     (Phase 5h — now always set on new rows)
  messages

Message
  conversationId, externalId?
  sender (CUSTOMER | AGENT | SYSTEM)
  content, contentType
  metadata Json?                                  raw payload (sanitized via toJsonSafe)
  agentRuns AgentRun[]                            ★ NEW — back-relation for triggerMessageId
  @@unique([conversationId, externalId])

WebhookEvent                                      (idempotency)
  provider, externalId, payload Json, status
  @@unique([provider, externalId])

BrandAsset                                        (org-scoped binary assets)
  orgId, r2Key, sha256, mimeType, size
  metadata Json @default("{}")
  @@unique([orgId, sha256])

KnowledgeDoc                                      (markdown/JSON/text docs)
  orgId, r2Key, title, summary, tags
  contentType  KnowledgeDocContentType            MARKDOWN | PLAIN_TEXT | JSON
  size

──── Multi-agent core ───────────────────────────────────────────────────

AgentTemplate                                     (system-defined; seeded from code)
  slug @id, displayName, description, defaultSystemPrompt, defaultMission
  compatibleInboundConnectorTypes  ConnectorType[]
  compatibleOutboundConnectorTypes ConnectorType[]
  canDelegateTo  String[]                         validated acyclic at sync-time
  defaultBudgetCents Int
  skills  Skill[] @relation("TemplateSkills")     M:N (the default skill set)

AgentInstance                                     (per-org hired agent)
  orgId, templateSlug, displayName, mission
  budgetCents, status (ACTIVE | PAUSED)
  enablements  AgentSkillEnablement[]             ★ replaces enabledSkillIds Json?
  runs         AgentRun[]                         ★ NEW
  routines     Routine[]                          ★ NEW
  bindings     AgentConnectorBinding[]
  actions      AgentAction[]
  @@unique([orgId, templateSlug])

Skill                                             (system-defined; seeded from code)
  id @id, displayName, description, parametersJsonSchema Json
  requiresApprovalDefault  Boolean                generateBrandImage = true, draftMarketingStrategy = true
  requiredConnectorTypes   ConnectorType[]
  enablements  AgentSkillEnablement[]             ★ NEW back-relation

AgentSkillEnablement                              ★ NEW — join table replacing enabledSkillIds
  id, agentInstanceId, skillId
  enabledAt, enabledBy?, configOverride Json?
  @@unique([agentInstanceId, skillId])
  -- Zero rows for an instance ⇒ runtime falls back to template defaults.
  -- One+ rows ⇒ explicit override.

ConnectorInstance                                 (per-org channel/tool config)
  orgId, type (ConnectorType), displayName
  config Json, capabilities Json
  senderRole  SenderRole                          OWNER | CUSTOMER
  bindings  AgentConnectorBinding[]
  conversations  Conversation[]
  @@index([orgId, type])

AgentConnectorBinding                             (M:N: which agents act on which channels)
  agentInstanceId, connectorInstanceId
  direction (INBOUND | OUTBOUND | BOTH)
  @@unique([agentInstanceId, connectorInstanceId, direction])
  @@index([connectorInstanceId, direction])
  -- ★ Now ACTIVE: findInboundAgentInstanceForConnector reads this to route
  --   inbound messages. No more hardcoded controller slug.

AgentRun                                          ★ NEW — the unit of replayability
  id, agentInstanceId
  triggerMessageId?                               set for top-level inbound; null for delegation children + routines
  parentRunId?                                    self-FK; null at the root
  contextSnapshot Json                            ContextSnapshot — frozen at dispatch
  systemPrompt    String @db.Text                 the exact prompt the model saw
  status AgentRunStatus                           RUNNING | SUCCEEDED | FAILED
  costCents, costInputTokens, costOutputTokens
  startedAt, finishedAt?, errorMessage?
  actions AgentAction[]                           1:N back-relation
  @@index([agentInstanceId, startedAt])
  @@index([triggerMessageId])
  @@index([parentRunId])

AgentAction                                       (per tool call)
  agentInstanceId, skillId
  runId?                                          ★ NEW — links to AgentRun. Nullable for backward compat.
  triggerMessageId?, parentActionId?
  proposedInput Json, proposedSummary
  status AgentActionStatus                        DRAFTED | AUTO_APPROVED | APPROVED | REJECTED | EDITED |
                                                  EXPIRED | FAILED | EXECUTED
  decidedByUserId?, decidedAt?, executedAt?
  resultJson Json?, errorMessage?
  costCents, costCurrency, costInputTokens, costOutputTokens
  @@index([agentInstanceId, status, createdAt])
  @@index([triggerMessageId]), @@index([parentActionId]), @@index([runId])

ActivityLog                                       ★ NEW — append-only timeline
  id, orgId, type (ActivityLogType), refType (ActivityLogRefType), refId?
  summary String @db.Text                         pt-BR one-liner rendered as-is by the UI
  payload Json?                                   structured event data (shapes per type — see activity/log.ts)
  actorId?                                        reserved for the future multi-user model
  createdAt
  @@index([orgId, createdAt])
  @@index([type, createdAt])

Routine                                           ★ NEW — paused-by-default scheduled invocations
  id, orgId, agentInstanceId
  name (per-org unique), description?
  schedule  String                                cron expression
  timezone  String                                default "America/Sao_Paulo"
  enabled   Boolean                               ALWAYS starts false; owner flips with /ligar
  config    Json                                  shape defined by RoutineDefinition.buildPrompt
  lastRunAt?, lastRunStatus?, nextRunAt?
  @@unique([orgId, name])
  @@index([orgId, enabled])

──── Enums ──────────────────────────────────────────────────────────────

AgentRunStatus       RUNNING | SUCCEEDED | FAILED                                                                          ★
AgentActionStatus    DRAFTED | AUTO_APPROVED | APPROVED | REJECTED | EDITED | EXPIRED | FAILED | EXECUTED
AgentInstanceStatus  ACTIVE | PAUSED
ConnectorType        TELEGRAM | WHATSAPP | FRESHA | GOOGLE_MY_BUSINESS | INSTAGRAM
SenderRole           OWNER | CUSTOMER
BindingDirection     INBOUND | OUTBOUND | BOTH
ActivityLogType      MESSAGE_INBOUND | MESSAGE_OUTBOUND | AGENT_RUN_STARTED | AGENT_RUN_FINISHED |                          ★
                     AGENT_RUN_FAILED | ACTION_EXECUTED | ACTION_FAILED | ACTION_DRAFTED |
                     ACTION_APPROVED | ACTION_REJECTED | BUDGET_WARN_80 | BUDGET_WARN_100 |
                     INSTRUCTIONS_UPDATED | BUSINESS_IDEA_UPDATED | OWNER_COMMAND |
                     ROUTINE_TRIGGERED | ROUTINE_ENABLED | ROUTINE_DISABLED
ActivityLogRefType   MESSAGE | AGENT_RUN | AGENT_ACTION | ORGANIZATION | ROUTINE | NONE                                    ★
```

### Invariants

**At template-sync (boot):**

- `AgentTemplate.canDelegateTo` is acyclic across the full template set (`validateCanDelegateTo`).
- Every slug in `canDelegateTo` corresponds to a registered template.
- `syncSkills` runs BEFORE `syncTemplates` so the M:N skill connections find their rows.

**At runtime:**

- `AgentSkillEnablement` row count for `(agentInstanceId)` ∈ `{0 ⇒ template default, ≥1 ⇒ explicit override}`.
- `delegateToSpecialist` rejects when `targetTemplateSlug ∉ parentTemplate.canDelegateTo`.
- `findInboundAgentInstanceForConnector` returns `{ found, none, ambiguous }`; the pipeline fails closed on `none`/`ambiguous`.
- **Approval rule** (`resolveActionStatus`): `senderRole !== "CUSTOMER" || !skill.requiresApprovalDefault ⇒ AUTO_APPROVED`; otherwise `DRAFTED`.
- `AgentRun` is the unit of replayability: `contextSnapshot` + `systemPrompt` are frozen on the row; re-running the same row reproduces the exact prompt the model saw.

**At seed:**

- `Routine.enabled` ALWAYS starts `false`. `syncRoutines` never flips it; only `/ligar` does.

---

## 5. The agent loop

`agents/runtime.ts → runAgentInstance(args: AgentDispatchArgs): Promise<AgentRunResult>`. Same function for every agent template; the template + enabled skills determine behavior.

### Key change vs pre-restructure

The runtime **no longer loads context**. It reads `systemPrompt`, `runId`, and `senderRole` from `AgentDispatchArgs` (already populated by the orchestrator). `buildContextSnapshot` runs at dispatch time (`inbox/agent-step` for inbound, `agents/skills/delegate-to-specialist` for delegations) and the result is frozen on `AgentRun.contextSnapshot`.

### `AgentDispatchArgs` shape

```ts
{
  agentInstance,         // the AgentInstance to run
  prisma,
  dispatcher,            // self-reference so delegation can re-enter
  input: { audioBytes?, audioMime?, imageBytes[], text? },
  newAssets,             // [{ assetId, mimeType, deduped }]
  existingAssets,        // [{ assetId, mimeType, metadata }]
  oversizeCount,
  runId,                 // ★ AgentRun.id — the row this dispatch belongs to
  systemPrompt,          // ★ fully rendered, duplicated from AgentRun.systemPrompt
  senderRole,            // ★ OWNER | CUSTOMER | null — drives the approval rule
  dispatchOrigin?,       // ★ optional — used by BullMQ to derive a coalesce jobId
}
```

### `DispatchOrigin` discriminator (drives jobId coalescing)

```
{ kind: "inbound", connectorInstanceId: string | null,
                   externalThreadId: string, triggerMessageExternalId: string }
  ⇒ jobId = `inbox:<connector|legacy>:<thread>:<msgId>`

{ kind: "delegation", parentRunId: string,
                      childTemplateSlug: string, subtaskHash: string }
  ⇒ jobId = `delegate:<parentRun>:<child>:<sha256(subtask)[0..16]>`
```

Duplicate webhook deliveries and accidentally re-issued delegations collapse into one BullMQ job; `waitUntilFinished` hands the first run's result to every concurrent caller.

### The 7 skills

| Skill ID                 | Owner template(s)                | `requiresApprovalDefault` | Notes                                                                                                         |
| ------------------------ | -------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `delegateToSpecialist`   | Controller, Marketing Strategist | `false`                   | Validates `canDelegateTo`, ensures child instance, builds child snapshot, creates child AgentRun, dispatches. |
| `extractSoul`            | Controller, Designer             | `false`                   | Single-writer wrapper around `applySoulUpdate`.                                                               |
| `labelBrandAsset`        | Designer                         | `false`                   | Updates `BrandAsset.metadata`.                                                                                |
| `generateBrandImage`     | Designer                         | **`true`** ★              | gpt-image-1 via Gateway. CUSTOMER triggers ⇒ DRAFTED.                                                         |
| `draftMarketingStrategy` | Marketing Strategist             | **`true`** ★              | Stub v0. CUSTOMER triggers ⇒ DRAFTED.                                                                         |
| `searchKnowledge`        | Controller, Designer             | `false`                   | Reads `KnowledgeDoc`.                                                                                         |
| `readKnowledgeDoc`       | Controller, Designer             | `false`                   | Reads `KnowledgeDoc` body from R2.                                                                            |

### The 3 seeded templates

| Template slug          | displayName          | `canDelegateTo`                       | `defaultEnabledSkillIds`                                                                      |
| ---------------------- | -------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `controller`           | Controller           | `["designer","marketing-strategist"]` | `["delegateToSpecialist","extractSoul","searchKnowledge","readKnowledgeDoc"]`                 |
| `marketing-strategist` | Marketing Strategist | `["designer"]`                        | `["delegateToSpecialist","draftMarketingStrategy"]`                                           |
| `designer`             | Designer             | `[]`                                  | `["extractSoul","generateBrandImage","labelBrandAsset","searchKnowledge","readKnowledgeDoc"]` |

### The runtime sequence

1. `findTemplateBySlug(agentInstance.templateSlug)` — throws if unknown.
2. `resolveEnabledSkills(prisma, agentInstanceId, template.defaultEnabledSkillIds)` — zero `AgentSkillEnablement` rows ⇒ template defaults; otherwise the row set.
3. Build `ctx: SkillContext = { agentInstanceId, dispatcher, orgId, parentRunArgs, parentRunId: runId, prisma }`.
4. Wrap each skill in an AI SDK `tool({ description, inputSchema, execute })`.
5. `generateText({ model: gateway("google/gemini-2.5-flash"), stopWhen: stepCountIs(5), system: systemPrompt, messages, tools, temperature: 0.2 })`. **No live `getBusinessContext` call.**
6. `aggregateSteps(result.steps, ALL_SKILLS.map(s => s.id))` returns `{ generatedAssetIds, toolCallSummary }`.
7. For each tool call: `recordAgentAction({ ..., senderRole, runId })` — status resolved via `resolveActionStatus(senderRole, skill.requiresApprovalDefault)`. Emit one `ActivityLog` row per action (`ACTION_EXECUTED` / `ACTION_FAILED` / `ACTION_DRAFTED`).
8. If `agentInstance.budgetCents > 0`: `checkBudgetThresholds` aggregates month-to-date cost; emits `BUDGET_WARN_80` / `BUDGET_WARN_100` Pino + ActivityLog at thresholds.
9. Return `AgentRunResult = { text, generatedAssetIds, toolCallSummary, usage }`.

### Delegation flow

`delegateToSpecialist({ targetTemplateSlug, subtask })`:

1. Validate `targetTemplateSlug ∈ parent.canDelegateTo` and that the target template is registered.
2. `ensureAgentInstance({ orgId, templateSlug: targetTemplateSlug })` — lazy-create the child.
3. `buildContextSnapshot({ ..., mission: childAgent.mission })` — fresh snapshot for the child (different mission, same asset window).
4. `renderSystemPrompt(targetTemplate.defaultSystemPrompt, snapshot)`; append `Missão deste agente:\n<mission>` if non-empty.
5. `createAgentRun({ agentInstanceId: child.id, contextSnapshot, parentRunId: ctx.parentRunId, systemPrompt, triggerMessageId: undefined })`.
6. `dispatcher.enqueueAndAwait({ ...parentRunArgs, agentInstance: child, runId: childRun.id, systemPrompt, dispatchOrigin: { kind: "delegation", parentRunId, childTemplateSlug, subtaskHash: hashSubtask(subtask) }, input: { ...parentInput, text: subtask } })`.
7. `finalizeAgentRun({ result: childResult, runId: childRun.id })` (or `{ error, runId }` on failure).
8. Propagate `{ text, generatedAssetIds, usage }` back up. The parent's aggregator spreads `generatedAssetIds` from the delegation tool-result.

---

## 6. The request lifecycle

Pedro sends _"gera uma imagem promocional para minha promo de Black Friday"_ on Telegram.

```
[Telegram]
   │ POST /connectors/telegram/<connectorInstanceId>/webhook
   │ X-Telegram-Bot-Api-Secret-Token: <secret>
   ▼
[routes/connectors/telegram.ts] → bot.webhooks.telegram(rawRequest)
   ▼
[telegram/bot.ts]
   Chat SDK validates secret, parses, dedups (5min TTL),
   invokes handleInboundMessage({ dispatcher, prisma }, thread, message)
   ▼
[inbox/pipeline.ts]
   1. markWebhookProcessed → early-return on duplicate.
   2. resolveOrgAndConversation:
        prisma.connectorInstance.findFirst({ type: TELEGRAM, config: { chatId } })
        — throws if no ConnectorInstance matches (no fallback path; org must be onboarded).
        Returns { orgId, conversationId, connectorInstanceId, senderRole }.
   3. if senderRole === "OWNER" && parseOwnerCommand(text) !== null:
        · persistInboundMessage + logActivity OWNER_COMMAND
        · handleOwnerCommand → reply (no agent run)
        · return.
   4. persistInboundMessage(Message) + logActivity MESSAGE_INBOUND.
   5. processIncomingAttachments (images, audio, oversize).
   6. if empty (no text + no audio + no new assets + no oversize): post EMPTY_TEXT_REPLY.
   7. runAgentForInbound:
        a. brandAsset.findMany(take: 20) → existingAssets.
        b. findInboundAgentInstanceForConnector(connectorInstanceId) → AgentInstance.
           Queries AgentConnectorBinding where (connectorInstanceId, direction IN (INBOUND, BOTH)).
           Returns "found" / "none" (→ EXTRACT_FAILED_REPLY) / "ambiguous" (→ same).
           Binding row is seeded on ConnectorInstance creation (controller is the only
           INBOUND binding in v0; more agents can take inbound by adding bindings).
        c. buildContextSnapshot({ orgId, mission, newAssets, existingAssets, oversizeCount, getBusinessContext }).
        d. renderSystemPrompt(controllerPrompt, snapshot) → systemPrompt.
        e. createAgentRun({ agentInstanceId, contextSnapshot, systemPrompt, triggerMessageId,
                            activityContext: { orgId, agentDisplayName, templateSlug } })
             → emits AGENT_RUN_STARTED ActivityLog.
        f. dispatcher.enqueueAndAwait({ ..., runId, systemPrompt, senderRole,
                                       dispatchOrigin: { kind: "inbound",
                                                         connectorInstanceId,
                                                         externalThreadId: thread.id,
                                                         triggerMessageExternalId: message.id } })
             · Serial mode → runAgentInstance inline.
             · Queue mode → jobId = "inbox:<connector>:<thread>:<msgId>"; coalesces duplicates;
                            worker calls runAgentInstance.
   8. [runtime] Controller runs. LLM calls delegateToSpecialist("marketing-strategist", subtask).
        · validate "marketing-strategist" ∈ controller.canDelegateTo ✓
        · ensureAgentInstance("marketing-strategist") (lazy)
        · buildContextSnapshot for strategist (different mission, same asset window)
        · createAgentRun({ parentRunId: controllerRun.id, ... }) → AGENT_RUN_STARTED
        · dispatcher.enqueueAndAwait with dispatchOrigin: { kind: "delegation",
                                                            parentRunId: controllerRun.id,
                                                            childTemplateSlug: "marketing-strategist",
                                                            subtaskHash }
        · [runtime] Strategist runs. LLM calls delegateToSpecialist("designer", imageBrief).
            · createAgentRun (parentRunId: strategistRun.id) → AGENT_RUN_STARTED
            · dispatch → [runtime] Designer runs.
                · LLM calls generateBrandImage({ prompt, aspectRatio })
                · skill: getBrandContext → enrichPromptWithBrand → generateBrandImageBytes → ingestGeneratedAsset
                · recordAgentAction(skillId="generateBrandImage", runId=designerRun.id,
                                    senderRole="OWNER", success=true)
                       → status = AUTO_APPROVED (owner-side) → ACTION_EXECUTED ActivityLog
                · runtime returns { text, generatedAssetIds: [assetId], usage }
            · finalizeAgentRun(designerRun) → AGENT_RUN_FINISHED
        · finalizeAgentRun(strategistRun) → AGENT_RUN_FINISHED
        · returns to Controller
   9. [runtime] Controller LLM writes final pt-BR reply.
        · recordAgentAction(skillId="delegateToSpecialist", runId=controllerRun.id) → ACTION_EXECUTED
        · checkBudgetThresholds — Pino warn + BUDGET_WARN_* ActivityLog if ≥80/100%
   10. finalizeAgentRun(controllerRun) → AGENT_RUN_FINISHED ActivityLog.
   11. postAgentResult: for each generatedAssetIds id, fetch from R2 and thread.post({ files, markdown }).
       (Image post failures fall back to plain-text reply.)
   12. logger.info "telegram message handled".
```

### Approval branch

For CUSTOMER-side connectors (`senderRole === "CUSTOMER"`), step 8's `recordAgentAction(skillId="generateBrandImage")` resolves to **DRAFTED** instead of AUTO_APPROVED. The skill **still runs** (the tool call already executed); the row marks it as needing approval, and `ACTION_DRAFTED` lands in the ActivityLog. The four programmatic helpers in `agents/approvals.ts` (`approveAction`, `rejectAction`, `editAction`, `executeApprovedAction`) move the row through `APPROVED` / `EDITED` / `REJECTED` / `EXECUTED`. The UI that calls them doesn't exist yet — these are wired for the upcoming web app.

### Error matrix

| Failure                                              | Where                                    | Behaviour                                                                       |
| ---------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| Telegram secret mismatch                             | Chat SDK adapter                         | 401 immediate; no DB write                                                      |
| Duplicate webhook                                    | `markWebhookProcessed`                   | Early return + "duplicate" log                                                  |
| Duplicate inbound while another is in flight (queue) | `BullMQDispatcher` (jobId coalesce)      | Second caller awaits the first's result                                         |
| Identical subtask delegated twice (queue)            | Same                                     | Both delegations share one child run                                            |
| Image download failure                               | `inbox/attachments`                      | Logged, skipped, other attachments continue                                     |
| >20 MB image                                         | Same                                     | `oversizeCount++`, system prompt mentions it                                    |
| Audio download failure                               | Same                                     | Posts DOWNLOAD_FAILED_REPLY                                                     |
| Empty inbound                                        | `inbox/pipeline`                         | Posts EMPTY_TEXT_REPLY                                                          |
| Unknown template                                     | `findTemplateBySlug`                     | Throws — startup `syncTemplates` should have caught it                          |
| Delegation rejected (target ∉ canDelegateTo)         | `delegateToSpecialist`                   | Returns `{ ok: false, error }`; model sees it                                   |
| Cycle attempt at boot                                | `validateCanDelegateTo`                  | Server refuses to start                                                         |
| Image gen Gateway 5xx                                | `generateBrandImage`                     | Caught, returns `{ ok: false, error }`, logged                                  |
| Inbound binding `none` / `ambiguous`                 | `findInboundAgentInstanceForConnector`   | Caller fails closed and logs (v0 expects exactly one binding)                   |
| ActivityLog insert failure                           | `logActivity`                            | Swallowed; Pino error log. Never breaks the inbound path                        |
| AgentRun finalize failure                            | `finalizeAgentRun` catch in `agent-step` | Separately logged; outer dispatch error still propagates                        |
| Routine prompt-build or dispatch failure             | `routines/executor`                      | Caught; `lastRunStatus = "FAILED"`; ActivityLog ROUTINE_TRIGGERED still emitted |

---

## 7. External services (env-var map)

Unchanged by the restructure.

| Env var                         | Used by                                                                    | What it does                                                                   |
| ------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`                  | Prisma                                                                     | Postgres connection. Local: docker-compose on `localhost:5436`. Prod: Railway. |
| `REDIS_URL`                     | Chat SDK + BullMQ                                                          | Conversation state, BullMQ queues, JobScheduler state for routines.            |
| `TELEGRAM_BOT_TOKEN`            | `@chat-adapter/telegram`                                                   | Bot auth (inbound verify + outbound `sendMessage`/`sendDocument`).             |
| `TELEGRAM_BOT_USERNAME`         | Same                                                                       | Mention detection.                                                             |
| `TELEGRAM_WEBHOOK_SECRET_TOKEN` | Same                                                                       | Validates `X-Telegram-Bot-Api-Secret-Token`.                                   |
| `AI_GATEWAY_API_KEY`            | `agents/runtime` (via AI SDK `gateway()`) + `lib/image-gen` (direct fetch) | Single AI key. Routes Gemini + gpt-image-1 through Vercel AI Gateway.          |
| `R2_*` (6 vars)                 | `lib/storage.ts`                                                           | Cloudflare R2 (S3-compatible) — brand assets + KnowledgeDocs.                  |
| `DISPATCH_MODE`                 | `agents/main-dispatcher`                                                   | `serial` (default) or `queue`.                                                 |
| `BULLMQ_CONCURRENCY`            | `workers/index.ts`                                                         | Agent-runner worker concurrency (default 4).                                   |
| `BULLMQ_ROUTINE_CONCURRENCY`    | Same                                                                       | Routine scheduler worker concurrency (default 2).                              |
| `CORS_ORIGINS`                  | Hono CORS                                                                  | Comma-separated allowed origins; defaults to `*`.                              |

---

## 8. The seams (and why they matter)

Each seam isolates a layer so its implementation can change without touching callers. Single-writer / single-reader audit (run anytime):

```bash
grep -rn "businessProfile" apps/api/src       # ⇒ knowledge/apply.ts (writer) + knowledge/provider.ts (reader)
grep -rn "agentInstructions" apps/api/src     # ⇒ knowledge/provider.ts (reader) + inbox/owner-commands.ts (writer)
grep -rn "businessIdea" apps/api/src          # ⇒ knowledge/provider.ts (reader) + inbox/owner-commands.ts (writer)
grep -rn "brandAsset.create" apps/api/src     # ⇒ knowledge/brand-asset.ts (both ingest functions)
grep -rn "brandAsset.update" apps/api/src     # ⇒ agents/skills/label-brand-asset.ts
grep -rn "agentInstance.upsert" apps/api/src  # ⇒ agents/agent-instance.ts
grep -rn "agentAction.create" apps/api/src    # ⇒ agents/actions.ts (runtime path) + agents/approvals.ts (post-approval path)
grep -rn "agentRun.create" apps/api/src       # ⇒ agents/runs.ts
grep -rn "activityLog.create" apps/api/src    # ⇒ activity/log.ts
grep -rn "routine.create" apps/api/src        # ⇒ routines/registry.ts (syncRoutines)
grep -rn "as Skill<" apps/api/src             # ⇒ NOTHING — defineSkill killed the cast
```

| Seam                                                                      | Lives at                                                                              | What it hides                                                                      | What it enables                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `getBusinessContext`                                                      | `knowledge/provider.ts`                                                               | Composition of `businessIdea` + `agentInstructions` + serialized `businessProfile` | Future RAG layering; new reserved-files                                          |
| `applySoulUpdate`                                                         | `knowledge/apply.ts`                                                                  | Patch-merge transaction logic                                                      | Future audit log                                                                 |
| `ingestBrandAsset` + `ingestGeneratedAsset`                               | `knowledge/brand-asset.ts`                                                            | SHA-256 dedup + R2 upload + Prisma row                                             | Virus scanning, thumbnails                                                       |
| `getBrandContext` + `enrichPromptWithBrand`                               | `knowledge/brand-context.ts`                                                          | BrandAsset metadata aggregation + prompt composition                               | Future Marketing skills reuse the same brand pickup                              |
| `ensureAgentInstance`                                                     | `agents/agent-instance.ts`                                                            | The AgentInstance upsert shape                                                     | Future invariants (cost gates, audit)                                            |
| `findInboundAgentInstanceForConnector`                                    | `agents/agent-instance.ts`                                                            | Binding-table lookup with `none` / `ambiguous` resolution                          | Phase 6 routing: multiple agents per connector via OUTBOUND-only / BOTH bindings |
| `runAgentInstance`                                                        | `agents/runtime.ts`                                                                   | `generateText` loop + tool wrap + action persistence + budget check                | Swap LLM provider; swap to streaming                                             |
| `buildContextSnapshot`                                                    | `agents/context-snapshot.ts`                                                          | Snapshot composition                                                               | Replay; debug; deterministic re-runs                                             |
| `createAgentRun` / `finalizeAgentRun`                                     | `agents/runs.ts`                                                                      | Run lifecycle + cost rollup + AGENT*RUN*\* ActivityLog                             | Future status hooks (e.g., notify-on-finish webhooks)                            |
| `recordAgentAction` + `resolveActionStatus`                               | `agents/actions.ts`                                                                   | Approval rule application                                                          | Per-skill / per-org overrides                                                    |
| `approveAction` / `rejectAction` / `editAction` / `executeApprovedAction` | `agents/approvals.ts`                                                                 | DRAFTED → APPROVED/EDITED/REJECTED → EXECUTED transitions                          | The web UI's exit door from the approval queue                                   |
| `aggregateSteps`                                                          | `agents/step-aggregator.ts`                                                           | AI SDK v6 `step.content[]` walking                                                 | Provider swap                                                                    |
| `renderSystemPrompt`                                                      | `agents/templates/renderer.ts`                                                        | Placeholder substitution                                                           | New templates with different placeholders                                        |
| `createSerialDispatcher` / `createBullMQDispatcher`                       | `agents/dispatcher.ts` + `agents/bullmq-dispatcher.ts`                                | Sync vs async execution                                                            | `main-dispatcher` selects via `env.DISPATCH_MODE`                                |
| `buildCoalesceKey`                                                        | `agents/dispatcher.ts`                                                                | Jobid derivation from `DispatchOrigin`                                             | Tunable dedup window (currently jobId-based, BullMQ-native)                      |
| `defineSkill<T>`                                                          | `agents/skills/types.ts`                                                              | The Skill shape constraints                                                        | New skills are type-safe by construction                                         |
| `findTemplateBySlug` / `findSkillById` / `findRoutineByName`              | `agents/templates/registry.ts` + `agents/skills/registry.ts` + `routines/registry.ts` | In-code registries                                                                 | DB tables seeded from these; registry is canonical                               |
| `validateCanDelegateTo`                                                   | `agents/templates/registry.ts`                                                        | Acyclic + reference-integrity check                                                | Boot refuses to start with a broken graph                                        |
| `logActivity`                                                             | `activity/log.ts`                                                                     | Single write-point for ActivityLog                                                 | Future fan-out: Streams bus, webhooks                                            |
| `getRecentActivity`                                                       | `activity/query.ts`                                                                   | Clamped read with ordering                                                         | The web UI's timeline endpoint                                                   |
| `reconcileRoutines`                                                       | `routines/reconcile.ts`                                                               | BullMQ JobScheduler ↔ Routine row reconciliation                                   | Boot + every /ligar/desligar                                                     |
| `executeRoutine`                                                          | `routines/executor.ts`                                                                | Routine fire (load row → build prompt → dispatch → update last-run)                | The single entry point shared by the scheduler worker and the `/correr` command  |
| `getAdapter`                                                              | `connectors/registry.ts`                                                              | Total `Record<ConnectorType, ConnectorAdapter>` lookup                             | Inbound pipeline migration off Chat SDK (see §16)                                |

---

## 9. Phase history

| Phase                          | What it shipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Why discrete                                                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0**                          | Pruned a generic Turborepo template down to a Telegram-only API; renamed to `qolmeia`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | One mechanical commit.                                                                                                                                                            |
| **1**                          | Foundation: Telegram webhook (Chat SDK), Prisma schema with core models, `KnowledgeProvider` seam, fixed pt-BR ack.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Pipe before AI.                                                                                                                                                                   |
| **2 / 2.5**                    | Audio → soul via `generateObject`; single AI key. Conversational replies (LLM writes every reply); 5 sharpened soul fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Adds the constrained AI seam.                                                                                                                                                     |
| **3**                          | R2 brand assets + tool calling. `generateObject` → `generateText({ tools })`. Two tools: `extractSoul`, `labelBrandAsset`. SHA-256 dedup.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Two tools made the abstraction worthwhile.                                                                                                                                        |
| **4**                          | Third tool `generateBrandImage` via gpt-image-1. `thread.post({ files, markdown })`. AI SDK v6 step-aggregation fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Closes the voice → soul → image loop.                                                                                                                                             |
| **5a**                         | Six Prisma models (`AgentTemplate`, `AgentInstance`, `Skill`, `ConnectorInstance`, `AgentConnectorBinding`, `AgentAction`) + enums. Additive `Conversation.connectorInstanceId`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Schema atomic, then code.                                                                                                                                                         |
| **5b / 5c / 5d**               | Skills extraction; generic runtime + Designer template; dispatcher seam; Controller template + `delegateToSpecialist` + acyclic validation. Two agents, one delegation, full chain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | One template at a time.                                                                                                                                                           |
| **Refactor pass**              | Five deepening refactors (handler decomp into `inbox/`, `defineSkill<T>`, runtime split, brand-context extracted, `ensureAgentInstance` centralized). +25 tests, no behavior change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Structural debt cleanup.                                                                                                                                                          |
| **KR · Knowledge Registry**    | `KnowledgeDoc` model + `searchKnowledge` / `readKnowledgeDoc` skills.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Parallel surface for unstructured docs.                                                                                                                                           |
| **5e**                         | Marketing Strategist template + `draftMarketingStrategy` stub. 3-level delegation DAG (Controller → MarketingStrategist → Designer).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Existing seams absorbed it.                                                                                                                                                       |
| **5f**                         | `agents/actions.ts` + `agents/cost.ts`. Runtime persists one AgentAction per tool call (AUTO_APPROVED in v0). Per-action cost + 80/100% soft-warn.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Schema was in place since 5a.                                                                                                                                                     |
| **5g**                         | `agents/bullmq-dispatcher.ts` + `workers/{agent-runner,index}.ts`. Selects Serial or BullMQ via `env.DISPATCH_MODE`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Dispatcher seam ⇒ single-file policy change.                                                                                                                                      |
| **5h**                         | `POST /connectors/telegram/:connectorInstanceId/webhook` route + ConnectorInstance preference (TelegramLink fallback). Backfill migrated the existing TelegramLink row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Activates the 5a schema.                                                                                                                                                          |
| **Controller pivot** (566e07c) | Controller went from orchestrator-chef to **briefing-gatherer**: explicit-invocation router; default skills now include `extractSoul`, `searchKnowledge`, `readKnowledgeDoc`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Prompt-shape change; no code restructure.                                                                                                                                         |
| **Restructure — Group 1**      | Phase 5i cleanup (deleted legacy `/telegram/webhook` route + `TelegramLink` fallback codepath); `findInboundAgentInstanceForConnector` reads `AgentConnectorBinding(direction)` — no more hardcoded `templateSlug: "controller"`; binding seed on ConnectorInstance creation + backfill script; `connectors/<type>/adapter.ts` scaffold (`ConnectorAdapter` interface, real Telegram adapter, WhatsApp Meta-Cloud parser stub, Fresha typed placeholder).                                                                                                                                                                                                                                                                                                                  | Schema was ready; route and routing logic finally caught up. Adapter scaffold reserves the seam without touching the inbound pipeline yet.                                        |
| **Restructure — Group 2**      | `Organization.agentInstructions` + `Organization.businessIdea` reserved files (owner-only, rendered by `KnowledgeProvider` BEFORE the AI-extracted soul; `/instrucoes` and `/ideia` Telegram commands); BullMQ dispatcher coalescing via deterministic `jobId` (inbound + delegation); `AgentSkillEnablement` join table replaces `AgentInstance.enabledSkillIds: Json?` array (one-shot migration script).                                                                                                                                                                                                                                                                                                                                                                | Foundation for owner control over agent context + cheap dedup without app-side locks + structured per-skill metadata.                                                             |
| **Restructure — Group 3**      | `AgentRun` model (parent of `AgentAction`); `buildContextSnapshot` at dispatch time (runtime stops loading context); `createAgentRun` / `finalizeAgentRun` lifecycle. `ActivityLog` unified timeline (15 event types, 5 ref types); write-points in pipeline, runs, runtime, cost, owner-commands, routine executor. Customer-side approval rule ACTIVATED: `resolveActionStatus` flips `generateBrandImage` + `draftMarketingStrategy` to DRAFTED for CUSTOMER; `agents/approvals.ts` provides 4 programmatic helpers. `Routine` model + BullMQ JobScheduler-based scheduler (`routines/*` + `workers/routine-scheduler.ts` + seed `nightly-knowledge-summary` + `/rotinas`, `/ligar`, `/desligar`, `/correr` commands; explicit seeding via `scripts/sync-routines.ts`). | Three independent runtime additions that complete the spec's behaviour surface: replayable runs, an owner-facing timeline, customer-safe approvals, and proactive scheduled work. |

---

## 10. Roadmap

| Next                                                               | Adds                                                                                                                                                                                                                                                                                                                      | Where the seam already supports it                                                                                                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **v0 web UI**                                                      | Owner dashboard, **approval queue UI** (filters `AgentAction.status = DRAFTED` and calls the 4 `approvals.ts` helpers; the schema target is now concrete), onboarding wizard, KnowledgeDoc upload form, **ActivityLog timeline view** (consumes `getRecentActivity`), EQUIPE per-agent detail.                            | Schema is ready. `approvals.ts` and `activity/query.ts` are wired; only the HTTP + React surface is missing.                                                                                     |
| **Customer-facing connectors**                                     | Real WhatsApp / Fresha / Google My Business adapters with `senderRole = CUSTOMER`. **The approval rule is already active** — flipping a ConnectorInstance.senderRole to CUSTOMER instantly routes `generateBrandImage` and `draftMarketingStrategy` calls to DRAFTED. Needs: ConnectorInstance + binding + inbound route. | `ConnectorAdapter` is implemented for Telegram, WhatsApp parses Meta Cloud webhooks. `findInboundAgentInstanceForConnector` already binding-routes. `resolveActionStatus` already gates DRAFTED. |
| **WhatsApp follow-up**                                             | `routes/connectors/whatsapp.ts` route + `WhatsAppAdapter.sendOutbound` implementation + provisioning a real `ConnectorInstance(type: WHATSAPP)` for the org.                                                                                                                                                              | Adapter parses inbound; registry slot exists; pipeline needs to call `getAdapter(type).parseInboundPayload` instead of Chat SDK directly.                                                        |
| **More routines**                                                  | Currently 1 seeded (`nightly-knowledge-summary`). Add: weekly content calendar, monthly cost-review digest, reactivation outreach to dormant customers.                                                                                                                                                                   | `RoutineDefinition` is the only shape needed; add a file under `routines/`, register in `ALL_ROUTINES`, re-run `sync-routines.ts`.                                                               |
| **pgvector for `searchKnowledge`**                                 | Replace the Prisma `contains` keyword search with semantic retrieval.                                                                                                                                                                                                                                                     | Skill's input/output shape is stable (`{ query, limit } → { matches }`). Add a vector column to `KnowledgeDoc`, populate on `createKnowledgeDoc`, similarity search in the skill.                |
| **Inbound through ConnectorAdapter**                               | Stop routing inbound through Chat SDK; call `getAdapter(type).parseInboundPayload(raw, connectorConfig)` from the route handler; let the pipeline drive `NormalizedMessage`.                                                                                                                                              | Adapter interface + Telegram implementation exist. Pipeline already takes `senderRole + connectorInstanceId`. The only missing piece is the route handler swap.                                  |
| **`triggerMessageId` + `parentActionId` threading on AgentAction** | Pre-existing schema fields not yet written by the runtime path. Backfill from `AgentRun.triggerMessageId` and the delegation chain.                                                                                                                                                                                       | All upstream values are in scope inside `runtime.ts`; threading 2 more strings to `recordAgentAction` is mechanical.                                                                             |

---

## 11. Log line decoder

`telegram message handled` is the success line in `inbox/agent-step.ts`. Same shape as before, plus the new `runId`:

```json
{
  "level": 30,
  "time": 1779249880917,
  "env": "development",
  "chatId": "telegram:2037927176",
  "messageId": "2037927176:839200000",
  "newAssetIds": [],
  "generatedAssetIds": ["cmpdjfrpq0002i..."],
  "oversizeCount": 0,
  "toolCallSummary": {
    "delegateToSpecialist": 1,
    "extractSoul": 0,
    "generateBrandImage": 0,
    "labelBrandAsset": 0
  },
  "replyLength": 168,
  "tokensIn": 1252,
  "tokensOut": 44,
  "msg": "telegram message handled"
}
```

Note: when the Controller delegates to a specialist, its `toolCallSummary.generateBrandImage` is 0 — the image-gen happened inside the Designer's run. `generatedAssetIds` gets populated via the aggregator's spread from the delegation tool-result's `output.generatedAssetIds`.

Failure lines: `audio.download_failed`, `image.download_failed`, `image.ingest_failed`, `delegateToSpecialist.unauthorized`, `delegateToSpecialist.unknown_template`, `delegateToSpecialist.failed`, `generateBrandImage.failed`, `generated_image.post_failed`, `handler.failed`, `handler.reply_failed`, `agentRun.finalize.failed`, `bullmq-dispatcher.job_failed`, `routines.execute.unknown_definition`, `routines.scheduler-control.reconcile_failed`, `activityLog.write.failed`.

### ActivityLog rows — the durable counterpart to Pino

Pino logs are the source of truth for ops (Loki/Datadog). `ActivityLog` is the **business-facing** stream: pt-BR summaries that the web UI renders. Sample rows for the Black Friday walk-through above:

| `type`               | `refType`      | `refId`           | `summary`                                        | `payload` (abridged)                                                                                |
| -------------------- | -------------- | ----------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `MESSAGE_INBOUND`    | `MESSAGE`      | `msg_<id>`        | "Mensagem recebida via Telegram"                 | `{ contentType: "TEXT", attachmentCount: 0, externalMessageId }`                                    |
| `AGENT_RUN_STARTED`  | `AGENT_RUN`    | `run_ctrl`        | "Agente Controller iniciou"                      | `{ agentInstanceId, templateSlug: "controller", parentRunId: null, triggerMessageId, mission: "" }` |
| `AGENT_RUN_STARTED`  | `AGENT_RUN`    | `run_strat`       | "Agente Marketing Strategist iniciou"            | `{ parentRunId: "run_ctrl", ... }`                                                                  |
| `AGENT_RUN_STARTED`  | `AGENT_RUN`    | `run_designer`    | "Agente Designer iniciou"                        | `{ parentRunId: "run_strat", ... }`                                                                 |
| `ACTION_EXECUTED`    | `AGENT_ACTION` | `act_genimg`      | "Skill Generate Brand Image executada"           | `{ skillId: "generateBrandImage", costCents: 22, runId: "run_designer" }`                           |
| `AGENT_RUN_FINISHED` | `AGENT_RUN`    | `run_designer`    | "Agente Designer concluiu em 4280ms"             | `{ costCents, costInputTokens, costOutputTokens, durationMs }`                                      |
| `ACTION_EXECUTED`    | `AGENT_ACTION` | `act_deleg_dsg`   | "Skill Delegate to Specialist executada"         | `{ skillId: "delegateToSpecialist", runId: "run_strat" }`                                           |
| `AGENT_RUN_FINISHED` | `AGENT_RUN`    | `run_strat`       | "Agente Marketing Strategist concluiu em 5910ms" | ...                                                                                                 |
| `ACTION_EXECUTED`    | `AGENT_ACTION` | `act_deleg_strat` | "Skill Delegate to Specialist executada"         | `{ skillId: "delegateToSpecialist", runId: "run_ctrl" }`                                            |
| `AGENT_RUN_FINISHED` | `AGENT_RUN`    | `run_ctrl`        | "Agente Controller concluiu em 7240ms"           | ...                                                                                                 |

CUSTOMER-side variant (same trigger, `senderRole = CUSTOMER`): `ACTION_EXECUTED` for `generateBrandImage` becomes `ACTION_DRAFTED` with summary `"Skill Generate Brand Image aguardando aprovação"`. Owner-command variant: `OWNER_COMMAND` → ROUTINE_ENABLED, INSTRUCTIONS_UPDATED, etc.

---

## 12. Where the spec/plan history lives

```
docs/superpowers/specs/  ← what to build (decisions, schema, prompts, error modes)
docs/superpowers/plans/  ← how to build it (per-task with full code + commit checklists)
```

Filenames: `YYYY-MM-DD-<phase>-<topic>-{design,implementation}.md`. Multi-agent overall spec: `docs/superpowers/specs/2026-05-20-qolmeia-multi-agent-architecture-design.md`. Restructure motivation: `docs/research/2026-05-20-paperclip-and-multica.md`.

---

## 13. Testing & quality bar

- **275 tests** (266 api + 9 db) after the restructure (was 140+4 at pre-restructure HEAD `8371163`). **70+ new test files** across the three groups, covering: the connector adapter set, AgentSkillEnablement-driven skill resolution, AgentRun lifecycle, ContextSnapshot construction, ActivityLog writes (per write-point), approval helpers, routines (registry/executor/reconcile/scheduler-control/nightly-knowledge-summary), owner-commands (every subcommand + senderRole gating), BullMQ coalescing, and the senderRole-aware action status resolver.
- Mocked at seams (AI SDK, R2 SDK, Prisma); no live calls in CI.
- Integration tests in `packages/db/src/__tests__/` against the local docker Postgres (now 9, including Phase 5a + the new Group-2/3 models).
- Lint: oxlint. 0/0.
- Format: oxfmt.
- Type-check: `tsc --noEmit` across all packages via Turbo. Strict mode.
- Dead-code check: `pnpm fallow:dead` exits 0.

Run everything:

```bash
pnpm install
pnpm build && pnpm lint && pnpm typecheck && pnpm test && pnpm fallow:dead
```

---

## 14. Local dev

```bash
docker compose up -d                    # Postgres :5436 + Redis :6382
pnpm dev --filter=api                   # tsdown watch + auto-restart
# Optional second terminal — only needed when DISPATCH_MODE=queue OR you want
# routine schedulers running locally:
pnpm dev --filter=api dev:worker        # agent-runner + routine-scheduler
cloudflared tunnel --url http://localhost:4000

set -a; source apps/api/.env; set +a
TUNNEL="https://<paste-from-cloudflared>"
# Replace <connectorInstanceId> with the row for your Telegram chat (visible
# in the connector_instance table after first run).
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${TUNNEL}/connectors/telegram/<connectorInstanceId>/webhook" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET_TOKEN}"

# Optional one-time seed of paused-by-default routines:
pnpm tsx apps/api/src/scripts/sync-routines.ts            # all orgs
pnpm tsx apps/api/src/scripts/sync-routines.ts <orgSlug>  # one org
```

`syncSkills` + `syncTemplates` run at boot. First message triggers the lazy-create chain (`AgentInstance` for Controller via handler; for Designer / Marketing Strategist via delegation). Routine rows must be seeded explicitly. The routine scheduler reconciles on worker boot and on every `/ligar` / `/desligar`.

---

## 15. One-line summary for the next engineer

> Telegram webhook hits `POST /connectors/telegram/:connectorInstanceId/webhook` → Chat SDK → `inbox/pipeline` (owner-command short-circuit; otherwise dedup → ConnectorInstance lookup with senderRole → persist + ActivityLog → attachments → `agent-step` builds the ContextSnapshot, creates an AgentRun, dispatches through `main-dispatcher` which is Serial inline OR BullMQ with deterministic jobId coalescing) → `runtime.runAgentInstance` reads its systemPrompt + runId + senderRole from args, resolves enabled skills via `AgentSkillEnablement` (or template defaults), runs `generateText`, persists one AgentAction per tool call (status from `resolveActionStatus(senderRole, requiresApproval)` — owner auto-approves, CUSTOMER on approval-gated skills lands DRAFTED), emits one ActivityLog per action plus budget warnings → Controller delegates to specialists via `delegateToSpecialist` (which builds the child snapshot, creates a child AgentRun linked via `parentRunId`, and re-enters the dispatcher with a delegation coalesce key) → results bubble up through the step-aggregator → Controller writes the final pt-BR reply → handler posts text + any generated images back to Telegram. In parallel, a routine-scheduler worker reads `Routine` rows (paused-by-default, owner-flipped via `/ligar`), upserts BullMQ JobSchedulers, and the routine executor fires on cron through the same AgentRun lifecycle. `agents/approvals.ts` exposes `approve / reject / edit / executeApproved` as programmatic exits from the approval queue — the web UI hasn't shipped yet. 275 tests; never silent-fails; single AI key; Prisma + Postgres for data, R2 for binaries, Redis for Chat SDK state, BullMQ jobs, and JobScheduler state. No more legacy route, no more hardcoded controller routing, no more `Json?` skill arrays, no more runtime-side context loading.

---

## 16. Connector adapter pattern

Group 1 introduced a parallel inbound contract that does NOT yet handle live traffic. It exists so the WhatsApp follow-up (and future Instagram / Google My Business / Fresha integrations) doesn't need to invent the seam.

### The interface

`apps/api/src/connectors/types.ts`:

```ts
type ConnectorAdapter = {
  capabilities: { inbound: boolean; outbound: boolean };
  parseInboundPayload: (raw: unknown, connectorConfig: unknown) => Promise<NormalizedMessage>;
  sendOutbound: (args: SendOutboundArgs) => Promise<{ externalMessageId: string }>;
  type: ConnectorType;
  validateConfig: (config: unknown) => ConfigValidationResult;
};

type NormalizedMessage = {
  attachments: ReadonlyArray<NormalizedAttachment>;
  authorDisplayName: string | null;
  externalId: string; // provider-native message id (dedup)
  externalThreadId: string; // provider-native thread/chat id
  rawTimestamp: number; // ms (adapters normalize from seconds)
  text: string | null;
};
```

### Current state

| ConnectorType        | Adapter file                           | Inbound                        | Outbound                                           | Wired into inbound pipeline?     |
| -------------------- | -------------------------------------- | ------------------------------ | -------------------------------------------------- | -------------------------------- |
| `TELEGRAM`           | `connectors/telegram/adapter.ts`       | full                           | full (sendMessage + sendDocument via native fetch) | NO — Chat SDK still owns inbound |
| `WHATSAPP`           | `connectors/whatsapp/adapter.ts`       | parses Meta Cloud API webhooks | `NotImplementedError`                              | NO                               |
| `FRESHA`             | `connectors/fresha/adapter.ts`         | `NotImplementedError`          | `NotImplementedError`                              | NO                               |
| `GOOGLE_MY_BUSINESS` | `connectors/registry.ts` (placeholder) | `NotImplementedError`          | `NotImplementedError`                              | NO                               |
| `INSTAGRAM`          | `connectors/registry.ts` (placeholder) | `NotImplementedError`          | `NotImplementedError`                              | NO                               |

The registry is **total over `ConnectorType`** — `getAdapter(type)` always returns an adapter. Placeholders throw `NotImplementedError` with a deterministic message; `validateConfig` reports invalid upfront.

### Migration path (Phase 6+)

1. `routes/connectors/<type>.ts` calls `getAdapter(type).parseInboundPayload(raw, connectorConfig)` to produce a `NormalizedMessage`.
2. The pipeline's input becomes `NormalizedMessage` instead of Chat SDK's `IncomingMessage` (shapes overlap; one-pass refactor).
3. Outbound: replace `thread.post({ ... })` with `adapter.sendOutbound({ connectorConfig, payload, threadId })`.
4. Delete the Chat SDK dependency from `telegram/bot.ts`.

The constraint that kept this from happening in the restructure: the inbox pipeline assumes Chat SDK's `IncomingThread` shape for `thread.post(...)`. Migrating Telegram first (the adapter is already implemented) is the smallest unit; WhatsApp is the second unit that justifies the work.

---

## 17. Reserved files — `agentInstructions` + `businessIdea`

Borrowed wholesale from Paperclip's plugin-llm-wiki pattern (see `docs/research/2026-05-20-paperclip-and-multica.md` §2.4). The owner needs free-form fields that no agent or skill can ever overwrite — onboarding context that lives ABOVE the AI-extracted soul.

### Schema (`Organization`)

```prisma
agentInstructions String?  @db.Text   // AGENTS.md equivalent — how the AI workforce should behave
businessIdea      String?  @db.Text   // IDEA.md equivalent — owner's direction for the business
businessProfile   Json?              // AI-extracted soul (unchanged) — written by extractSoul
```

### Read path

`knowledge/provider.ts → getBusinessContext(orgId)` renders sections in this order:

````
## Ideia do negócio (definida pelo dono)
<businessIdea>

## Instruções para a equipe de IA (definidas pelo dono)
<agentInstructions>

# Business Context
```json
<businessProfile>
````

```

Owner-curated content comes **first** so the model anchors on it before the AI-extracted summary.

### Write path

| Field               | Owner UX (today)                              | Future UX                | Skills can write? |
| ------------------- | --------------------------------------------- | ------------------------ | ----------------- |
| `agentInstructions` | `/instrucoes` (read) / `/instrucoes <text>` (set) | Web settings page        | **No**            |
| `businessIdea`      | `/ideia` (read) / `/ideia <text>` (set)       | Web settings page        | **No**            |
| `businessProfile`   | `extractSoul` skill (AI-curated)              | Web inspector + edit     | Yes (via `applySoulUpdate`) |

The owner-command handler gates by `senderRole === "OWNER"` — `inbox/pipeline.ts` short-circuits the agent runtime when an owner sends a recognised slash command. Customer-side connectors can't reach these write paths because `parseOwnerCommand` only runs in the OWNER branch.

### Emitted ActivityLog rows

- `INSTRUCTIONS_UPDATED` (refType: ORGANIZATION) on every `/instrucoes <text>` write.
- `BUSINESS_IDEA_UPDATED` (refType: ORGANIZATION) on every `/ideia <text>` write.
- `OWNER_COMMAND` (refType: MESSAGE) on every owner-command receipt — including the read-only `/instrucoes` / `/ideia` lookups.

---

## 18. Approval flow

Phase 5 §8 lays out the rule; Group 3.3 activated it.

### The rule (`agents/actions.ts → resolveActionStatus`)

```

ownerSide = senderRole !== "CUSTOMER"
status = (ownerSide || !skill.requiresApprovalDefault) ? AUTO_APPROVED : DRAFTED

````

Pedro and internal triggers (`senderRole === null`) are always owner-side. CUSTOMER-side runs auto-approve **only** when the skill opts out of approval (`requiresApprovalDefault: false`).

### Current state

| Skill                    | `requiresApprovalDefault` | Owner-side outcome | CUSTOMER-side outcome |
| ------------------------ | ------------------------- | ------------------ | --------------------- |
| `delegateToSpecialist`   | `false`                   | AUTO_APPROVED      | AUTO_APPROVED         |
| `extractSoul`            | `false`                   | AUTO_APPROVED      | AUTO_APPROVED         |
| `labelBrandAsset`        | `false`                   | AUTO_APPROVED      | AUTO_APPROVED         |
| `searchKnowledge`        | `false`                   | AUTO_APPROVED      | AUTO_APPROVED         |
| `readKnowledgeDoc`       | `false`                   | AUTO_APPROVED      | AUTO_APPROVED         |
| `generateBrandImage`     | **`true`** ★              | AUTO_APPROVED      | **DRAFTED** ★         |
| `draftMarketingStrategy` | **`true`** ★              | AUTO_APPROVED      | **DRAFTED** ★         |

Important: the tool call **executes** regardless. The DRAFTED status records the proposed input + result for owner review; it doesn't prevent the underlying side-effect (the image lands in R2, the strategy gets generated). The web UI's job is to surface DRAFTED rows; the owner approves (publish), edits (republish with tweaks), or rejects (mark and move on).

### Programmatic helpers (`agents/approvals.ts`)

```ts
approveAction({ actionId, decidedByUserId })
  → status: DRAFTED → APPROVED + decidedAt + ActivityLog ACTION_APPROVED

rejectAction({ actionId, decidedByUserId, reason? })
  → status: DRAFTED → REJECTED + errorMessage=reason + ActivityLog ACTION_REJECTED

editAction({ actionId, decidedByUserId, newInput })
  → status: DRAFTED → EDITED + proposedInput=newInput + ActivityLog ACTION_APPROVED (edited=true)

executeApprovedAction({ actionId })
  → APPROVED|EDITED → calls skill.execute(proposedInput, ctx) → EXECUTED + ActivityLog ACTION_EXECUTED
  → on throw → FAILED + ActivityLog ACTION_FAILED
````

The `SkillContext` injected by `executeApprovedAction` leaves `dispatcher` + `parentRunArgs` as undefined stubs — no current approval-gated skill reaches for them. The first skill that does will need a real dispatcher path; that's the trigger to add a queued execution path for post-approval runs.

### What's missing

- **No HTTP endpoints.** The helpers are pure functions awaiting a route handler.
- **No UI.** The dashboard renders nothing today.
- **No notifications.** When a DRAFTED row lands, the owner has no out-of-band signal. A future routine (or webhook fan-out from `logActivity`) can push a Telegram message.

---

## 19. Routines

Group 3.4 added a Paperclip-style proactive-trigger surface alongside the reactive (inbound) one. Routines are **paused-by-default** scheduled invocations of an AgentInstance; the owner opts in via `/ligar`.

### `RoutineDefinition` shape (`routines/types.ts`)

```ts
type RoutineDefinition = {
  buildPrompt: (config: RoutineConfig, ctx: { orgId; prisma }) => Promise<string>;
  defaultAgentTemplate: string; // templateSlug — the agent this routine invokes
  defaultConfig: RoutineConfig; // initial shape for Routine.config
  defaultSchedule: string; // cron expression in the org's timezone
  description: string; // human label (refreshed on every sync)
  name: string; // unique per org; the key the owner uses in /ligar /desligar /correr
};
```

The DB `Routine` row owns `schedule`, `enabled`, and `config` (mutable by the owner); the code definition owns `buildPrompt` and `defaultAgentTemplate` (immutable across deploys).

### The seed routine

`routines/nightly-knowledge-summary.ts`:

| Field                  | Value                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `name`                 | `nightly-knowledge-summary`                                                                                           |
| `defaultSchedule`      | `0 3 * * *` (03:00 daily in `America/Sao_Paulo`)                                                                      |
| `defaultAgentTemplate` | `controller`                                                                                                          |
| `defaultConfig`        | `{ maxDocs: 5 }`                                                                                                      |
| `buildPrompt`          | Queries the last 24h of `KnowledgeDoc` rows, formats a pt-BR digest prompt. Empty-doc case yields a neutral check-in. |
| `description`          | "Toda noite às 3h, resume os documentos adicionados ao conhecimento nas últimas 24h e envia um digest para o dono."   |

### The scheduler worker

`workers/routine-scheduler.ts` runs alongside `agent-runner` inside `pnpm dev:worker`:

1. Boot: `createRoutineQueue(connection)` → BullMQ queue `qolmeia-routine-run` + Worker (concurrency 2).
2. `reconcileRoutines({ prisma, queue })` is called on boot AND on every `/ligar` / `/desligar` (via `routines/scheduler-control.triggerReconcile`).
3. Reconciler diffs `Routine` rows (where `enabled=true`) against existing BullMQ JobSchedulers (filtered to `key.startsWith("routine:")`). Adds missing schedulers, removes orphans, updates drift in `(schedule, timezone)`.
4. On fire, the worker calls `executeRoutine({ routineId })`:
   - Loads the row + the code `RoutineDefinition`.
   - Emits `ROUTINE_TRIGGERED` ActivityLog.
   - Builds the prompt + creates an `AgentRun` (with `triggerMessageId: null`).
   - Dispatches through `main-dispatcher` (Serial or BullMQ — same path as inbound).
   - Updates `lastRunAt` + `lastRunStatus`.
   - **Swallows its own errors** — a flaky routine doesn't compound through BullMQ retries; the owner sees `lastRunStatus = "FAILED"` and the ActivityLog row.

### Owner commands (`inbox/owner-commands.ts`)

| Command            | Behaviour                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/rotinas`         | List all routines for the org with `schedule`, `enabled` state, and `lastRun` status.                                                            |
| `/ligar <name>`    | Set `enabled = true` → log `ROUTINE_ENABLED` → `triggerReconcile` (best-effort; scheduler also reconciles on boot).                              |
| `/desligar <name>` | Set `enabled = false` → log `ROUTINE_DISABLED` → `triggerReconcile`.                                                                             |
| `/correr <name>`   | One-off invocation that bypasses cron. Temporarily flips `enabled` if needed (the executor re-checks the flag), runs `executeRoutine`, restores. |

### Adding a new routine

1. Create `apps/api/src/routines/<name>.ts` exporting a `RoutineDefinition`.
2. Add it to `ALL_ROUTINES` in `routines/registry.ts`.
3. Run `pnpm tsx apps/api/src/scripts/sync-routines.ts` to upsert rows (paused) for every existing org.
4. Restart the worker (the scheduler reconciles on boot; for an existing process, the next `/ligar` triggers reconcile).

The DB row is the source of truth for runtime; the code is the source of truth for behaviour. Owner customisations (`schedule`, `config`) survive deploys because `syncRoutines` only refreshes `description` on existing rows.
