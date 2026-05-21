# Qolmeia — Current Architecture Diagrams

**Date:** 2026-05-20
**HEAD:** `566e07c` (Controller pivot to briefing-gatherer + explicit-invocation router)
**Companion to:** `docs/ARCHITECTURE.md` (prose) — this file is the visual reference.

All diagrams are Mermaid. They render in GitHub, GitLab, most IDEs (VS Code with the Markdown Mermaid extension, JetBrains, Cursor), and the Mermaid Live Editor at https://mermaid.live.

---

## 1. System context

External actors, the API and worker processes, and the data + AI substrate they depend on.

```mermaid
flowchart LR
  subgraph Edge["External"]
    TG["Telegram<br/>(owner's phone)"]
    CF["cloudflared tunnel<br/>(local dev only)"]
  end

  subgraph Qolmeia["Qolmeia (this monorepo)"]
    API["apps/api<br/>Hono on Node 24<br/>:4000"]
    WORKER["worker<br/>BullMQ consumer<br/>pnpm dev:worker"]
  end

  subgraph Data["Data plane"]
    PG[("Postgres 18<br/>:5436 local<br/>Railway prod")]
    REDIS[("Redis 7<br/>:6382 local<br/>BullMQ + Chat SDK state")]
    R2[("Cloudflare R2<br/>bucket: qolmeia<br/>brand assets +<br/>KnowledgeDocs")]
  end

  subgraph AI["AI plane"]
    GATEWAY["Vercel AI Gateway<br/>AI_GATEWAY_API_KEY"]
    GEMINI["google/gemini-2.5-flash<br/>(agent loop)"]
    GPTIMG["openai/gpt-image-1<br/>(image generation)"]
  end

  TG -->|HTTPS POST<br/>X-Telegram-Bot-Api-Secret-Token| CF
  CF -->|POST /telegram/webhook<br/>POST /connectors/telegram/:id/webhook| API
  TG -.->|prod: direct| API

  API -->|enqueue| REDIS
  REDIS -->|consume| WORKER
  WORKER --> PG
  WORKER --> R2
  WORKER --> GATEWAY
  API --> PG
  API --> R2
  API --> GATEWAY

  GATEWAY --> GEMINI
  GATEWAY --> GPTIMG

  WORKER -->|sendMessage / sendDocument| TG
  API -->|sendMessage / sendDocument| TG

  classDef ext fill:#e1f5ff,stroke:#0288d1,color:#01579b
  classDef app fill:#fff3e0,stroke:#f57c00,color:#e65100
  classDef data fill:#f3e5f5,stroke:#8e24aa,color:#4a148c
  classDef ai fill:#e8f5e9,stroke:#43a047,color:#1b5e20
  class TG,CF ext
  class API,WORKER app
  class PG,REDIS,R2 data
  class GATEWAY,GEMINI,GPTIMG ai
```

**Two processes share the same code:**
- `API` (Hono server) — webhook receiver, executes inline in `DISPATCH_MODE=serial` (default for local dev + tests).
- `Worker` (BullMQ consumer) — only runs in `DISPATCH_MODE=queue`. Webhook returns 200 immediately; runtime executes in the worker. Both processes import the same `runAgentInstance`.

---

## 2. Module dependencies

The internal structure of `apps/api/src/`. Read top-to-bottom: HTTP entry on top, persistence at the bottom. Arrows are dependency direction (caller → callee).

