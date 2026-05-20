# Qolmeia Multi-Agent Architecture — Design Spec

**Date:** 2026-05-20
**Status:** Draft (awaiting review)
**Author:** Pedro + Claude (brainstorm session)
**Builds on:** Phase 4 (HEAD `876d583`) — the working Telegram bot with `runAgent` + 3 hard-coded tools.

---

## 1. Goal

Re-architect Qolmeia's backend so the current single-purpose Telegram bot becomes one of many agents an organization can hire, with **strict separation between Agents (personas) and Connectors (channels/tools)**, an **orchestration-by-delegation** model (Controller → Marketing Strategist → Designer), and an **AgentAction approval-queue** that powers the wireframe's "Modo Co-piloto" UX.

The bot keeps working end-to-end throughout the migration.

## 2. Scope

**In scope (one spec, decomposed into 9 implementation phases):**

- Prisma schema additions for AgentTemplate, AgentInstance, Skill, ConnectorInstance, AgentConnectorBinding, AgentAction.
- Three seeded `AgentTemplate`s: `controller`, `marketing-strategist`, `designer`.
- All existing Telegram-bot skills (`extractSoul`, `labelBrandAsset`, `generateBrandImage`) move into the new skill registry under the `designer` template.
- New built-in skill `delegateToSpecialist` powering the orchestration DAG.
- Stub skill `draftMarketingStrategy` proving the abstraction holds with a second specialist.
- Per-org `ConnectorInstance`s replacing the single `TelegramLink` table.
- `AgentAction` lifecycle (draft → approved/rejected/edited/auto/executed/failed/expired) with per-skill + per-connector approval rules.
- BullMQ-based async dispatcher (Redis already provisioned) with parent-child job flows for delegation.
- Cost tracking per AgentAction with monthly soft-warn at 80%/100% of `AgentInstance.budgetCents`.
- Webhook routes namespaced per ConnectorInstance: `POST /connectors/<type>/:connectorInstanceId/webhook`.
- Bot stays live through all 9 migration phases (no downtime, no behavior regression for Pedro's current chat).

**Out of scope (separate future specs):**

- Web UI (auth, onboarding wizard, approval queue UI, EQUIPE page, settings, billing, LGPD, ops dashboard). All of that lives behind the wireframe in `CleanShot 2026-05-20 at 12.24.16` and gets its own design pass.
- Real WhatsApp / Fresha / Google My Business connector implementations. Their adapter files are scaffolded as stubs (typed interfaces + `throw new NotImplemented`) so the abstraction is exercised but no third-party SDK is integrated yet.
- Customer-facing channels beyond the stub. Senders are still OWNER-only in v0 (Pedro's own Telegram chat).
- Per-AgentInstance memory beyond the current `Organization.businessProfile` + `AgentInstance.mission`. Phase-2-style transcript memory is deferred to its own spec.
- Hard budget enforcement (only soft-warn in this spec).
- Multi-org production deployment (the seed handles Pedro's single org; the schema is multi-tenant-correct so adding more orgs is a row insert, not a migration).

## 3. Locked decisions

| #   | Decision                                                                                                                                                                                                                   | Locked as            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | Scope: full backend slice, three agents seeded (Controller, Marketing Strategist, Designer), no web UI.                                                                                                                    | Section 2            |
| 2   | `AgentTemplate` + `AgentInstance` two-tier model.                                                                                                                                                                          | Section 4            |
| 3   | All connectors per-org. Current platform Telegram bot becomes Pedro's org's `ConnectorInstance(TELEGRAM)`.                                                                                                                 | Section 4            |
| 4   | One `ConnectorInstance` model with `capabilities: { inbound, outbound }` flags — no separate Channel/Tool models.                                                                                                          | Section 4            |
| 5   | Skills are DB-first (`Skill` table is canonical truth for "what skills exist"); execute functions live in code; DB schema seeded from code Zod via `syncSkills`.                                                           | Section 4            |
| 6   | Knowledge: org-wide `businessProfile` (existing) + per-instance `mission` field. KnowledgeProvider scoped by `agentInstanceId`.                                                                                            | Section 4, Section 6 |
| 7   | Inbound routing: 1:N fan-out modelled (multi-binding) but v0 convention is Controller-only inbound.                                                                                                                        | Section 4, Section 7 |
| 8   | Approval rule: `Skill.requiresApprovalDefault` (per-skill) × `ConnectorInstance.senderRole` (OWNER → auto, CUSTOMER → respect skill default).                                                                              | Section 7            |
| 9   | Budget: track cost per `AgentAction`, soft-warn at 80%/100% of `AgentInstance.budgetCents`. No hard stop.                                                                                                                  | Section 4, Section 7 |
| 10  | Compatible connectors are declared per-`AgentTemplate` as **lists** (`compatibleInboundConnectorTypes`, `compatibleOutboundConnectorTypes`); per-instance binding picks specific ConnectorInstances.                       | Section 4            |
| 11  | Three templates form a delegation DAG: `controller.canDelegateTo = [marketing-strategist, designer]`; `marketing-strategist.canDelegateTo = [designer]`; `designer.canDelegateTo = []`. Cycle check at template-sync time. | Section 4, Section 5 |
| 12  | Execution: async via BullMQ on existing Redis, FlowProducer for delegation. `SerialDispatcher` is the test substitute. Factory chooses based on `DISPATCH_MODE` env.                                                       | Section 5, Section 7 |

## 4. Data model

```prisma
model Organization {
  id                  String              @id @default(cuid())
  name                String
  slug                String              @unique
  timezone            String              @default("America/Sao_Paulo")
  currency            String              @default("BRL")
  businessProfile     Json?
  customers           Customer[]
  conversations       Conversation[]
  brandAssets         BrandAsset[]
  agentInstances      AgentInstance[]
  connectorInstances  ConnectorInstance[]
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  // telegramLink RELATION REMOVED in Phase 5h — replaced by ConnectorInstance
}

model AgentTemplate {
  slug                              String              @id
  displayName                       String
  description                       String
  defaultSystemPrompt               String              @db.Text
  defaultMission                    String              @db.Text
  compatibleInboundConnectorTypes   ConnectorType[]
  compatibleOutboundConnectorTypes  ConnectorType[]
  canDelegateTo                     String[]
  defaultBudgetCents                Int                 @default(0)
  skills                            Skill[]             @relation("TemplateSkills")
  instances                         AgentInstance[]
  createdAt                         DateTime            @default(now())
  updatedAt                         DateTime            @updatedAt
}

enum AgentInstanceStatus { ACTIVE PAUSED }

model AgentInstance {
  id                  String                  @id @default(cuid())
  orgId               String
  templateSlug        String
  displayName         String
  mission             String                  @db.Text
  enabledSkillIds     String[]
  budgetCents         Int                     @default(0)
  status              AgentInstanceStatus     @default(ACTIVE)
  org                 Organization            @relation(fields: [orgId], references: [id], onDelete: Cascade)
  template            AgentTemplate           @relation(fields: [templateSlug], references: [slug])
  bindings            AgentConnectorBinding[]
  actions             AgentAction[]
  createdAt           DateTime                @default(now())
  updatedAt           DateTime                @updatedAt
  @@unique([orgId, templateSlug])
  @@index([orgId])
}

model Skill {
  id                       String          @id
  displayName              String
  description              String          @db.Text
  parametersJsonSchema     Json
  requiresApprovalDefault  Boolean         @default(false)
  requiredConnectorTypes   ConnectorType[]
  templates                AgentTemplate[] @relation("TemplateSkills")
  agentActions             AgentAction[]
  createdAt                DateTime        @default(now())
  updatedAt                DateTime        @updatedAt
}

enum ConnectorType {
  TELEGRAM
  WHATSAPP
  FRESHA
  GOOGLE_MY_BUSINESS
  INSTAGRAM
}

enum SenderRole { OWNER CUSTOMER }

model ConnectorInstance {
  id            String                  @id @default(cuid())
  orgId         String
  type          ConnectorType
  displayName   String
  config        Json
  capabilities  Json
  senderRole    SenderRole
  org           Organization            @relation(fields: [orgId], references: [id], onDelete: Cascade)
  bindings      AgentConnectorBinding[]
  conversations Conversation[]
  createdAt     DateTime                @default(now())
  updatedAt     DateTime                @updatedAt
  @@index([orgId, type])
}

enum BindingDirection { INBOUND OUTBOUND BOTH }

model AgentConnectorBinding {
  id                   String              @id @default(cuid())
  agentInstanceId      String
  connectorInstanceId  String
  direction            BindingDirection
  agentInstance        AgentInstance       @relation(fields: [agentInstanceId], references: [id], onDelete: Cascade)
  connectorInstance    ConnectorInstance   @relation(fields: [connectorInstanceId], references: [id], onDelete: Cascade)
  createdAt            DateTime            @default(now())
  @@unique([agentInstanceId, connectorInstanceId, direction])
  @@index([connectorInstanceId, direction])
}

enum AgentActionStatus {
  DRAFTED          // awaiting human decision
  AUTO_APPROVED    // approval rule said auto; will execute
  APPROVED         // human approved; will execute
  REJECTED         // human rejected; will not execute
  EDITED           // human modified input; will execute with new input
  EXPIRED          // sat in queue past TTL (future)
  FAILED           // execution threw
  EXECUTED         // ran successfully
}

model AgentAction {
  id                String              @id @default(cuid())
  agentInstanceId   String
  skillId           String
  triggerMessageId  String?
  parentActionId    String?
  proposedInput     Json
  proposedSummary   String              @db.Text
  status            AgentActionStatus   @default(DRAFTED)
  decidedByUserId   String?
  decidedAt         DateTime?
  executedAt        DateTime?
  resultJson        Json?
  errorMessage      String?
  costCents         Int                 @default(0)
  costCurrency      String              @default("BRL")
  costInputTokens   Int                 @default(0)
  costOutputTokens  Int                 @default(0)
  agentInstance     AgentInstance       @relation(fields: [agentInstanceId], references: [id], onDelete: Cascade)
  skill             Skill               @relation(fields: [skillId], references: [id])
  parent            AgentAction?        @relation("ChildActions", fields: [parentActionId], references: [id])
  children          AgentAction[]       @relation("ChildActions")
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt
  @@index([agentInstanceId, status, createdAt])
  @@index([triggerMessageId])
  @@index([parentActionId])
}

// Conversation gets a new optional FK to ConnectorInstance
model Conversation {
  // ... existing fields
  connectorInstanceId String?
  connectorInstance   ConnectorInstance? @relation(fields: [connectorInstanceId], references: [id])
  @@index([connectorInstanceId])
}
```

**Deleted in Phase 5i:** `TelegramLink` model (its data lives in `ConnectorInstance` rows after Phase 5h migration).

**Invariants enforced at template-sync (startup):**

- `AgentTemplate.canDelegateTo` is acyclic across the full template set.
- Every slug in `canDelegateTo` corresponds to an existing template.
- For every Skill assigned to a Template, `Skill.requiredConnectorTypes ⊆ Template.compatibleOutboundConnectorTypes`.

**Invariants enforced at runtime:**

- A `ConnectorInstance` with `capabilities.inbound = false` can't have an `AgentConnectorBinding` with direction `INBOUND` or `BOTH` (DB check + runtime guard).
- `Skill.execute` is called only when the agent's bound ConnectorInstances cover `Skill.requiredConnectorTypes`.
- Auto-approval rule (applied when persisting an AgentAction draft):
  ```
  ownerSide = ConnectorInstance.senderRole === "OWNER"
                where ConnectorInstance = the conversation's connector
  status   = (ownerSide || !skill.requiresApprovalDefault) ? AUTO_APPROVED : DRAFTED
  ```

## 5. Code organization

```
apps/api/src/
├── index.ts
├── lib/
│   ├── env.ts
│   ├── logger.ts
│   ├── storage.ts                          # R2
│   └── image-gen.ts                        # gpt-image-1 wrapper
├── middleware/
├── routes/
│   ├── healthz.ts
│   └── connectors/
│       ├── telegram.ts                     # POST /connectors/telegram/:connectorInstanceId/webhook
│       └── whatsapp.ts                     # stub
├── inbox/
│   └── pipeline.ts                         # WebhookEvent dedup, Conversation+Message, dispatch
├── connectors/
│   ├── types.ts                            # ConnectorAdapter interface
│   ├── registry.ts                         # type → adapter map
│   ├── telegram/{adapter,config-schema}.ts
│   ├── whatsapp/{adapter,config-schema}.ts # stub
│   └── fresha/{adapter,config-schema}.ts   # stub
├── knowledge/                              # renamed from soul/
│   ├── provider.ts                         # getContext({orgId, agentInstanceId})
│   ├── soul.ts                             # SoulProfile type
│   ├── apply.ts                            # only writer of businessProfile
│   └── brand-asset.ts                      # only caller of brandAsset.create
├── agents/
│   ├── runtime.ts                          # runAgentInstance() — generateText loop
│   ├── dispatcher.ts                       # interface + SerialDispatcher + BullMQDispatcher + factory
│   ├── delegation.ts                       # delegateToSpecialist skill
│   ├── actions.ts                          # AgentAction CRUD + approval rule
│   ├── cost.ts                             # cost rollup + soft-warn
│   ├── templates/
│   │   ├── registry.ts                     # syncTemplates(prisma) + cycle check
│   │   ├── controller.ts
│   │   ├── marketing-strategist.ts
│   │   └── designer.ts
│   └── skills/
│       ├── registry.ts                     # syncSkills(prisma) + Zod→JSON Schema
│       ├── extract-soul.ts
│       ├── label-brand-asset.ts
│       ├── generate-brand-image.ts
│       ├── delegate-to-specialist.ts
│       └── draft-marketing-strategy.ts     # stub
└── workers/
    ├── index.ts                            # boots all BullMQ workers
    └── agent-runner.ts                     # consumes "agent-run" + child queues
```

## 6. Module responsibilities

| Module                      | Responsibility                                                                                                                 | Allowed dependencies                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `routes/connectors/*`       | HTTP entry per connector type; resolves ConnectorInstance from path param; hands off                                           | `connectors/<type>/adapter`, `inbox/pipeline`                                                            |
| `inbox/pipeline`            | Dedup, identity resolution, Conversation+Message upsert, dispatch entry                                                        | `prisma`, `agents/dispatcher`, `connectors/registry`                                                     |
| `connectors/<type>/adapter` | `parseInboundPayload`, `sendOutbound` for one type                                                                             | only that type's SDK/HTTP                                                                                |
| `agents/runtime`            | Run one `AgentInstance` to completion (generateText with tools loop, persist AgentActions)                                     | `agents/skills/registry`, `agents/templates/registry`, `agents/actions`, `knowledge/provider`, AI SDK    |
| `agents/dispatcher`         | `enqueueAndAwait(args)` interface; Serial + BullMQ implementations                                                             | BullMQ (when queue mode), `agents/runtime` (when serial mode)                                            |
| `agents/delegation`         | `delegateToSpecialist` skill execute                                                                                           | `agents/dispatcher`, `agents/templates/registry` (for canDelegateTo)                                     |
| `agents/actions`            | AgentAction lifecycle: `draftAction`, `approveAction`, `rejectAction`, `editAction`, `executeAction`                           | `prisma`, `agents/skills/registry`                                                                       |
| `agents/cost`               | Rollup AgentAction.costCents → soft-warn at thresholds                                                                         | `prisma`, `lib/logger`                                                                                   |
| `agents/templates/*`        | Static template definitions                                                                                                    | skill IDs (strings), connector types (enum)                                                              |
| `agents/skills/*`           | Single-file skill definition: `{ id, inputSchema (Zod), requiresApprovalDefault, requiredConnectorTypes, execute(args, ctx) }` | `prisma`, `lib/*`, `knowledge/*`, `connectors/registry`, `agents/dispatcher` (for delegation skill only) |
| `knowledge/*`               | Single-writer/single-reader for businessProfile + BrandAssets                                                                  | `prisma`, `lib/storage`                                                                                  |
| `workers/agent-runner`      | BullMQ Worker process consuming "agent-run" queue                                                                              | `agents/runtime`, BullMQ                                                                                 |

**Dependency direction (acyclic):**

```
routes → inbox → agents/dispatcher
                                  ↘
workers → agents/runtime → agents/skills → connectors + knowledge + lib
                       ↘ agents/templates ↗
                       ↘ agents/actions → prisma
```

## 7. Request lifecycle

Walking through a real inbound message — Pedro sends _"Gera um post de Black Friday para a Marina"_ on Telegram. Chain: Controller → Marketing Strategist → Designer.

**Inbound (synchronous portion):**

1. `POST /connectors/telegram/<connectorInstanceId>/webhook` arrives with `X-Telegram-Bot-Api-Secret-Token`.
2. `routes/connectors/telegram.ts` looks up the ConnectorInstance, validates the secret from `config`, calls `connectors/telegram/adapter.parseInboundPayload(raw, ci)` → `NormalizedMessage`.
3. `inbox/pipeline.handleInbound(connectorInstance, normalizedMsg)`:
   1. `WebhookEvent` dedup on `(provider, externalId)`.
   2. Identity: `ConnectorInstance.senderRole === "OWNER"` → no customer lookup.
   3. Upsert `Conversation { orgId, connectorInstanceId }`.
   4. Persist `Message`.
   5. Find `AgentConnectorBindings` where `connectorInstanceId = X` and `direction ∈ (INBOUND, BOTH)` → `[Controller binding]`.
   6. For each match, `agents/dispatcher.enqueue({ agentInstanceId, triggerMessageId, parentActionId: null })` — returns immediately.
4. `routes/connectors/telegram.ts` responds 200. Telegram is done.

**Async portion (in the BullMQ worker):**

5. `workers/agent-runner` consumes the job → `agents/runtime.runAgentInstance(Controller, triggerMessage)`.
6. `runAgentInstance`:
   1. Load template + enabled skills (instance overrides win; else template defaults).
   2. `knowledge/provider.getContext({orgId, agentInstanceId})` → `businessProfile + mission` string.
   3. `generateText({ model: gateway("google/gemini-2.5-flash"), stopWhen: stepCountIs(8), system, messages, tools, temperature: 0.2 })`.
   4. Walk `result.steps[*].content[]` (same pattern as today) → for each tool-call, persist an `AgentAction` row via `agents/actions.draftAction`. Status assigned by approval rule.
   5. For each AUTO_APPROVED action: call `agents/actions.executeAction(action)` which invokes `skill.execute(input, ctx)` and writes the result back.
7. The Controller model calls `delegateToSpecialist({templateSlug: "marketing-strategist", subtask: "..."})`.
8. The delegation skill's execute:
   1. Validate `"marketing-strategist" ∈ controller.canDelegateTo`.
   2. Resolve `AgentInstance` for `(orgId, templateSlug="marketing-strategist")`.
   3. `dispatcher.enqueueAndAwait({ agentInstanceId, triggerMessageId, parentActionId: <this delegation action> })`.
   4. In `BullMQDispatcher`: uses `FlowProducer` to spawn the child job — parent waits without occupying a worker.
9. Child job runs (Marketing Strategist's `runAgentInstance`). It may call `delegateToSpecialist({templateSlug: "designer", ...})` — same pattern, grandchild job.
10. Grandchild job (Designer): calls `generateBrandImage`. Skill execute: pulls brand context from recent BrandAssets, calls `lib/image-gen`, calls `knowledge/brand-asset.ingestGeneratedAsset`. Returns `{ assetId, ok: true }`.
11. Results bubble: Designer → Marketing Strategist → Controller. Each `delegateToSpecialist` call's return value is the child run's `text + generatedAssetIds + actions`.
12. Controller's final text reply is the runtime result. `inbox/pipeline.postReply` (called from runtime epilogue) → `connectors/telegram/adapter.sendOutbound({ threadId, text, files })` → Telegram delivers.
13. `agents/cost.rollup(agentInstanceId)` → if month-to-date crosses 80%/100% of `budgetCents`, emit structured log + `budgetSoftWarn` event row (future-proof for the web app's notification feed).

**AgentAction rows for that one inbound message:**

```
1. delegate-to-specialist     Controller            parent=null     AUTO_APPROVED
2. draft-marketing-strategy   Marketing Strategist  parent=1        AUTO_APPROVED (OWNER side)
3. delegate-to-specialist     Marketing Strategist  parent=2        AUTO_APPROVED
4. generate-brand-image       Designer              parent=3        AUTO_APPROVED (OWNER side)
5. <reply-to-owner>           Controller            parent=null     AUTO_APPROVED
```

If the same flow were happening on a `senderRole=CUSTOMER` connector, action 5 (reply-to-customer) would be `requiresApprovalDefault=true` and status would land as `DRAFTED` → web UI surfaces it → human approves → `executeAction` → outbound send.

**Error matrix:**

| Failure                                       | Where                            | Behaviour                                                                                                                                |
| --------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Telegram secret mismatch                      | `routes/connectors/telegram.ts`  | 401 immediate; no DB write                                                                                                               |
| Duplicate update                              | `inbox/pipeline` step 3.1        | dedup hits → early return + "duplicate" log                                                                                              |
| Delegation to unknown template                | `delegate-to-specialist.execute` | Tool returns `{ok:false, error}`; AgentAction.FAILED; model produces apology                                                             |
| Cycle attempt (Designer tries to delegate up) | Same                             | Same — `canDelegateTo` doesn't include the parent template                                                                               |
| Child agent throws (LLM error / skill throws) | BullMQ Worker                    | BullMQ retry (3 attempts, exponential backoff). Final failure: child AgentAction.FAILED, parent delegation returns `{ok:false}`          |
| `generateBrandImage` Gateway 5xx              | Designer's skill                 | Caught inside execute → `{ok:false, error}` → Marketing Strategist sees it, may retry with shorter prompt or surface error to Controller |
| All retries exhausted                         | BullMQ DLQ                       | Pino error log + AgentAction.FAILED at every level. Controller's reply text becomes "Tive um problema, pode tentar de novo?"             |
| Worker crash mid-chain                        | BullMQ stalled-job recovery      | Stalled job re-delivered. Idempotency keys on AgentAction prevent double-execute of already-executed children                            |
| Outbound send to Telegram fails               | `inbox/pipeline.postReply`       | Last AgentAction → FAILED + error logged. Earlier actions stay EXECUTED (no double charge / no retry of side-effects)                    |

## 8. Auto-approval rule (formal)

When persisting an AgentAction draft:

```ts
const ownerSide = action.connectorSenderRole === "OWNER";
const skill = await loadSkill(action.skillId);
const status = ownerSide || !skill.requiresApprovalDefault ? "AUTO_APPROVED" : "DRAFTED";
```

Edge cases:

- **Internal actions** (no associated connector — e.g., `delegate-to-specialist`, `extract-soul` updating businessProfile): treated as OWNER-side. Always AUTO_APPROVED.
- **Skills with side-effects on customers** (e.g., a future `sendWhatsAppMessage`): `requiresApprovalDefault: true`. On a CUSTOMER connector → DRAFTED. On OWNER connector → AUTO_APPROVED (the OWNER is talking to themselves; nothing to approve).
- **Failures during execution don't go back to DRAFTED.** They land on FAILED, and the parent's tool call sees `{ok:false}`. No human-in-the-loop on failures.

## 9. Cost tracking

Per-action cost fields capture both LLM and external costs:

```
AgentAction.costInputTokens   Int    // from AI SDK result.usage
AgentAction.costOutputTokens  Int
AgentAction.costCents         Int    // = tokens × rate + per-skill external cost (gpt-image-1, etc.)
AgentAction.costCurrency      String @default("BRL")
```

`agents/cost.ts` exposes:

```ts
monthlyCostCents(agentInstanceId: string): Promise<number>
checkBudgetThresholds(agentInstanceId: string): Promise<{ pct: number; emitted: false | "WARN_80" | "WARN_100" }>
```

After every action execution, runtime calls `checkBudgetThresholds` once per chain (debounced). When the threshold is first crossed for the month, a structured log event fires and (future) a `BudgetSoftWarn` row is created for the UI to react to. **No hard stop** — the agent keeps running.

Per-action external-cost figures (e.g., gpt-image-1) come from env-driven constants:

```
COST_BRL_PER_INPUT_TOKEN_GEMINI_25_FLASH      = "0.0000001"
COST_BRL_PER_OUTPUT_TOKEN_GEMINI_25_FLASH     = "0.0000004"
COST_BRL_PER_IMAGE_GPT_IMAGE_1                = "0.20"
```

(Exact numbers fill in during Phase 5f; the structure is fixed here.)

## 10. Testing strategy

| Layer                        | Test type     | Mocks                                                                                                                                   |
| ---------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Each Skill                   | Unit (Vitest) | `prisma`, `lib/image-gen`, `lib/storage`. Real Zod parsing. Test happy + error returns.                                                 |
| `agents/runtime`             | Unit          | mock `generateText` (canned `result.steps`), mock skill registry. Verify prompt assembly, tool wiring, action persistence, cost rollup. |
| `agents/dispatcher` (Serial) | Unit          | none — inline.                                                                                                                          |
| `agents/dispatcher` (BullMQ) | Integration   | in-memory BullMQ adapter or a separate Redis DB.                                                                                        |
| `agents/delegation`          | Unit          | inject `SerialDispatcher` + 2 stub templates. Verify cycle rejection, canDelegateTo check, recursion.                                   |
| `agents/actions`             | Unit          | mock prisma. Verify auto-approval rule, transitions, idempotency.                                                                       |
| `connectors/<type>/adapter`  | Unit          | mock fetch.                                                                                                                             |
| `inbox/pipeline`             | Integration   | real Prisma against local DB + `SerialDispatcher`. End-to-end dedup + identity + dispatch.                                              |
| `routes/connectors/telegram` | Integration   | Hono + real Prisma + `SerialDispatcher` + mocked `generateText`. Full inbound → outbound assertion.                                     |
| `workers/agent-runner`       | Integration   | BullMQ on a separate Redis DB. Worker consumes a real job, runs the mocked-AI chain.                                                    |

`SerialDispatcher` is the canonical test substitute. Tests get deterministic ordering and stack traces; prod gets BullMQ's retries, backoff, and DLQ for free. Dispatcher factory:

```ts
// agents/dispatcher.ts
const createDispatcher = (mode: "serial" | "queue"): AgentDispatcher =>
  mode === "queue" ? new BullMQDispatcher(redisUrl) : new SerialDispatcher();

const dispatcher = createDispatcher(env.DISPATCH_MODE);
```

Tests set `DISPATCH_MODE=serial` (already the test env default).

## 11. Migration sequence (9 phases)

Each phase ships independently — implementation plan written separately. The bot stays live throughout.

| Phase                                        | Scope                                                                                                                                                                                                                           | Validates with                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **5a · Schema**                              | Add new Prisma models. Drop nothing. `db:push`.                                                                                                                                                                                 | `pnpm test` green; bot still works (no code reads new tables).                                  |
| **5b · Skills extraction**                   | Move 3 tools out of `lib/ai.ts` into `agents/skills/*.ts`. Rename `soul/` → `knowledge/`. Update `lib/ai.ts` to import from registry.                                                                                           | Bot replies as before; existing tests pass after path updates.                                  |
| **5c · Generic runtime + Designer template** | Introduce `agents/runtime.ts`, `agents/dispatcher.ts` (SerialDispatcher only), `agents/templates/designer.ts`. `telegram/handler.ts` calls `runtime.runAgentInstance(designer)` directly. No Controller yet.                    | Bot replies as before. New runtime tests pass.                                                  |
| **5d · Controller + delegateToSpecialist**   | Introduce `agents/delegation.ts`, `agents/skills/delegate-to-specialist.ts`, `agents/templates/controller.ts`. Inbound routes via Controller; Controller delegates to Designer.                                                 | Bot replies as before but via 2-step chain. Delegation tests pass.                              |
| **5e · Marketing Strategist**                | Add `agents/templates/marketing-strategist.ts` + `agents/skills/draft-marketing-strategy.ts` (stub). Wire Controller → MarketingStrategist → Designer for marketing-style triggers.                                             | A marketing prompt triggers 3-step chain. Cycle tests pass.                                     |
| **5f · AgentAction queue + cost**            | Introduce `agents/actions.ts` + `agents/cost.ts`. Persist drafts/approvals/executions per chain. Soft-warn at 80%/100%.                                                                                                         | New tests; bot still works; rows visible in DB; thresholds emit logs.                           |
| **5g · BullMQ dispatcher + worker**          | Introduce BullMQ FlowProducer in `agents/dispatcher.ts`. Add `workers/agent-runner.ts` + `workers/index.ts` (separate process). Switch factory to BullMQ when `DISPATCH_MODE=queue`. New `pnpm dev:worker` script.              | Webhook returns 200 immediately. Worker logs show chain progression. End-to-end via async path. |
| **5h · Per-org connector route**             | Introduce `POST /connectors/telegram/:connectorInstanceId/webhook`. One-time data migration: `TelegramLink` row → `ConnectorInstance(TELEGRAM)`. Re-register Telegram webhook URL. Keep old `/telegram/webhook` for one deploy. | Bot replies on new URL; old URL still works briefly.                                            |
| **5i · Cleanup**                             | Delete old `/telegram/webhook` route, `TelegramLink` model, dead code from `lib/ai.ts` (or delete `lib/ai.ts` entirely if hollowed).                                                                                            | Bot works only on new path.                                                                     |

## 12. Seed + startup

**`packages/db/prisma/seed.ts`** (reintroduced; was deleted in Phase 0):

- Idempotent upserts of all 3 AgentTemplates from `apps/api/src/agents/templates/registry.ts`.
- Idempotent upserts of all Skills from `apps/api/src/agents/skills/registry.ts`.
- For Pedro's existing Organization (looked up by slug): one AgentInstance per template, one ConnectorInstance for Telegram (config carries the existing chatId), and AgentConnectorBindings: Controller=BOTH on TELEGRAM, MarketingStrategist=OUTBOUND on TELEGRAM, Designer=OUTBOUND on TELEGRAM.

**API startup (`apps/api/src/index.ts`):**

```ts
await syncTemplates(prisma); // upsert templates + acyclic canDelegateTo
await syncSkills(prisma); // upsert skills + Zod→JSON Schema
await validateConnectorCompatibility(); // every Skill.requiredConnectorTypes ⊆ Template.compatibleOutboundConnectorTypes
// ... then start Hono
```

`syncTemplates` and `syncSkills` are **safe to run on every boot** — both are pure upserts with no destructive deletes. Reconciliation of removed templates/skills happens via explicit migrations.

## 13. New environment variables

```
DISPATCH_MODE=queue                                    # queue | serial (default: queue; tests: serial)
BULLMQ_QUEUE_NAME=agent-run                            # main queue name
BULLMQ_CONCURRENCY=4                                   # workers per process
COST_BRL_PER_INPUT_TOKEN_GEMINI_25_FLASH               # decimal string
COST_BRL_PER_OUTPUT_TOKEN_GEMINI_25_FLASH              # decimal string
COST_BRL_PER_IMAGE_GPT_IMAGE_1                         # decimal string (per-image)
```

All existing vars (`AI_GATEWAY_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET_TOKEN`, `R2_*`, `REDIS_URL`, `DATABASE_URL`, `CORS_ORIGINS`, `NODE_ENV`, `PORT`, `HOST`) remain.

Phase 5h migration moves `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET_TOKEN` from process env into the per-ConnectorInstance `config` JSON. They're seeded from env at first migration but stop being env-required after.

## 14. Future seams (anticipated extensions, not built here)

- **Web UI for the approval queue.** `AgentAction` schema is queue-ready (status enum + decidedByUserId field). UI lives in a future `apps/web` Next.js app.
- **Customer-facing connectors.** Real WhatsApp/Fresha adapters. Stubs in this spec define the interface they have to satisfy.
- **Per-AgentInstance memory / transcript memory.** A new `AgentMemory` table or per-instance JSON column. `knowledge/provider` would compose it into context.
- **Hard budget enforcement.** Add an early-return in `runAgentInstance` if month-to-date ≥ budget. Soft-warn → policy upgrade.
- **Multi-org production.** No schema changes needed; the seed gains a multi-org bootstrap path. Web onboarding wizard provisions ConnectorInstances + AgentInstances per org.
- **Observer/moderation agents.** 1:N fan-out routing (already in the schema) supports adding a non-Controller agent with `INBOUND` binding. UI for managing these comes later.
- **Streaming responses.** AI SDK `streamText` swaps in cleanly inside `runtime`; outbound `sendOutbound` already takes structured payloads.
- **Per-skill rate limits / quotas.** New columns on Skill; checked in `agents/actions.draftAction`.
- **Auto-pause on repeated failures.** `AgentInstance.status = PAUSED` (already enum'd) when consecutive FAILED actions cross threshold.

## 15. Open questions

- **Cycle detection nuance.** `canDelegateTo` is a static graph at the template level. Are there per-instance overrides? Decision: **no overrides in v0.** Per-instance customization in `enabledSkillIds` is enough.
- **Concurrent inbound for the same Conversation.** Two messages arrive 100ms apart from the same Telegram chat — what's the ordering guarantee? **Decision: BullMQ FIFO per queue; no per-conversation queueing yet.** If ordering becomes important, we add a `conversationId`-keyed lane.
- **Action TTL.** Drafted actions sitting in the queue forever — when do they EXPIRE? **Decision: not in this spec.** Add a job in 5f++ that EXPIRES drafts older than 7 days.
- **Multi-instance dispatcher pickup ordering.** If we deploy 2 workers, BullMQ load-balances. No special handling needed.
- **`enabledSkillIds` empty-array semantics.** `[]` means "explicit empty, no skills" vs `null` means "use template default". **Decision: empty array = no skills; `null` = template default.** Document on the field.

## 16. References

- Wireframe: `CleanShot 2026-05-20 at 12.24.16@2x.jpg` (locally; not committed).
- Current architecture: `docs/ARCHITECTURE.md` at HEAD `876d583`.
- Prior phase specs: `docs/superpowers/specs/2026-05-{19,20}-qolmeia-phase-{1..4}-*.md`.
- AI SDK v6 step aggregation pattern: `apps/api/src/lib/ai.ts:262-303` (preserved as-is in `agents/runtime.ts`).
