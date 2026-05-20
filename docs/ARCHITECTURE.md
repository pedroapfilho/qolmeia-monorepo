# Qolmeia — Architecture Overview

> What's shipped on `main` (HEAD `8371163`) and how every piece fits together. This doc reflects Phases 5a–5h, the architecture-deepening refactor, and the Knowledge Registry — the full multi-agent platform with async dispatch and per-connector webhook routes.

---

## 1. What Qolmeia is (one paragraph)

Qolmeia is an AI workforce platform for Brazilian local businesses. The MVP currently ships **one channel** (a Telegram bot, `@qolmeia_mvp_v0_bot`) and **three seeded agents** working as a delegation DAG: a **Controller** that talks to the owner and routes work, a **Marketing Strategist** that drafts campaigns and can ask the Designer for visuals, and a **Designer** that captures the business "soul," annotates uploaded brand assets, and generates branded images. The Controller delegates to either specialist via a `delegateToSpecialist` skill. Agents can search a per-org **Knowledge Registry** of markdown docs in R2 (`searchKnowledge` + `readKnowledgeDoc`) for richer context — policies, brand voice, FAQs — that doesn't fit in the structured `businessProfile`. Every tool call persists as an `AgentAction` row with cost tracking (LLM tokens + per-image cost). Execution can be **serial** (default) or **async via BullMQ** on the same Redis Chat SDK uses for state; flipping `DISPATCH_MODE=queue` plus running `pnpm dev:worker` enables the queue path. The repo is a pnpm + Turborepo monorepo with one app (`apps/api`, Hono on Node) and three packages (`@repo/db`, `@repo/config-vitest`, `@repo/typescript-config`).

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
                                           │ POST /telegram/webhook
                                           │ X-Telegram-Bot-Api-Secret-Token: <secret>
                                           ▼
       ┌────────────────────────────────────────────────────────────────┐
       │  apps/api (Hono on Node, port 4000)                            │
       │                                                                │
       │  routes/telegram/webhook.ts                                    │
       │     │                                                          │
       │     ▼                                                          │
       │  telegram/bot.ts                                               │
       │     · Chat SDK Chat singleton                                  │
       │     · injects { dispatcher, prisma } into the pipeline         │
       │     │                                                          │
       │     ▼                                                          │
       │  inbox/pipeline.ts  (compositional orchestrator, ~150 lines)   │
       │     ├─ inbox/ingest.ts        idempotency + identity + msg     │
       │     ├─ inbox/attachments.ts   image + audio download / ingest  │
       │     ├─ inbox/agent-step.ts    context load + dispatch + post   │
       │     └─ inbox/json-safe.ts     strip non-JSON-safe values       │
       │     │                                                          │
       │     ▼                                                          │
       │  agents/main-dispatcher.ts    SerialDispatcher singleton       │
       │     │                                                          │
       │     ▼                                                          │
       │  agents/runtime.runAgentInstance (Controller AgentInstance)    │
       │     ├─ resolves template (controller) + enabled skills         │
       │     ├─ renders system prompt via templates/renderer.ts         │
       │     ├─ calls Vercel AI SDK generateText with tools             │
       │     │   tools = { delegateToSpecialist }                       │
       │     └─ aggregates step.content[] via step-aggregator.ts        │
       │     │                                                          │
       │     ▼ (Controller calls delegateToSpecialist("designer", ...)) │
       │  agents/skills/delegate-to-specialist.ts                       │
       │     ├─ validates canDelegateTo                                 │
       │     ├─ ensureAgentInstance("designer") — lazy-create child     │
       │     └─ dispatcher.enqueueAndAwait({ child + subtask })         │
       │         ▼                                                      │
       │     agents/runtime.runAgentInstance (Designer AgentInstance)   │
       │         tools = { extractSoul, generateBrandImage,             │
       │                   labelBrandAsset }                            │
       │         skill execute() → knowledge/* + lib/* + connectors     │
       └────────────────┬────────────────┬───────────────┬──────────────┘
                        │                │               │
                        ▼                ▼               ▼
         ┌──────────────────┐  ┌──────────────┐  ┌──────────────────────┐
         │  Postgres (5436) │  │  Redis (6382)│  │ Cloudflare R2        │
         │  Prisma 7        │  │  Chat SDK    │  │ (S3-compatible)       │
         │  + adapter-pg    │  │  state +     │  │ AWS SDK v3            │
         │                  │  │  dedup       │  │ Bucket "qolmeia"      │
         │  Organization    │  │              │  │ keys: org_<id>/       │
         │  TelegramLink    │  │              │  │       <sha256>.<ext>  │
         │  Customer        │  │              │  │                       │
         │  Conversation    │  │              │  │ Stores: uploaded logos│
         │  Message         │  │              │  │  + generated images   │
         │  WebhookEvent    │  │              │  │                       │
         │  BrandAsset      │  │              │  │                       │
         │  ── new (5a) ──  │  │              │  │                       │
         │  AgentTemplate   │  │              │  │                       │
         │  AgentInstance   │  │              │  │                       │
         │  Skill           │  │              │  │                       │
         │  ConnectorInstance│ │              │  │                       │
         │  AgentConnectorBinding│           │  │                       │
         │  AgentAction     │  │              │  │                       │
         └──────────────────┘  └──────────────┘  └──────────────────────┘

                        │                                ▲
                        │                                │
                        ▼                                │
         ┌─────────────────────────────────────────────────────────────┐
         │  Vercel AI Gateway   (single key: AI_GATEWAY_API_KEY)        │
         │                                                              │
         │  · agent loops     → google/gemini-2.5-flash                 │
         │     ▸ via AI SDK generateText({ tools, stopWhen })            │
         │     ▸ 7 skills, 3 agents, 2 delegation edges                  │
         │  · image generation → openai/gpt-image-1                      │
         │     ▸ via direct fetch to                                     │
         │       https://ai-gateway.vercel.sh/v1/images/generations      │
         └─────────────────────────────────────────────────────────────┘
```

**Dispatch modes:** `DISPATCH_MODE=serial` (default) runs the agent loop inline inside the webhook handler — single process, no queue. `DISPATCH_MODE=queue` enqueues a BullMQ job; a separate worker process (`pnpm dev:worker`) consumes it; webhook returns 200 immediately. Delegation skills enqueue child jobs through the same queue; worker concurrency is 4 (handles up to depth-4 delegation chains).

---

## 3. Where the code lives (skimmer's guide)

Read in this order to understand the system fastest.

### Apps

- **`apps/api/`** — the only application. Hono server on Node 24, bundled by tsdown. Boots on `http://localhost:4000`. Single entry point: `src/index.ts` (also runs `syncSkills` + `syncTemplates` at startup).

### Packages

- **`@repo/db`** — Prisma 7 schema (`packages/db/prisma/schema.prisma`) + the singleton `prisma` client. Uses `@prisma/adapter-pg` for native Postgres. 4 db integration tests live here under `src/__tests__/`.
- **`@repo/config-vitest`** — shared Vitest config (`node.ts`, `react.ts`).
- **`@repo/typescript-config`** — shared `tsconfig` bases.

### Inside `apps/api/src/`

| Path                                                     | Owns                                                                                                                                                                              | When to read                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `index.ts`                                               | Hono bootstrap, middleware wiring, `syncSkills` + `syncTemplates` at boot, graceful shutdown                                                                                      | Start here — top of the call graph.                                     |
| `routes/telegram/webhook.ts`                             | `POST /telegram/webhook` route; delegates to Chat SDK                                                                                                                             | HTTP entry.                                                             |
| `telegram/bot.ts`                                        | Chat SDK `Chat` singleton; injects `{ dispatcher, prisma }` into the pipeline                                                                                                     | How webhook events become handler calls.                                |
| `inbox/pipeline.ts`                                      | The orchestrator. ~150 lines. Composes the 5 stages below; owns user-facing error replies                                                                                         | Read AFTER you know each stage exists.                                  |
| `inbox/json-safe.ts`                                     | `toJsonSafe(value)` — strips functions/undefined for Prisma JSON columns                                                                                                          | Tiny utility; one read.                                                 |
| `inbox/ingest.ts`                                        | WebhookEvent dedup, Organization+TelegramLink+Conversation resolution, Message persistence                                                                                        | First stage of every inbound.                                           |
| `inbox/attachments.ts`                                   | Image + audio download, R2 upload via `ingestBrandAsset`, oversize tracking                                                                                                       | Pre-LLM data prep.                                                      |
| `inbox/agent-step.ts`                                    | Loads `KnowledgeProvider` context, `ensureAgentInstance("controller")`, `dispatcher.enqueueAndAwait`, posts results to Telegram (with image-fetch fallback)                       | The interesting middle of the pipeline.                                 |
| `agents/dispatcher.ts`                                   | `AgentDispatcher` interface + `createSerialDispatcher(runner)` factory. Defines `AgentDispatchArgs` (the shape that flows runtime↔skills)                                         | The seam Phase 5g swaps for BullMQ.                                     |
| `agents/main-dispatcher.ts`                              | The module-level singleton: `const dispatcher = createSerialDispatcher(runAgentInstance)`                                                                                         | One file, six lines.                                                    |
| `agents/runtime.ts`                                      | `runAgentInstance({...})` — generic agent loop. Loads template + filtered skills, builds messages, calls `generateText`, aggregates results                                       | The "heart." ~120 lines.                                                |
| `agents/step-aggregator.ts`                              | `aggregateSteps(steps, knownIds)` — walks AI SDK v6 `step.content[]` for tool counts + generatedAssetIds (including spread from `delegateToSpecialist` results)                   | Pure function. Provider-specific quarantined.                           |
| `agents/agent-instance.ts`                               | `ensureAgentInstance({ orgId, templateSlug, prisma })` — single source of truth for upserting an `AgentInstance` row. Derives `displayName` from the template registry            | Two callers (handler + delegation skill).                               |
| `agents/templates/types.ts`                              | `AgentTemplateDefinition` shape — slug, displayName, defaultSystemPrompt, defaultMission, defaultEnabledSkillIds, canDelegateTo, compatibleConnectorTypes                         | In-code template type.                                                  |
| `agents/templates/controller.ts`                         | Controller template — pt-BR orchestrator prompt; `canDelegateTo: ["designer"]`; `defaultEnabledSkillIds: ["delegateToSpecialist"]`                                                | The user-facing agent.                                                  |
| `agents/templates/designer.ts`                           | Designer template — pt-BR onboarding prompt; `canDelegateTo: []`; `defaultEnabledSkillIds: ["extractSoul", "generateBrandImage", "labelBrandAsset"]`                              | The specialist.                                                         |
| `agents/templates/registry.ts`                           | `ALL_TEMPLATES`, `findTemplateBySlug`, `syncTemplates`, **`validateCanDelegateTo`** (acyclic + reference-integrity, runs before any DB write)                                     | The boot-time invariant gate.                                           |
| `agents/templates/renderer.ts`                           | `renderAssetsBlock`, `renderExistingBlock`, `renderSystemPrompt` — pure prompt-templating functions                                                                               | No I/O; trivially testable.                                             |
| `agents/skills/types.ts`                                 | `Skill<TInput, TOutput>` shape, `SkillContext` (orgId, agentInstanceId, prisma, dispatcher, parentRunArgs), `AnySkill` super-type, **`defineSkill<T>()` factory**                 | The skill contract.                                                     |
| `agents/skills/registry.ts`                              | `ALL_SKILLS` (typed tuple via `satisfies`), `findSkillById`, `syncSkills` (Zod → JSON Schema render). Zero `as unknown` casts                                                     | Boot also seeds the Skill table.                                        |
| `agents/skills/extract-soul.ts`                          | Skill: capture the 5 soul fields via `applySoulUpdate`                                                                                                                            | One-call skill.                                                         |
| `agents/skills/label-brand-asset.ts`                     | Skill: update `BrandAsset.metadata` (palette, styleDescriptors, typography) for an uploaded asset                                                                                 | One-call skill.                                                         |
| `agents/skills/generate-brand-image.ts`                  | Skill: 4-step pipeline (`getBrandContext` → `enrichPromptWithBrand` → `generateBrandImageBytes` → `ingestGeneratedAsset`)                                                         | ~50 lines after extracting the aggregator.                              |
| `agents/skills/delegate-to-specialist.ts`                | Built-in skill for orchestrators. Validates target ∈ `canDelegateTo`, lazy-creates child via `ensureAgentInstance`, dispatches a child run with parent args + replaced text       | The thing that makes the DAG work.                                      |
| `knowledge/provider.ts`                                  | `getBusinessContext(orgId)` — the seam that hides `Organization.businessProfile` from every other module                                                                          | One-line markdown serializer.                                           |
| `knowledge/soul.ts`                                      | `SoulProfile` type + `SOUL_FIELDS` array (the 5 fields)                                                                                                                           | Pure types.                                                             |
| `knowledge/apply.ts`                                     | `applySoulUpdate(orgId, partial, prisma)` — the ONLY writer of `Organization.businessProfile`. Scalar patch-merge in `$transaction`                                               | Single-writer seam.                                                     |
| `knowledge/brand-asset.ts`                               | `ingestBrandAsset` + `ingestGeneratedAsset` — the ONLY callers of `prisma.brandAsset.create`. SHA-256 dedup + R2 upload + row create                                              | Single-writer seam.                                                     |
| `knowledge/brand-context.ts`                             | `getBrandContext(orgId, prisma)` + `enrichPromptWithBrand(prompt, aspectRatio, brand)` — extracts visual context from recent uploaded BrandAssets                                 | Used by `generateBrandImage`; may be reused by future Marketing skills. |
| `lib/env.ts`                                             | Zod-validated env loader. Required: `DATABASE_URL`, `REDIS_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET_TOKEN`, `AI_GATEWAY_API_KEY`, all R2\_\* | Boot-time validator.                                                    |
| `lib/logger.ts`                                          | Pino logger with auth-header redaction                                                                                                                                            | Used throughout.                                                        |
| `lib/storage.ts`                                         | Cloudflare R2 (S3-compatible) wrapper. `assetKey`, `uploadAsset`, `fetchAsset`                                                                                                    | Single connector to R2.                                                 |
| `lib/image-gen.ts`                                       | `generateBrandImageBytes({ aspectRatio, prompt })` — POSTs to AI Gateway's OpenAI-compatible images endpoint with `model: "openai/gpt-image-1"`                                   | One function, swappable model.                                          |
| `middleware/security.ts` + `middleware/error-handler.ts` | CORS, security headers, rate limiting, body size limit; top-level Hono error handler + 404                                                                                        | Unchanged through all phases.                                           |

---

## 4. Data model

Schema lives in `packages/db/prisma/schema.prisma`. Provider: `postgresql`. Generator: `prisma-client` with `@prisma/adapter-pg`.

### Models (after Phase 5a additions)

```
Organization                                       (the tenant)
  id, name, slug @unique
  timezone, currency                              "America/Sao_Paulo", "BRL" defaults
  businessProfile Json?                           ★ THE SOUL — only via KnowledgeProvider
  telegramLink, customers, conversations, brandAssets
  agentInstances ⋅ connectorInstances             ← Phase 5a

TelegramLink                                      (Phase 5h cuts this over to ConnectorInstance)
  telegramChatId @unique, orgId @unique

Customer (orgId, phone?, email?, name?, meta?)    @@unique by (orgId, phone) / (orgId, email)

Conversation
  channel, externalId?, status, orgId, customerId?
  connectorInstanceId?                            ← Phase 5a (optional FK; null today)
  messages

Message
  conversationId, externalId?
  sender (CUSTOMER|AGENT|SYSTEM)
  content, contentType (TEXT|AUDIO|IMAGE|DOCUMENT)
  metadata Json?                                  raw Telegram payload (sanitized via toJsonSafe)
  @@unique([conversationId, externalId])

WebhookEvent                                      (idempotency)
  provider, externalId, payload Json, status
  @@unique([provider, externalId])

BrandAsset                                        (org-scoped brand binary assets)
  orgId, r2Key, sha256, mimeType, size
  metadata Json @default("{}")
    · uploaded: { palette, styleDescriptors, typography }
    · generated: { source:"generated", prompt, generatedAt }
  @@unique([orgId, sha256])

──── Phase 5a additions ──────────────────────────────────────────────

AgentTemplate                                     (system-defined; seeded from code)
  slug @id                                        "controller", "designer"
  displayName, description, defaultSystemPrompt, defaultMission
  compatibleInboundConnectorTypes  ConnectorType[]
  compatibleOutboundConnectorTypes ConnectorType[]
  canDelegateTo  String[]                         validated acyclic at sync-time
  defaultBudgetCents Int
  skills  Skill[] @relation("TemplateSkills")     M:N (the default skill set)
  instances  AgentInstance[]

AgentInstance                                     (per-org hired agent)
  orgId, templateSlug, displayName, mission
  enabledSkillIds  Json?                          null = use template default; [] = explicit empty
  budgetCents  Int
  status  AgentInstanceStatus                     ACTIVE | PAUSED
  @@unique([orgId, templateSlug])                 one instance per template per org

Skill                                             (system-defined; seeded from code)
  id @id                                          "extractSoul", "labelBrandAsset",
                                                  "generateBrandImage", "delegateToSpecialist"
  displayName, description
  parametersJsonSchema  Json                      Zod schema rendered via z.toJSONSchema
  requiresApprovalDefault  Boolean
  requiredConnectorTypes  ConnectorType[]
  templates  AgentTemplate[] @relation("TemplateSkills")
  agentActions  AgentAction[]

ConnectorInstance                                 (per-org channel/tool config)
  orgId, type (ConnectorType), displayName
  config  Json                                    per-type credentials/IDs
  capabilities  Json                              { inbound: boolean, outbound: boolean }
  senderRole  SenderRole                          OWNER | CUSTOMER
  bindings  AgentConnectorBinding[]
  conversations  Conversation[]
  @@index([orgId, type])

AgentConnectorBinding                             (M:N: which agents act on which channels)
  agentInstanceId, connectorInstanceId, direction (INBOUND | OUTBOUND | BOTH)
  @@unique([agentInstanceId, connectorInstanceId, direction])

AgentAction                                       (per tool-call, populated by runtime in Phase 5f)
  agentInstanceId, skillId
  triggerMessageId?, parentActionId?              null in v0 (not yet threaded; targeted for 5h+)
  proposedInput Json, proposedSummary
  status  AgentActionStatus                       DRAFTED | AUTO_APPROVED | APPROVED |
                                                  REJECTED | EDITED | EXPIRED | FAILED | EXECUTED
  decidedByUserId?, decidedAt?, executedAt?
  resultJson Json?, errorMessage?
  costCents, costCurrency, costInputTokens, costOutputTokens
  @@index([agentInstanceId, status, createdAt])
  @@index([triggerMessageId]), @@index([parentActionId])

──── Phase KR addition ────────────────────────────────────────────────

KnowledgeDoc                                      (org-scoped markdown/JSON/text docs)
  orgId, r2Key, title, summary, tags String[]
  contentType  KnowledgeDocContentType            MARKDOWN | PLAIN_TEXT | JSON
  size
  @@index([orgId, createdAt])
  @@index([orgId])
```

### Invariants enforced at template-sync (boot)

- `AgentTemplate.canDelegateTo` is acyclic across the full template set (`validateCanDelegateTo`).
- Every slug in `canDelegateTo` corresponds to an existing template.
- `syncSkills` runs BEFORE `syncTemplates` so the M:N skill connections find their rows.

### Invariants enforced at runtime

- `AgentInstance.enabledSkillIds` is `null` (use template defaults) or `string[]` (explicit list).
- `delegateToSpecialist` rejects when `targetTemplateSlug ∉ parentTemplate.canDelegateTo`.
- Auto-approval rule (formalized in spec §8, not implemented as a queue yet): `ownerSide || !skill.requiresApprovalDefault` → AUTO_APPROVED.

---

## 5. The agent loop

`agents/runtime.ts` → `runAgentInstance({...args}): Promise<AgentRunResult>`. Same function for every agent template; the template + enabled-skills determine behavior.

### Inputs

`AgentDispatchArgs` (defined in `agents/dispatcher.ts`):

```ts
{
  agentInstance,         // the AgentInstance to run (Controller, Designer, ...)
  prisma,
  dispatcher,            // self-reference so delegation can call enqueueAndAwait again
  input: { audioBytes?, audioMime?, imageBytes[], text? },
  currentContext,        // serialized businessProfile (from KnowledgeProvider)
  newAssets,             // [{ assetId, mimeType, deduped }] for the system prompt
  existingAssets,        // [{ assetId, mimeType, metadata }] for Q&A
  oversizeCount,         // count of >20 MB images skipped
}
```

### The 4 skills

All declared with `defineSkill<TInput, TOutput>(config)` — no `as unknown` casts anywhere.

| Skill ID               | Owner template                           | What it does                                                                                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `delegateToSpecialist` | Controller (and any future orchestrator) | Validates target template ∈ `canDelegateTo`. `ensureAgentInstance` for the child. `dispatcher.enqueueAndAwait({...parent args, agentInstance: child, input.text: subtask})`. Returns `{ ok: true, text, generatedAssetIds, usage }` or `{ ok: false, error }`. |
| `extractSoul`          | Designer                                 | Calls `applySoulUpdate(orgId, partial, prisma)` to patch-merge the 5 soul fields.                                                                                                                                                                              |
| `labelBrandAsset`      | Designer                                 | Updates `BrandAsset.metadata` with palette / styleDescriptors / typography for one assetId.                                                                                                                                                                    |
| `generateBrandImage`   | Designer                                 | Pipeline: `getBrandContext` → `enrichPromptWithBrand` → `generateBrandImageBytes` (gpt-image-1 via Gateway) → `ingestGeneratedAsset`. Returns `{ assetId, ok: true }` or `{ ok: false, error }`.                                                               |

### The 2 seeded templates

| Template slug | displayName | canDelegateTo  | defaultEnabledSkillIds                                     |
| ------------- | ----------- | -------------- | ---------------------------------------------------------- |
| `controller`  | Controller  | `["designer"]` | `["delegateToSpecialist"]`                                 |
| `designer`    | Designer    | `[]`           | `["extractSoul", "generateBrandImage", "labelBrandAsset"]` |

### The runtime sequence

1. `findTemplateBySlug(agentInstance.templateSlug)` — load the template; throws if unknown.
2. `resolveEnabledSkills(agentInstance.enabledSkillIds, template.defaultEnabledSkillIds)` — applies the null/[] rule.
3. Build `ctx: SkillContext = { agentInstanceId, dispatcher, orgId, parentRunArgs, prisma }`. Every skill receives this.
4. Wrap each skill in an AI SDK `tool({ description, inputSchema, execute })`.
5. `renderSystemPrompt(template.defaultSystemPrompt, { currentContext, newAssets, existingAssets, oversizeCount })` — substitute placeholders.
6. Append `\n\nMissão deste agente:\n<mission>` if `agentInstance.mission` is non-empty.
7. Call `generateText({ model: gateway("google/gemini-2.5-flash"), stopWhen: stepCountIs(5), system, messages, tools, temperature: 0.2 })`.
8. `aggregateSteps(result.steps, ALL_SKILLS.map(s => s.id))` returns `{ generatedAssetIds, toolCallSummary }`. The aggregator pulls assetIds from both `generateBrandImage` tool-results (direct) AND `delegateToSpecialist` tool-results (delegated chain).
9. Return `AgentRunResult = { text, generatedAssetIds, toolCallSummary, usage }`.

### Delegation flow

When the Controller calls `delegateToSpecialist({ targetTemplateSlug: "designer", subtask: "..." })`:

1. `findTemplateBySlug(parent.templateSlug)` — Controller, has `canDelegateTo: ["designer"]`.
2. Reject if `"designer" ∉ canDelegateTo`. Reject if target template not registered.
3. `ensureAgentInstance({ orgId, templateSlug: "designer", prisma })` — lazy-creates the Designer AgentInstance if it doesn't exist; derives `displayName` from the template registry.
4. `dispatcher.enqueueAndAwait({ ...parentRunArgs, agentInstance: designerInstance, input: { ...parentInput, text: subtask } })` — same dispatcher, same args shape, swapped agent + replaced text.
5. Designer runs its agent loop; may call `generateBrandImage` etc.
6. Designer's result returns up the chain. The delegation skill propagates `text + generatedAssetIds + usage`.
7. Controller's `step.content[]` shows the `delegateToSpecialist` tool-result; the aggregator spreads its `generatedAssetIds` into Controller's total.
8. Controller's LLM writes the final pt-BR reply based on the Designer's result.

---

## 6. The request lifecycle

Walking a real message: Pedro sends _"gera uma imagem promocional para minha promo de Black Friday"_ on Telegram.

```
[Telegram]
   │ POST /telegram/webhook + X-Telegram-Bot-Api-Secret-Token
   ▼
[routes/telegram/webhook.ts] → bot.webhooks.telegram(rawRequest)
   ▼
[telegram/bot.ts]
   Chat SDK validates secret-token, parses, dedups (5min TTL),
   invokes handleInboundMessage({ dispatcher, prisma }, thread, message)
   ▼
[inbox/pipeline.ts]
   try {
     1. markWebhookProcessed(prisma, externalId, payload) — early return if duplicate
     2. resolveOrgAndConversation(prisma, telegramChatId, externalId) → { orgId, conversationId }
     3. persistInboundMessage(prisma, conversationId, message, contentType)
     4. processIncomingAttachments(deps, orgId, thread, message)
          → for each image: download → 20 MB cap → ingestBrandAsset (SHA-256 dedup + R2 + row)
          → for audio: download bytes
          → returns { newAssets, imageBytes, audioBytes, hasAudio, oversizeCount, audioMime }
     5. if empty (no text + no audio + no new assets + no oversize) → post EMPTY_TEXT_REPLY
     6. runAgentForInbound(deps, orgId, attachments, message):
          a. getBusinessContext(orgId) → serialized businessProfile markdown
          b. prisma.brandAsset.findMany ({ orgId, take: 20 }) → existingAssets for prompt
          c. ensureAgentInstance({ orgId, templateSlug: "controller", prisma }) → Controller
          d. dispatcher.enqueueAndAwait({ agentInstance: Controller, ...args, dispatcher })
              │
              ▼ (via SerialDispatcher → runAgentInstance inline)
          [agents/runtime.runAgentInstance — Controller's turn]
            · template = Controller; skills = [delegateToSpecialist]
            · system prompt rendered with currentContext + existingAssets block + …
            · generateText → Controller LLM decides to call delegateToSpecialist
              with { targetTemplateSlug: "designer", subtask: "Gera um post de Black Friday…" }
              │
              ▼ (delegation skill executes)
          [agents/skills/delegate-to-specialist.execute]
            · validate "designer" ∈ Controller.canDelegateTo ✓
            · findTemplateBySlug("designer") ✓
            · ensureAgentInstance({ orgId, templateSlug: "designer", prisma })
                → upserts Designer AgentInstance (lazy-create on first delegation)
            · dispatcher.enqueueAndAwait({ ...parentRunArgs,
                                          agentInstance: Designer,
                                          input: { ...parentInput, text: subtask } })
              │
              ▼ (recursive into runAgentInstance with Designer)
          [agents/runtime.runAgentInstance — Designer's turn]
            · template = Designer; skills = [extractSoul, generateBrandImage, labelBrandAsset]
            · Designer LLM decides to call generateBrandImage({ prompt, aspectRatio })
              │
              ▼
          [agents/skills/generate-brand-image.execute]
            · getBrandContext(orgId, prisma) → { palette, styles, typography }
                (queries 3 most-recent uploaded BrandAssets,
                 skips meta.source === "generated", aggregates fields)
            · enrichPromptWithBrand(prompt, aspectRatio, brand) → "Banner …\n\nAspect ratio: 1:1.\n\nBrand palette: …"
            · generateBrandImageBytes({ prompt: enriched }) → POST AI Gateway → PNG bytes
            · ingestGeneratedAsset({ orgId, bytes, mimeType, prompt, prisma })
                → SHA-256 → R2 upload → BrandAsset row with metadata.source="generated"
            · return { assetId, ok: true }
              │
              ▼ (back up through runAgentInstance → aggregator)
          Designer's result.generatedAssetIds = [assetId]
          Designer's result.text = "Pronto! Gerei uma imagem para sua Black Friday…"
              │
              ▼
          [delegate-to-specialist skill returns to Controller]
              { ok: true, text: "Pronto!…", generatedAssetIds: [assetId], usage }
              │
              ▼ (Controller's step.content[] now has the delegation tool-result)
          [Controller's LLM step 2: writes final user-facing reply]
              "Pronto, Pedro! Gerei uma imagem para sua promo de Black Friday…"
              │
              ▼
          [aggregateSteps(Controller's steps)]
              · toolCallSummary.delegateToSpecialist = 1
              · generatedAssetIds spread from delegation tool-result = [assetId]
              │
          AgentRunResult = { text, generatedAssetIds: [assetId], toolCallSummary, usage }
       │
       ▼ (back in inbox/agent-step.postAgentResult)
     7. for each generatedAssetIds id:
          · prisma.brandAsset.findUnique({ id }) → { r2Key, mimeType }
          · fetchAsset(r2Key) → Uint8Array
          · thread.post({ files: [{ data: Buffer.from(bytes), filename, mimeType }],
                           markdown: isLast ? result.text : "" })
        if no generatedAssetIds: thread.post(result.text) (plain string)
     8. logger.info(...) structured success log with toolCallSummary, tokens, asset ids
   } catch (error) {
     logger.error(...) + thread.post(EXTRACT_FAILED_REPLY)
   }
```

### AgentInstance lazy-creation

Every inbound triggers `ensureAgentInstance("controller")`. The first delegation triggers `ensureAgentInstance("designer")`. After a single bot interaction, the org has both rows. Future inbound messages reuse them via `upsert + update: {}`.

### Error matrix (preserved through the decomposition)

| Failure                                           | Where                                            | Behaviour                                                         |
| ------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| Telegram secret mismatch                          | Chat SDK adapter                                 | 401 immediate; no DB write                                        |
| Duplicate webhook                                 | `inbox/ingest.markWebhookProcessed`              | early return + "duplicate" log                                    |
| Image download failure                            | `inbox/attachments.processImage`                 | logged, skipped, other attachments continue                       |
| >20 MB image                                      | Same                                             | `oversizeCount` increments, system prompt mentions it             |
| Audio download failure                            | `inbox/attachments`                              | logged, posts DOWNLOAD_FAILED_REPLY                               |
| Empty inbound (no text/audio/assets)              | `inbox/pipeline`                                 | posts EMPTY_TEXT_REPLY                                            |
| Unknown template                                  | `findTemplateBySlug` (runtime/delegation/ensure) | throws — startup `syncTemplates` should have caught the misconfig |
| Delegation rejected (target not in canDelegateTo) | `delegateToSpecialist.execute`                   | returns `{ ok: false, error }`; model sees it, can apologize      |
| Cycle attempt at boot                             | `validateCanDelegateTo` in `syncTemplates`       | server refuses to start                                           |
| Image gen Gateway 5xx                             | `generateBrandImage.execute`                     | caught, returns `{ ok: false, error }`, logged                    |
| Agent runtime throws                              | `inbox/agent-step` via pipeline catch            | post EXTRACT_FAILED_REPLY, log `handler.failed`                   |
| Generated-image post to Telegram fails            | `inbox/agent-step.postAgentResult`               | logged; if it was the last image, fall back to posting text       |

---

## 7. External services (env-var map)

| Env var                                                                                              | Used by                                                                    | What it does                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                       | Prisma                                                                     | Postgres connection. Local: docker-compose on `localhost:5436`. Prod: Railway.                                |
| `REDIS_URL`                                                                                          | Chat SDK                                                                   | Conversation state + update-dedup. Local: docker-compose on `localhost:6382`.                                 |
| `TELEGRAM_BOT_TOKEN`                                                                                 | `@chat-adapter/telegram`                                                   | Bot auth (inbound verify + outbound `sendMessage`/`sendDocument`).                                            |
| `TELEGRAM_BOT_USERNAME`                                                                              | Same                                                                       | Mention detection.                                                                                            |
| `TELEGRAM_WEBHOOK_SECRET_TOKEN`                                                                      | Same                                                                       | Validates `X-Telegram-Bot-Api-Secret-Token` on every inbound.                                                 |
| `AI_GATEWAY_API_KEY`                                                                                 | `agents/runtime` (via AI SDK `gateway()`) + `lib/image-gen` (direct fetch) | **Single AI key.** Routes both the agent loop (Gemini) and image gen (gpt-image-1) through Vercel AI Gateway. |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_REGION` | `lib/storage.ts`                                                           | Cloudflare R2 (S3-compatible) — brand assets.                                                                 |

Local dev infra runs entirely on docker-compose: Postgres 18 on `:5436`, Redis 7 on `:6382`.

---

## 8. The seams (and why they matter)

Each seam isolates a layer so its implementation can change without touching callers. Single-writer / single-reader audit (run anytime):

```bash
grep -rn "businessProfile" apps/api/src       # ⇒ only knowledge/apply.ts (writer) + knowledge/provider.ts (reader)
grep -rn "brandAsset.create" apps/api/src     # ⇒ only knowledge/brand-asset.ts (both ingest functions)
grep -rn "brandAsset.update" apps/api/src     # ⇒ only agents/skills/label-brand-asset.ts
grep -rn "agentInstance.upsert" apps/api/src  # ⇒ only agents/agent-instance.ts (ensureAgentInstance)
grep -rn "as Skill<" apps/api/src             # ⇒ NOTHING — defineSkill killed the cast
```

| Seam                                        | Lives at                                                     | What it hides                                           | What it enables                                                                            |
| ------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `getBusinessContext`                        | `knowledge/provider.ts`                                      | The shape of `Organization.businessProfile`             | v1 swap to a wiki-markdown reader; the upcoming Knowledge Registry redesign (Pedro's idea) |
| `applySoulUpdate`                           | `knowledge/apply.ts`                                         | Patch-merge transaction logic                           | Same — single writer; future audit log can land here                                       |
| `ingestBrandAsset` + `ingestGeneratedAsset` | `knowledge/brand-asset.ts`                                   | SHA-256 dedup + R2 upload + Prisma row                  | Future: virus scanning, thumbnails, watermarking                                           |
| `getBrandContext` + `enrichPromptWithBrand` | `knowledge/brand-context.ts`                                 | BrandAsset metadata aggregation + prompt composition    | Future Marketing skills reuse the same brand pickup                                        |
| `ensureAgentInstance`                       | `agents/agent-instance.ts`                                   | The AgentInstance upsert shape                          | Future invariants (cost gates, audit) land in one place                                    |
| `runAgentInstance`                          | `agents/runtime.ts`                                          | The generateText loop + ctx assembly + step aggregation | Swap LLM provider; swap to streaming                                                       |
| `aggregateSteps`                            | `agents/step-aggregator.ts`                                  | AI SDK v6's `step.content[]` walking                    | If the provider changes its result shape, only this file edits                             |
| `renderSystemPrompt`                        | `agents/templates/renderer.ts`                               | Placeholder substitution                                | Future templates can use different placeholders without runtime changes                    |
| `createSerialDispatcher`                    | `agents/dispatcher.ts`                                       | The runner invocation                                   | Phase 5g swaps for `BullMQDispatcher` — `main-dispatcher.ts` becomes the policy file       |
| `defineSkill<T>`                            | `agents/skills/types.ts`                                     | The Skill shape constraints                             | New skills are type-safe by construction; `Skill<any, any>` is the contained super-type    |
| `findTemplateBySlug` / `findSkillById`      | `agents/templates/registry.ts` + `agents/skills/registry.ts` | The in-code registries                                  | The DB tables (`AgentTemplate`, `Skill`) are seeded from these; the registry is canonical  |
| `validateCanDelegateTo`                     | `agents/templates/registry.ts`                               | Acyclic + reference-integrity check                     | Boots refuse to start with a broken graph                                                  |
| `inbox/*` modules                           | One per pipeline stage                                       | Stage-specific I/O and persistence                      | New connectors (Phase 5h's WhatsApp) reuse the same inbox stages                           |

---

## 9. Phase history

| Phase                       | What it shipped                                                                                                                                                                                                                                                                                                                                                                                                  | Why discrete                                                                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0**                       | Pruned a generic `acme` Turborepo template down to Telegram-only API; renamed everything to `qolmeia`.                                                                                                                                                                                                                                                                                                           | One commit, mechanical.                                                                                                                                                                   |
| **1**                       | Foundation: Telegram webhook (Chat SDK), Prisma schema with the core models, `KnowledgeProvider` seam, fixed pt-BR ack reply.                                                                                                                                                                                                                                                                                    | Proves the pipe before any AI.                                                                                                                                                            |
| **2**                       | Audio → soul via `generateObject({ schema: {partial, reply} })`. Single AI key.                                                                                                                                                                                                                                                                                                                                  | Adds the AI seam, constrained.                                                                                                                                                            |
| **2 fix**                   | `toJsonSafe` to strip `fetchData` AsyncFunction before Prisma JSON serialization.                                                                                                                                                                                                                                                                                                                                | Live discovery.                                                                                                                                                                           |
| **2.5**                     | Conversational replies (LLM writes every reply); 5 sharpened soul fields.                                                                                                                                                                                                                                                                                                                                        | Templates felt limiting.                                                                                                                                                                  |
| **3**                       | R2 brand assets + tool calling. `generateObject` → `generateText({tools, stopWhen})`. Two tools: `extractSoul`, `labelBrandAsset`. `BrandAsset` model + `ingestBrandAsset` SHA-256 dedup.                                                                                                                                                                                                                        | Two tools made the tool-calling abstraction worthwhile.                                                                                                                                   |
| **4**                       | Third tool `generateBrandImage` via `openai/gpt-image-1` (Gateway). Handler posts via `thread.post({ files, markdown })`.                                                                                                                                                                                                                                                                                        | Closes the voice → soul → image loop.                                                                                                                                                     |
| **4 fix 1**                 | gpt-image-1 picked over gemini-2.5-flash-image (Vercel free-tier restriction).                                                                                                                                                                                                                                                                                                                                   | Environmental.                                                                                                                                                                            |
| **4 fix 2**                 | AI SDK v6 step aggregation via `step.content[]` (top-level toolCalls only show last step).                                                                                                                                                                                                                                                                                                                       | Found via debug logging.                                                                                                                                                                  |
| **5a**                      | Six new Prisma models (`AgentTemplate`, `AgentInstance`, `Skill`, `ConnectorInstance`, `AgentConnectorBinding`, `AgentAction`), all enums. Additive `Conversation.connectorInstanceId`. No code reads them yet.                                                                                                                                                                                                  | Schema atomic, then code can move.                                                                                                                                                        |
| **5b**                      | Skills extraction: 3 inline tools moved out of `lib/ai.ts` into `agents/skills/*.ts`. `soul/` renamed to `knowledge/`. `lib/ai.ts` deleted.                                                                                                                                                                                                                                                                      | Skill registry becomes the data structure to pivot on.                                                                                                                                    |
| **5c**                      | Generic runtime (`agents/runtime.runAgentInstance`), Designer template, dispatcher seam (`SerialDispatcher` factory), `syncTemplates` + `syncSkills` at boot, handler lazy-creates AgentInstance.                                                                                                                                                                                                                | One agent, one template — proves the abstraction without a delegation chain.                                                                                                              |
| **5d**                      | Controller template + `delegateToSpecialist` skill. Dispatcher singleton. `SkillContext` widened with `agentInstanceId, dispatcher, parentRunArgs`. `validateCanDelegateTo` acyclic check. Handler routes to Controller, which delegates to Designer.                                                                                                                                                            | Two agents, one delegation, full chain verified live.                                                                                                                                     |
| **Refactor pass**           | Five deepening refactors landed via the `improve-codebase-architecture` skill: handler decomposition into `inbox/` (Refactor #1), `defineSkill<T>` factory + zero unknown casts (#2), `runtime.ts` split into renderer + step-aggregator (#3), brand-context extracted from generateBrandImage skill (#4), `ensureAgentInstance` centralized (#5). +25 tests, no behavior change.                                | Pure structural debt cleanup.                                                                                                                                                             |
| **KR · Knowledge Registry** | New `KnowledgeDoc` Prisma model + `knowledge/knowledge-doc.ts` single-writer seam + `searchKnowledge` and `readKnowledgeDoc` skills wired into the Designer's default skill set. Seed script + 3 sample docs (policy / brand voice / service menu).                                                                                                                                                              | Adds a parallel knowledge surface for unstructured docs — RAG retrieval — without disturbing the structured `businessProfile` + `BrandAsset` data.                                        |
| **5e**                      | Marketing Strategist template (`canDelegateTo: ["designer"]`) + `draftMarketingStrategy` stub skill. Controller's `canDelegateTo` extends to `["designer", "marketing-strategist"]`. The 3-level delegation DAG (Controller → MarketingStrategist → Designer) is now exercisable.                                                                                                                                | The existing seams (validateCanDelegateTo, delegate-to-specialist, step-aggregator) handled the new shape without code changes.                                                           |
| **5f**                      | `agents/actions.ts` + `agents/cost.ts`. Runtime persists one `AgentAction` row per tool call (all AUTO_APPROVED in v0 — no CUSTOMER connectors yet). Per-action cost calculated from token usage + per-image fee. Soft-warn `agentInstance.budget.threshold` / `.exceeded` log lines at 80% / 100% of `budgetCents`.                                                                                             | The `AgentAction` schema was already in place since 5a; this phase started writing to it.                                                                                                 |
| **5g**                      | `agents/bullmq-dispatcher.ts` + `workers/{agent-runner,index}.ts`. `main-dispatcher.ts` selects Serial or BullMQ via `env.DISPATCH_MODE` (default `serial`). Worker concurrency 4. Webhook returns 200 immediately when queue mode is on; delegation enqueues child jobs through the same queue.                                                                                                                 | The dispatcher seam from 5c made the swap a single-file policy change. The `prisma` and `dispatcher` references can't be serialized — the worker re-attaches them from module singletons. |
| **5h**                      | `POST /connectors/telegram/:connectorInstanceId/webhook` route (legacy `/telegram/webhook` still mounted). `inbox/ingest.resolveOrgAndConversation` prefers ConnectorInstance lookup with TelegramLink fallback; new orgs dual-write both. Migration script `migrate-telegram-link-to-connector.ts` backfilled Pedro's existing TelegramLink row into a ConnectorInstance (`type=TELEGRAM`, `senderRole=OWNER`). | The Phase 5a schema had ConnectorInstance ready since day one. This phase activates it without dropping the legacy table.                                                                 |

---

## 10. Roadmap

| Next                                                | Adds                                                                                                                                                                                                                                                                 | Where the seam already supports it                                                                                                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v0 web UI**                                       | Owner dashboard, approval queue UI (`AgentAction` filtered by status=DRAFTED), onboarding wizard, KnowledgeDoc upload form, EQUIPE per-agent detail, settings. Better Auth for accounts.                                                                             | Frontend slice; all data is already in the schema. The approval-queue UI just needs to render rows and offer approve/edit/reject — the action lifecycle skeleton is in `agents/actions.ts`.                            |
| **Customer-facing connectors**                      | Real WhatsApp/Fresha/Google My Business adapters with `senderRole = CUSTOMER`. At that point the v0 approval rule (`status = AUTO_APPROVED` always) gets the second branch: `ownerSide ? AUTO_APPROVED : (skill.requiresApprovalDefault ? DRAFTED : AUTO_APPROVED)`. | `ConnectorInstance` model carries `senderRole`. `inbox/ingest` already threads `connectorInstanceId` (currently unused downstream — marked TODO). `agents/actions.resolveActionStatus` has the single-point-of-change. |
| **TelegramLink cleanup**                            | Delete the legacy `TelegramLink` table after a deprecation period. Migration script for any orgs still on it.                                                                                                                                                        | Phase 5h already migrated Pedro's row to `ConnectorInstance`. The ingest path prefers ConnectorInstance with TelegramLink fallback; once all orgs are migrated, the fallback + table can be removed in one commit.     |
| **Embeddings for `searchKnowledge`**                | Replace the Prisma `contains` keyword search with pgvector embeddings for semantic retrieval.                                                                                                                                                                        | The skill's shape (`{ query, limit } → { matches }`) is stable; only the inside changes. Add a vector column to `KnowledgeDoc`, populate on `createKnowledgeDoc`, do similarity search in the skill.                   |
| **`triggerMessageId` + `parentActionId` threading** | Wire the inbound `Message.id` through `AgentDispatchArgs` into the runtime so each `AgentAction` row links to its triggering message; track delegation chains via `parentActionId`.                                                                                  | Both fields are already in the schema. Adding them requires threading 2 more strings through `AgentDispatchArgs` + the runtime's `recordAgentAction` call — small, mechanical.                                         |

---

## 11. Log line decoder

`telegram message handled` is the success line in `inbox/agent-step.ts`:

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

Note: when the Controller delegates to Designer, the Controller's `toolCallSummary` shows `delegateToSpecialist: 1` but its `generateBrandImage` count is 0 — because the actual image-gen happened in the Designer's run. The `generatedAssetIds` array gets populated via the aggregator's spread from the delegation tool-result's `output.generatedAssetIds`.

Failure lines: `audio.download_failed`, `image.download_failed`, `image.ingest_failed`, `delegateToSpecialist.unauthorized`, `delegateToSpecialist.unknown_template`, `delegateToSpecialist.failed`, `generateBrandImage.failed`, `generated_image.post_failed`, `handler.failed`, `handler.reply_failed`.

---

## 12. Where the spec/plan history lives

Every phase has a design spec and an implementation plan under:

```
docs/superpowers/specs/  ← what to build (decisions, schema, prompts, error modes)
docs/superpowers/plans/  ← how to build it (per-task with full code + commit checklists)
```

Filenames: `YYYY-MM-DD-<phase>-<topic>-{design,implementation}.md`. The multi-agent overall spec is at `docs/superpowers/specs/2026-05-20-qolmeia-multi-agent-architecture-design.md`.

---

## 13. Testing & quality bar

- **140 tests** (136 api + 4 db) at HEAD `8371163` (was 92 before the refactor pass and Phases KR/5e/5f/5g/5h; +48 net through all the deepening + feature work in this push).
- Mocked at seams (AI SDK, R2 SDK, Prisma); no live calls in CI.
- Integration tests in `packages/db/src/__tests__/` against the local docker Postgres.
- Lint: oxlint (NOT ESLint). 0 warnings, 0 errors.
- Format: oxfmt (NOT Prettier).
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
cloudflared tunnel --url http://localhost:4000

set -a; source apps/api/.env; set +a
TUNNEL="https://<paste-from-cloudflared>"
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${TUNNEL}/telegram/webhook" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET_TOKEN}"

# Message @qolmeia_mvp_v0_bot on Telegram.
```

`syncSkills` + `syncTemplates` run at boot — first message triggers the lazy-create chain (`AgentInstance` for Controller via handler; for Designer via the delegation skill on first delegation).

---

## 15. One-line summary for the next engineer

> "Telegram webhook → Chat SDK adapter → `inbox/pipeline.ts` (5 stages) → `dispatcher.enqueueAndAwait` (Serial inline OR BullMQ queue per `DISPATCH_MODE`) → `runtime.runAgentInstance(Controller)` → Controller delegates to Designer OR MarketingStrategist via `delegateToSpecialist` → specialist may further delegate to Designer for visuals OR call `searchKnowledge`/`readKnowledgeDoc` for richer context → Designer's domain skills (extractSoul / labelBrandAsset / generateBrandImage) execute → every tool call persists as an `AgentAction` row with cost in BRL cents → results bubble up through step-aggregator → Controller writes final pt-BR reply → handler posts text + any generated images back to Telegram. 140 tests; never silent-fails; single AI key; Prisma+Postgres for data, R2 for binaries (including KnowledgeDocs), Redis for Chat SDK state and BullMQ jobs."