```mermaid
flowchart TB
  subgraph HTTP["HTTP entry"]
    routes_old["routes/telegram/webhook.ts<br/>(legacy — pending 5i cleanup)"]
    routes_new["routes/connectors/telegram.ts<br/>POST /connectors/telegram/:id/webhook"]
  end

  subgraph Chat["Chat SDK adapter"]
    bot["telegram/bot.ts<br/>Chat singleton +<br/>onNewMention / onSubscribedMessage"]
  end

  subgraph Inbox["inbox/ pipeline"]
    pipeline["pipeline.ts<br/>orchestrator (~150 LOC)"]
    ingest["ingest.ts<br/>dedup + org + conversation"]
    attachments["attachments.ts<br/>image/audio download"]
    agent_step["agent-step.ts<br/>context load + dispatch + post"]
    jsonsafe["json-safe.ts"]
  end

  subgraph Agents["agents/"]
    main_dispatcher["main-dispatcher.ts<br/>module singleton"]
    dispatcher["dispatcher.ts<br/>AgentDispatcher iface +<br/>SerialDispatcher factory"]
    bullmq_dispatcher["bullmq-dispatcher.ts<br/>queue + waitUntilFinished"]
    runtime["runtime.ts<br/>runAgentInstance"]
    step_aggregator["step-aggregator.ts<br/>walk step.content[]"]
    agent_instance["agent-instance.ts<br/>ensureAgentInstance"]
    actions["actions.ts<br/>recordAgentAction"]
    cost["cost.ts<br/>budget rollup + soft-warn"]
  end

  subgraph Templates["agents/templates/"]
    tmpl_registry["registry.ts<br/>syncTemplates + validateCanDelegateTo"]
    tmpl_renderer["renderer.ts<br/>renderSystemPrompt"]
    tmpl_controller["controller.ts<br/>briefing-gatherer (566e07c)"]
    tmpl_strategist["marketing-strategist.ts"]
    tmpl_designer["designer.ts"]
  end

  subgraph Skills["agents/skills/"]
    skill_registry["registry.ts<br/>syncSkills + ALL_SKILLS"]
    skill_types["types.ts<br/>defineSkill + SkillContext"]
    skill_delegate["delegate-to-specialist.ts"]
    skill_extract["extract-soul.ts"]
    skill_label["label-brand-asset.ts"]
    skill_gen["generate-brand-image.ts"]
    skill_strategy["draft-marketing-strategy.ts<br/>(stub)"]
    skill_search["search-knowledge.ts"]
    skill_read["read-knowledge-doc.ts"]
  end

  subgraph Knowledge["knowledge/"]
    k_provider["provider.ts<br/>getBusinessContext (read seam)"]
    k_apply["apply.ts<br/>applySoulUpdate (single writer)"]
    k_soul["soul.ts<br/>SoulProfile type"]
    k_brand_asset["brand-asset.ts<br/>ingestBrandAsset + ingestGeneratedAsset"]
    k_brand_ctx["brand-context.ts<br/>getBrandContext + enrichPromptWithBrand"]
    k_doc["knowledge-doc.ts<br/>KnowledgeDoc CRUD"]
  end

  subgraph Workers["workers/"]
    w_index["index.ts"]
    w_runner["agent-runner.ts<br/>BullMQ Worker"]
  end

  subgraph Lib["lib/"]
    lib_env["env.ts (Zod)"]
    lib_storage["storage.ts (R2)"]
    lib_image["image-gen.ts (gpt-image-1)"]
    lib_logger["logger.ts (Pino)"]
  end

  subgraph DB["@repo/db"]
    prisma[("Prisma client")]
  end

  routes_old --> bot
  routes_new --> bot
  bot --> pipeline
  pipeline --> ingest
  pipeline --> attachments
  pipeline --> agent_step
  pipeline --> jsonsafe
  agent_step --> main_dispatcher
  agent_step --> k_provider
  agent_step --> agent_instance

  main_dispatcher --> dispatcher
  main_dispatcher --> bullmq_dispatcher
  dispatcher --> runtime
  bullmq_dispatcher --> runtime
  w_runner --> runtime
  w_index --> w_runner

  runtime --> step_aggregator
  runtime --> actions
  runtime --> cost
  runtime --> tmpl_registry
  runtime --> tmpl_renderer
  runtime --> skill_registry

  skill_delegate --> agent_instance
  skill_delegate --> tmpl_registry
  skill_delegate --> main_dispatcher
  skill_extract --> k_apply
  skill_label --> prisma
  skill_gen --> k_brand_ctx
  skill_gen --> lib_image
  skill_gen --> k_brand_asset
  skill_search --> k_doc
  skill_read --> k_doc
  skill_read --> lib_storage

  tmpl_controller --> skill_registry
  tmpl_strategist --> skill_registry
  tmpl_designer --> skill_registry

  k_brand_asset --> lib_storage
  k_brand_asset --> prisma
  k_doc --> lib_storage
  k_doc --> prisma
  k_provider --> prisma
  k_apply --> prisma
  ingest --> prisma
  actions --> prisma
  agent_instance --> prisma
  cost --> prisma

  classDef http fill:#e1f5ff,stroke:#0288d1
  classDef chat fill:#fff3e0,stroke:#f57c00
  classDef inbox fill:#f3e5f5,stroke:#8e24aa
  classDef agent fill:#e8f5e9,stroke:#43a047
  classDef tmpl fill:#fff9c4,stroke:#fbc02d
  classDef skill fill:#fce4ec,stroke:#d81b60
  classDef know fill:#e0f7fa,stroke:#00838f
  classDef work fill:#ffebee,stroke:#c62828
  classDef lib fill:#eceff1,stroke:#455a64
  classDef db fill:#d7ccc8,stroke:#5d4037

  class routes_old,routes_new http
  class bot chat
  class pipeline,ingest,attachments,agent_step,jsonsafe inbox
  class main_dispatcher,dispatcher,bullmq_dispatcher,runtime,step_aggregator,agent_instance,actions,cost agent
  class tmpl_registry,tmpl_renderer,tmpl_controller,tmpl_strategist,tmpl_designer tmpl
  class skill_registry,skill_types,skill_delegate,skill_extract,skill_label,skill_gen,skill_strategy,skill_search,skill_read skill
  class k_provider,k_apply,k_soul,k_brand_asset,k_brand_ctx,k_doc know
  class w_index,w_runner work
  class lib_env,lib_storage,lib_image,lib_logger lib
  class prisma db
```

**Layer rules (enforced by file location, checked by code review):**
- `routes/` → `telegram/bot` → `inbox/` → `agents/` → `knowledge/` + `lib/` → `prisma`
- `agents/skills/` reach into `knowledge/` + `lib/` only; never into `inbox/` or `routes/`
- `agents/templates/` are pure config + prompts; no I/O
- `workers/` mirrors the API's wiring from `agents/` downward
- `knowledge/*` are the single-writer / single-reader seams (verified by `grep -rn "businessProfile" / "brandAsset.create" / "brandAsset.update"`)

---

## 3. Data model (ERD)

All Prisma models, current relations, with Phase 5a additions and the KR Knowledge Registry. `TelegramLink` still exists (pending Phase 5i cleanup).

```mermaid
erDiagram
  Organization ||--o| TelegramLink : "1:0..1 (legacy)"
  Organization ||--o{ Customer : "1:N"
  Organization ||--o{ Conversation : "1:N"
  Organization ||--o{ BrandAsset : "1:N"
  Organization ||--o{ KnowledgeDoc : "1:N"
  Organization ||--o{ AgentInstance : "1:N"
  Organization ||--o{ ConnectorInstance : "1:N"

  Customer ||--o{ Conversation : "1:N"
  Conversation ||--o{ Message : "1:N"
  Conversation }o--|| ConnectorInstance : "N:1 (optional)"

  AgentTemplate ||--o{ AgentInstance : "1:N (by templateSlug)"
  AgentTemplate }o--o{ Skill : "M:N TemplateSkills"

  AgentInstance ||--o{ AgentConnectorBinding : "1:N"
  AgentInstance ||--o{ AgentAction : "1:N"
  ConnectorInstance ||--o{ AgentConnectorBinding : "1:N"

  Skill ||--o{ AgentAction : "1:N"

  AgentAction }o--o| AgentAction : "parent/children<br/>(parentActionId)"
  AgentAction }o--o| Message : "triggeredBy<br/>(triggerMessageId, weak)"

  Organization {
    string id PK
    string slug UK
    string name
    string timezone "default: America/Sao_Paulo"
    string currency "default: BRL"
    json businessProfile "SOUL — KnowledgeProvider only"
  }
  TelegramLink {
    string id PK
    string orgId FK,UK
    string telegramChatId UK
  }
  Customer {
    string id PK
    string orgId FK
    string phone "nullable"
    string email "nullable"
    string name "nullable"
    json meta
  }
  Conversation {
    string id PK
    string orgId FK
    string customerId FK "nullable"
    string connectorInstanceId FK "nullable — 5a"
    string channel
    string externalId "nullable"
    string status
  }
  Message {
    string id PK
    string conversationId FK
    string externalId "nullable"
    enum sender "CUSTOMER|AGENT|SYSTEM"
    string content
    enum contentType "TEXT|AUDIO|IMAGE|DOCUMENT"
    json metadata "sanitized via toJsonSafe"
  }
  BrandAsset {
    string id PK
    string orgId FK
    string r2Key
    string sha256
    string mimeType
    int size
    json metadata "uploaded OR generated"
  }
  KnowledgeDoc {
    string id PK
    string orgId FK
    string r2Key
    string title
    string summary
    strings tags
    enum contentType "MARKDOWN|PLAIN_TEXT|JSON"
    int size
  }
  WebhookEvent {
    string id PK
    string provider "indexed UK with externalId"
    string externalId
    json payload
    string status "default: processed"
  }
  AgentTemplate {
    string slug PK
    string displayName
    string defaultSystemPrompt
    string defaultMission
    enums compatibleInboundConnectorTypes
    enums compatibleOutboundConnectorTypes
    strings canDelegateTo "validated acyclic"
    int defaultBudgetCents
  }
  AgentInstance {
    string id PK
    string orgId FK
    string templateSlug FK
    string displayName
    string mission
    json enabledSkillIds "null=template default, []=empty"
    int budgetCents
    enum status "ACTIVE|PAUSED"
  }
  Skill {
    string id PK
    string displayName
    string description
    json parametersJsonSchema "Zod-rendered"
    bool requiresApprovalDefault
    enums requiredConnectorTypes
  }
  ConnectorInstance {
    string id PK
    string orgId FK
    enum type "TELEGRAM|WHATSAPP|FRESHA|..."
    string displayName
    json config "per-type credentials"
    json capabilities "inbound + outbound flags"
    enum senderRole "OWNER|CUSTOMER"
  }
  AgentConnectorBinding {
    string id PK
    string agentInstanceId FK
    string connectorInstanceId FK
    enum direction "INBOUND|OUTBOUND|BOTH"
  }
  AgentAction {
    string id PK
    string agentInstanceId FK
    string skillId FK
    string triggerMessageId "nullable, not yet wired"
    string parentActionId "nullable, not yet wired"
    json proposedInput
    string proposedSummary
    enum status "DRAFTED|AUTO_APPROVED|APPROVED|REJECTED|EDITED|EXPIRED|FAILED|EXECUTED"
    int costCents
    int costInputTokens
    int costOutputTokens
  }
```

**Active vs. dormant fields:**
- `AgentConnectorBinding` — rows seeded by Phase 5h, but `direction` not yet gating inbound routing (still hard-coded to Controller).
- `AgentAction.triggerMessageId` + `parentActionId` — schema fields exist, no writers yet. Roadmap item.
- `Conversation.connectorInstanceId` — written by ingest, not yet read by any approval/routing logic.

---

## 4. Inbound request lifecycle (sequence)

Pedro sends *"gera uma imagem promocional para minha promo de Black Friday"* — full flow including the 3-level delegation that the post-pivot Controller exposes when the request is explicit.

```mermaid
sequenceDiagram
  autonumber
  actor Pedro
  participant TG as Telegram
  participant API as routes + bot.ts
  participant PIPE as inbox/pipeline
  participant ING as inbox/ingest
  participant ATT as inbox/attachments
  participant STEP as inbox/agent-step
  participant DISP as main-dispatcher
  participant RUN as runtime.runAgentInstance
  participant CTRL as Controller<br/>(briefing-gatherer)
  participant STRAT as Marketing<br/>Strategist
  participant DES as Designer
  participant K as knowledge/*
  participant LIB as lib/image-gen
  participant R2
  participant DB as Postgres
  participant TGOUT as Telegram (out)

  Pedro->>TG: "gera uma imagem promocional..."
  TG->>API: POST /connectors/telegram/:id/webhook<br/>+ X-Telegram-Bot-Api-Secret-Token
  API->>API: bot.webhooks.telegram(raw)<br/>secret validated, dedup
  API->>PIPE: handleInboundMessage({dispatcher, prisma}, thread, msg)

  PIPE->>ING: markWebhookProcessed(externalId)
  ING->>DB: insert WebhookEvent (unique on provider+externalId)
  Note over ING,DB: duplicate? → early return

  PIPE->>ING: resolveOrgAndConversation
  ING->>DB: ConnectorInstance lookup (preferred)
  Note over ING,DB: TelegramLink fallback for legacy orgs
  ING->>DB: upsert Conversation
  PIPE->>DB: persistInboundMessage(Message)

  PIPE->>ATT: processIncomingAttachments
  Note right of ATT: (no attachments this turn)

  PIPE->>STEP: runAgentForInbound(orgId, msg)
  STEP->>K: getBusinessContext(orgId)
  K->>DB: SELECT Organization.businessProfile
  STEP->>DB: brandAsset.findMany(take: 20) — existingAssets
  STEP->>DB: ensureAgentInstance(orgId, "controller")
  STEP->>DISP: enqueueAndAwait({agentInstance: Controller, ...})

  DISP->>RUN: runAgentInstance(Controller)
  RUN->>DB: load template + enabled skills
  RUN->>RUN: renderSystemPrompt(currentContext, assets)
  RUN->>RUN: generateText(gemini-2.5-flash, tools, stopWhen:5)
  Note over RUN,CTRL: Controller asks "gera uma imagem?" first<br/>OR (if explicit) delegates immediately

  CTRL->>CTRL: tool-call: delegateToSpecialist<br/>(target: marketing-strategist, subtask: ...)
  CTRL->>DISP: dispatcher.enqueueAndAwait(Strategist child)
  DISP->>RUN: runAgentInstance(Strategist)

  RUN->>STRAT: generateText (template + skills)
  STRAT->>STRAT: tool-call: delegateToSpecialist<br/>(target: designer, subtask: image brief)
  STRAT->>DISP: dispatcher.enqueueAndAwait(Designer child)
  DISP->>RUN: runAgentInstance(Designer)

  RUN->>DES: generateText (template + skills)
  DES->>DES: tool-call: generateBrandImage(prompt, aspectRatio)
  DES->>K: getBrandContext(orgId)
  K->>DB: brandAsset.findMany — recent 3 uploaded
  DES->>LIB: generateBrandImageBytes(enriched prompt)
  LIB->>LIB: POST AI Gateway /v1/images/generations
  LIB-->>DES: PNG bytes
  DES->>K: ingestGeneratedAsset(bytes, mime, prompt)
  K->>R2: uploadAsset(key, bytes)
  K->>DB: insert BrandAsset (source: generated)
  K-->>DES: { assetId }
  DES-->>RUN: tool-result: { assetId, ok: true }
  RUN->>DB: recordAgentAction(skill: generateBrandImage, EXECUTED)
  RUN->>RUN: aggregateSteps → generatedAssetIds: [assetId]
  RUN-->>DISP: AgentRunResult (Designer)

  DISP-->>STRAT: { text, generatedAssetIds }
  STRAT->>RUN: aggregator spreads delegation result
  RUN->>DB: recordAgentAction(skill: delegateToSpecialist, EXECUTED)
  RUN-->>DISP: AgentRunResult (Strategist)

  DISP-->>CTRL: { text, generatedAssetIds }
  CTRL->>CTRL: LLM step 2: write final pt-BR reply
  RUN->>DB: recordAgentAction(skill: delegateToSpecialist, EXECUTED)
  RUN->>RUN: cost rollup → soft-warn if ≥80%/100%
  RUN-->>DISP: AgentRunResult (Controller)
  DISP-->>STEP: { text, generatedAssetIds }

  STEP->>R2: fetchAsset(r2Key) — for each generated ID
  STEP->>TGOUT: thread.post({files: [bytes], markdown: text})
  TGOUT->>Pedro: image + caption
  PIPE->>PIPE: logger.info "telegram message handled"
```

**Key invariants visible above:**
- The dispatcher is the single seam between sync (Serial) and async (BullMQ) execution. Delegation re-enters through the same dispatcher.
- `AgentAction` rows are written from `runtime.ts` (one per tool call). Status is always `EXECUTED` or `FAILED` today; `DRAFTED`/`APPROVED` lifecycle waits for customer-facing channels.
- Cost rollup happens once per agent run, after all tool calls complete.
- Outbound is always through `thread.post` (Chat SDK), which handles `sendMessage` vs `sendDocument` based on whether `files` is present.

---

## 5. Delegation DAG

Static topology validated by `validateCanDelegateTo` at boot. Acyclic by construction.

```mermaid
flowchart LR
  CTRL["Controller<br/>(briefing-gatherer)<br/>skills: delegateToSpecialist,<br/>extractSoul, searchKnowledge, readKnowledgeDoc"]
  STRAT["Marketing Strategist<br/>skills: delegateToSpecialist,<br/>draftMarketingStrategy"]
  DES["Designer<br/>skills: extractSoul, labelBrandAsset,<br/>generateBrandImage,<br/>searchKnowledge, readKnowledgeDoc"]

  CTRL -->|"delegateToSpecialist<br/>(target: marketing-strategist)"| STRAT
  CTRL -->|"delegateToSpecialist<br/>(target: designer)"| DES
  STRAT -->|"delegateToSpecialist<br/>(target: designer)"| DES

  classDef ctrl fill:#fff9c4,stroke:#fbc02d
  classDef spec fill:#e1f5ff,stroke:#0288d1
  class CTRL ctrl
  class STRAT,DES spec
```

**Post-pivot Controller behaviour (commit `566e07c`):**
- Old: orchestrator-chef that auto-delegated by inferred intent.
- New: briefing-gatherer that explicitly asks the owner before invoking a specialist (*"gera uma imagem?"*).
- Default skills now include `extractSoul`, `searchKnowledge`, `readKnowledgeDoc` — Controller can capture soul updates and answer Q&A directly without delegating.

---

## 6. Dispatch modes

The dispatcher seam — same interface, two backends. Selected by `env.DISPATCH_MODE`.

```mermaid
flowchart TB
  caller["caller<br/>(inbox/agent-step OR<br/>delegate-to-specialist skill)"]
  iface["AgentDispatcher interface<br/>enqueueAndAwait(args) → AgentRunResult"]

  caller --> iface

  subgraph Serial["DISPATCH_MODE=serial (default)"]
    direction TB
    serial["SerialDispatcher<br/>(inline)"]
    serial_run["runAgentInstance(args)"]
    serial --> serial_run
  end

  subgraph Queue["DISPATCH_MODE=queue"]
    direction TB
    bull["BullMQDispatcher<br/>queue.add('run', payload)"]
    redis_q[("Redis Queue")]
    worker["workers/agent-runner<br/>Worker(concurrency=4)"]
    worker_run["runAgentInstance(args)"]
    bull -->|enqueue| redis_q
    redis_q -->|claim| worker
    worker --> worker_run
    bull -. "waitUntilFinished(120s)" .- worker_run
  end

  iface -. "env.DISPATCH_MODE selects" .- serial
  iface -. "env.DISPATCH_MODE selects" .- bull

  classDef seam fill:#fff9c4,stroke:#fbc02d
  classDef serial fill:#e8f5e9,stroke:#43a047
  classDef queue fill:#fce4ec,stroke:#d81b60
  class iface seam
  class serial,serial_run serial
  class bull,redis_q,worker,worker_run queue
```

**What flows through the queue payload:** plain serializable AgentDispatchArgs (orgId, templateSlug, mission, input, currentContext, newAssets, existingAssets). The `prisma` and `dispatcher` references can't serialize — the worker re-attaches them from module singletons (`@repo/db` and `agents/main-dispatcher`).

**No FlowProducer.** Delegation uses the same `enqueueAndAwait` recursively — each child is a top-level job; the parent waits on `job.waitUntilFinished()`. Simple, but limits depth by the 120s timeout.

---

## 7. AgentAction lifecycle (state)

Schema supports the full Co-piloto lifecycle. Today, only the highlighted transitions are exercised.

```mermaid
stateDiagram-v2
  [*] --> DRAFTED : skill needs human approval<br/>AND sender is CUSTOMER<br/>(NOT YET — no customer connectors)
  [*] --> AUTO_APPROVED : OWNER side<br/>OR !skill.requiresApprovalDefault<br/>(✓ current path)

  DRAFTED --> APPROVED : human approves
  DRAFTED --> EDITED : human edits input
  DRAFTED --> REJECTED : human rejects
  DRAFTED --> EXPIRED : TTL passes (Phase 6+)

  APPROVED --> EXECUTED : skill.execute success
  APPROVED --> FAILED : skill.execute throws

  EDITED --> EXECUTED
  EDITED --> FAILED

  AUTO_APPROVED --> EXECUTED : ✓ current
  AUTO_APPROVED --> FAILED : ✓ current

  EXECUTED --> [*]
  FAILED --> [*]
  REJECTED --> [*]
  EXPIRED --> [*]
```

**Currently exercised:** `[*] → AUTO_APPROVED → EXECUTED` (happy path) and `[*] → AUTO_APPROVED → FAILED` (error path).

**Unexercised (waiting on customer-facing connectors + web UI):** the `DRAFTED` branch + `APPROVED` / `EDITED` / `REJECTED` / `EXPIRED` transitions. Schema is ready; no writers yet for these states.

---

## 8. Boot sequence

```mermaid
sequenceDiagram
  participant Process as Node process
  participant Env as lib/env
  participant Hono
  participant DB as Postgres
  participant SkillReg as skills/registry
  participant TmplReg as templates/registry
  participant Disp as main-dispatcher

  Process->>Env: parseEnv() — Zod
  Note over Env: throws on missing DATABASE_URL, REDIS_URL,<br/>TELEGRAM_*, AI_GATEWAY_API_KEY, R2_*

  Process->>Disp: import (eager) → createDispatcher(env.DISPATCH_MODE)
  Note over Disp: singleton instantiated at module load

  Process->>Hono: mount middleware + routes
  Process->>SkillReg: await syncSkills(prisma)
  SkillReg->>DB: upsert all Skill rows (Zod → JSON Schema for parametersJsonSchema)
  Process->>TmplReg: await syncTemplates(prisma)
  TmplReg->>TmplReg: validateCanDelegateTo (acyclic + integrity)
  Note over TmplReg: ABORTS BOOT if cycle or unknown slug
  TmplReg->>DB: upsert all AgentTemplate rows + M:N skill links

  Process->>Process: serve(app, port: 4000)
  Process->>Process: SIGTERM / SIGINT handlers wired
  Process-->>Process: ready
```

**Implication for changes to templates/skills:** they take effect on next boot. Adding a new skill = code + Zod schema + register + restart. The DB rows are always derived from code, never edited by hand.

---

## 9. The seams (visual)

Single-writer / single-reader audit, expressed as a diagram of who reaches what.

```mermaid
flowchart LR
  subgraph Writers
    apply["knowledge/apply.ts<br/>applySoulUpdate"]
    brand_asset["knowledge/brand-asset.ts<br/>ingestBrandAsset<br/>ingestGeneratedAsset"]
    label_skill["agents/skills/label-brand-asset.ts"]
    ensure["agents/agent-instance.ts<br/>ensureAgentInstance"]
    record["agents/actions.ts<br/>recordAgentAction"]
    sync_skills["agents/skills/registry.ts<br/>syncSkills"]
    sync_tmpls["agents/templates/registry.ts<br/>syncTemplates"]
  end

  subgraph Tables[("Postgres tables")]
    org_bp["Organization.businessProfile"]
    ba_create["BrandAsset (insert)"]
    ba_update["BrandAsset.metadata (update)"]
    ai_table["AgentInstance"]
    aa_table["AgentAction"]
    sk_table["Skill"]
    tmpl_table["AgentTemplate"]
  end

  subgraph Readers
    provider["knowledge/provider.ts<br/>getBusinessContext"]
    brand_ctx["knowledge/brand-context.ts<br/>getBrandContext"]
    runtime_r["agents/runtime.ts<br/>(via context loaders)"]
  end

  apply --> org_bp
  brand_asset --> ba_create
  label_skill --> ba_update
  ensure --> ai_table
  record --> aa_table
  sync_skills --> sk_table
  sync_tmpls --> tmpl_table

  org_bp --> provider
  ba_create --> brand_ctx
  ba_update --> brand_ctx
  provider --> runtime_r
  brand_ctx --> runtime_r

  classDef wr fill:#ffcdd2,stroke:#c62828
  classDef tb fill:#d7ccc8,stroke:#5d4037
  classDef rd fill:#c8e6c9,stroke:#2e7d32
  class apply,brand_asset,label_skill,ensure,record,sync_skills,sync_tmpls wr
  class org_bp,ba_create,ba_update,ai_table,aa_table,sk_table,tmpl_table tb
  class provider,brand_ctx,runtime_r rd
```

**Audit commands (should hold true):**
```bash
grep -rn "businessProfile" apps/api/src       # only knowledge/apply.ts + knowledge/provider.ts
grep -rn "brandAsset.create" apps/api/src     # only knowledge/brand-asset.ts
grep -rn "brandAsset.update" apps/api/src     # only agents/skills/label-brand-asset.ts
grep -rn "agentInstance.upsert" apps/api/src  # only agents/agent-instance.ts
grep -rn "as Skill<" apps/api/src             # NOTHING (defineSkill killed the cast)
```

---

## 10. Gaps vs. spec (visualized)

What's planned but not built (the work plan addresses these).

```mermaid
flowchart TB
  subgraph Done["✅ Built"]
    a1["Phase 5a — schema"]
    a2["Phase 5b — skills extraction"]
    a3["Phase 5c — generic runtime + Designer"]
    a4["Phase 5d — Controller + delegateToSpecialist"]
    a5["Phase 5e — Marketing Strategist"]
    a6["Phase KR — Knowledge Registry (bonus)"]
    a7["Phase 5f — AgentAction + cost"]
    a8["Phase 5g — BullMQ dispatcher + worker"]
    a9["Phase 5h — per-org connector route (partial)"]
    a10["Controller pivot to briefing-gatherer"]
  end

  subgraph Gap["⚠️ Partial / Gap"]
    g1["AgentConnectorBinding direction<br/>does NOT gate inbound routing yet<br/>(Controller hard-coded)"]
    g2["Legacy /telegram/webhook still mounted<br/>alongside /connectors/telegram/:id/webhook"]
    g3["TelegramLink table still present<br/>(fallback lookup in ingest)"]
    g4["AgentAction.triggerMessageId<br/>+ parentActionId — schema only<br/>(no writers)"]
    g5["connectors/&lt;type&gt;/adapter.ts layer<br/>NEVER BUILT<br/>(Telegram goes via Chat SDK directly)"]
  end

  subgraph Next["🚀 Work plan (this restructure)"]
    n1["Group 1.1 — Wire AgentConnectorBinding<br/>direction to inbound routing"]
    n2["Group 1.2 — Delete old route + TelegramLink<br/>(Phase 5i cleanup)"]
    n3["Group 1.3 — Connector adapter scaffold<br/>(connectors/types + telegram adapter)"]
    n4["Group 2.1 — Reserved files<br/>(Organization.agentInstructions + businessIdea)"]
    n5["Group 2.2 — Dispatcher coalescing<br/>by (connectorInstanceId, threadExtId)"]
    n6["Group 2.3 — AgentSkillEnablement join<br/>(replace enabledSkillIds array)"]
  end

  g1 --> n1
  g2 --> n2
  g3 --> n2
  g5 --> n3

  classDef done fill:#c8e6c9,stroke:#2e7d32
  classDef gap fill:#fff9c4,stroke:#fbc02d
  classDef next fill:#bbdefb,stroke:#1565c0
  class a1,a2,a3,a4,a5,a6,a7,a8,a9,a10 done
  class g1,g2,g3,g4,g5 gap
  class n1,n2,n3,n4,n5,n6 next
```

---

## 11. Where to look next

- Prose architecture: `docs/ARCHITECTURE.md` (HEAD `8371163`-era, pre-Controller-pivot — will be updated after the restructure lands)
- Phase 5 spec: `docs/superpowers/specs/2026-05-20-qolmeia-multi-agent-architecture-design.md`
- Research informing the upcoming restructure: `docs/research/2026-05-20-paperclip-and-multica.md`
- Test bar: 140 tests, oxlint 0/0, oxfmt clean, `pnpm fallow:dead` clean
