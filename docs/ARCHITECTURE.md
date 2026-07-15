# Qolmeia: Architecture Overview

_Current as of the Flue agent migration (2026-06). Supersedes the prior revision, which described the retired Node/Postgres monolith._

## §1. What Qolmeia is

Qolmeia is a **vertical-agnostic agent platform sold as a product**: a customer signs up, is interviewed by an onboarding agent, confirms a "Team" of specialist agents, and from then on chats with a single point-of-contact agent that delegates real work to those specialists. High-impact actions pause for an internal operator to approve before they execute. The first vertical shipped is a marketing agency (Designer, Marketing Strategist, Redator, SEO Researcher); the platform is built to host other verticals (e.g. Cobrança) without code forks; see [ADR 0009](adr/0009-vertical-agnostic-agent-platform.md).

User-facing locale is **pt-BR** across every agent and UI.

## §2. The system at a glance

```
                 ┌─────────────────────────┐        ┌──────────────────────────┐
  CUSTOMER ─────▶│ apps/client  (Next 16)  │        │ apps/backoffice (Next 16)│◀──── OWNER / STAFF
                 │ :3001  chat surface     │        │ :3000  operator panel    │
                 └───────────┬─────────────┘        └────────────┬─────────────┘
                  rewrites    │ same-origin (first-party cookie)  │ rewrites
        /api/me, /api/teams,  │                                   │ /api/backoffice/*
        /agents/* (HTTP+SSE)  │                                   │
                 ┌───────────▼───────────────────────────────────▼─────────────┐
                 │  apps/agents  -  "worker-bees"  (Cloudflare Worker, Flue)     │
                 │  :8787                                                         │
                 │   • Flue agents (DOs): Planner · Correspondent · Worker        │
                 │   • WorkerJobWorkflow (Cloudflare Workflow, approval gate)    │
                 │   • REST: /api/me /api/teams /api/backoffice /assets          │
                 │   • bindings: D1 · R2 · KV · (Vectorize) · Workflows           │
                 └───────────┬───────────────────────────────┬──────────────────┘
                             │ /api/v1/me (membership)        │
                 ┌───────────▼─────────────┐                  ▼
                 │ apps/api  (Hono/Node 24) │           D1 · R2 · KV · Vectorize
                 │ :4000  Better Auth       │           (product system of record)
                 │ + Postgres (auth only)   │
                 └─────────────────────────┘
```

Four deployables, one Turborepo. The **agents Worker is the live product runtime**; `apps/api` exists for authentication and future non-agent management features. The browser never talks to `:8787` directly; each Next app rewrites the Worker's surface onto itself so the Better Auth cookie stays first-party (`.localhost` is a public suffix, so no cookie can span `qolmeia.client.localhost` and `localhost:8787`).

## §3. Repo layout

Monorepo: pnpm 11 workspaces + Turborepo, Node 24.

### Apps

| Folder            | Package       | Framework         | Port / dev URL                           | Audience                |
| ----------------- | ------------- | ----------------- | ---------------------------------------- | ----------------------- |
| `apps/api`        | `api`         | Hono on Node 24   | `:4000` · `qolmeia.api.localhost`        | Auth + `/api/v1/me`     |
| `apps/agents`     | `worker-bees` | Cloudflare Worker | `:8787` (`flue dev`)                     | The product runtime     |
| `apps/client`     | `client`      | Next.js 16        | `:3001` · `qolmeia.client.localhost`     | Customers (CUSTOMER)    |
| `apps/backoffice` | `backoffice`  | Next.js 16        | `:3000` · `qolmeia.backoffice.localhost` | Operators (OWNER/STAFF) |

### Packages

| Package                   | Purpose                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| `@repo/auth`              | `createAuth` factory over Better Auth (magic-link + email/password).          |
| `@repo/db`                | Prisma client + schema for the **auth-only** Postgres domain.                 |
| `@repo/transactional`     | React Email templates + Resend sender.                                        |
| `@repo/ui`                | shadcn-style component library + Tailwind preset shared by the two Next apps. |
| `@repo/observability`     | Structured logging helpers.                                                   |
| `@repo/config-vitest`     | Shared Vitest config.                                                         |
| `@repo/config-typescript` | Shared tsconfig bases (`moduleResolution: Bundler`).                          |

## §4. Runtime topology & data stores

The agents Worker owns all product data. Each store has a single purpose:

| Store         | Binding                      | Holds                                                                                                  |
| ------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| **D1**        | `DB`                         | The product system of record (see §5). SQLite at the edge.                                             |
| **R2**        | `ASSETS`                     | Binary assets (generated images, uploads, brand files), served via HMAC-signed `/assets/:id` URLs.     |
| **KV**        | `SESSIONS`                   | A 30s session-validation cache (keeps the auth service off the hot path).                              |
| **Vectorize** | `VECTORIZE` (prod, optional) | Embeddings for long-term agent memory recall. Falls back to an in-process store when unprovisioned.    |
| **Postgres**  | (in `apps/api`)              | **Better Auth tables only**: users, sessions, accounts, verification, org membership. No product data. |
| **Workflows** | `WORKER_JOB`                 | `WorkerJobWorkflow` runs: the durable approval/execution loop for delegated work.                      |

## §5. Data model (D1)

Schema in [`apps/agents/migrations/*.sql`](../apps/agents/migrations); a squashed `0001_schema.sql` baseline (schema only) plus `0002_default_data.sql` (the skill-overlay catalog + the 4 default worker templates). Core tables:

| Table                  | Purpose                                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `company`              | The tenant. `status: onboarding \| active`, `brief` (JSON, the AI-extracted business soul), slug, locale, timezone.                                                         |
| `template`             | System-defined agent blueprint. `worker_kind`, `system_prompt`, `model` (OpenRouter id), `skill_ids`, `default_action_type`, `default_policies`, `status`. Seeded from SQL. |
| `agent_instance`       | A hired agent for a company. `role: correspondent \| worker`, `template_id`, `prompt_override?`, `status`. One Correspondent per active company; N workers.                 |
| `team` / `team_member` | The confirmed roster. `team_member.can_delegate_to` (JSON) encodes the delegation graph.                                                                                    |
| `ticket`               | A unit of delegated work. `status: open \| in_progress \| awaiting_approval \| done`, `origin`, `brief`, `workflow_id`, `result`.                                           |
| `action`               | A gated side-effect proposed by a Worker. `status: proposed \| executed \| …`, `action_type`, `payload`, decision fields. The backoffice approval card.                     |
| `memory_fact`          | Long-term agent memory. `kind`, `content`, mirrored into Vectorize for recall.                                                                                              |
| `asset`                | R2 object metadata. `kind` (`generated_image`/`brand_asset`/`user_upload`/`knowledge_doc`/`audio`), `mime`, `size`, visibility, folder.                                     |
| `activity_log`         | Append-only pt-BR timeline. `type` strings are stable, free-form; the backoffice categorises by prefix (`ACTION_*`, `TICKET_*`, `WORKER_*`, `TEAM_*`, `MEMBER_*`).          |
| `operator_assignment`  | Which operator owns which company's approvals.                                                                                                                              |

[ADR 0002](adr/0002-d1-system-of-record.md) covers why D1 (not Postgres) is the product system of record.

## §6. The agent layer (Flue)

All three agents run on **[Flue](https://flueframework.com)** (`@flue/runtime` 1.0.0-beta), a Claude-Code-style harness (sessions, tool loop, compaction) on Cloudflare. Each agent is a `createAgent` module under [`apps/agents/src/agents/`](../apps/agents/src/agents); the worker entry is generated by `flue build` and composes them with the REST app. ADR 0004 ("Flue rejected") is superseded by the 2026-06 decision to adopt it.

| Agent             | Instance key    | Role                                                                                                                                       |
| ----------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Planner**       | companyId       | Onboarding interview. Extracts the brief (`extractBrief`) and proposes a Team (`proposeTeam`); the customer confirms in the UI.            |
| **Correspondent** | companyId       | The customer's single point of contact once active. Uses memory, manages assets, and delegates work (`delegateToWorker`).                  |
| **Worker**        | agentInstanceId | Template-driven specialist. Model + system prompt + skill set resolved from its D1 `template` at init. Dispatch-only (never HTTP-exposed). |

**Build & discovery.** There is no `.flue/` directory; Flue falls back to the `src/` source root. Agents are discovered from `src/agents/*`; `src/app.ts` mounts the shared REST app (`src/rest-app.ts`) + `flue()`; `src/cloudflare.ts` exports the `WorkerJobWorkflow` + the `scheduled()` cron; `src/provider.ts` registers OpenRouter. The approval Workflow lives in `src/jobs/` (not `src/workflows/`, which Flue reserves for its own workflow modules). `flue build --target cloudflare` merges `wrangler.jsonc` and emits the Durable Objects (`FlueCorrespondentAgent`, `FluePlannerAgent`, `FlueWorkerAgent`, `FlueRegistry`). The repo uses Node `#/*` subpath imports (not a tsconfig path alias) so Flue's dev loader resolves them.

**Transport.** Agents are HTTP+SSE, not WebSocket:

- `POST /agents/:name/:id` with `{ "message": string, "images"?: [...] }` → `{ streamUrl, submissionId }` (202 admission, durable submission).
- `GET /agents/:name/:id` → SSE event stream; conversation events are durably stored and replayable from any offset (Durable Streams), so clients resume from checkpoints and reload full history.
- Server code reaches an agent with `dispatch({ agent, id, input })` (used for deliverable delivery and the proactive sweep).

**Auth gate.** Each conversational agent exports a `route` middleware (`requireCustomerAgent`): authenticated **CUSTOMER** only, and the `:id` path segment must equal the session's companyId (tenant isolation, [ADR 0001](adr/0001-tenant-isolation-on-agent-path.md)).

**Provider.** Models route through **OpenRouter** (a first-class provider in Flue's pi-ai layer); the key resolves from `OPENROUTER_API_KEY` in the Worker env. Model strings are `openrouter/<model>`.

## §7. Skills catalog

Skills are code modules, `{ id, description, inputSchema (zod), execute(input, ctx) }`, registered in [`apps/agents/src/skills/registry.ts`](../apps/agents/src/skills/registry.ts) and exposed to agents as Flue tools (zod → JSON Schema → Valibot in `lib/skill-tool.ts`; Flue validates tool input with Valibot only). 13 today:

`rememberFact` · `recallMemory` · `delegateToWorker` · `generateBrandImage` · `draftSocialPost` · `decideAction` · `extractBrief` · `proposeTeam` · `listAssets` · `readAsset` · `saveAsset` · `webSearch` · `fetchUrl`

A template's `skill_ids` selects which skills a Worker gets. Worker kinds seeded today: `designer`, `marketing-strategist`, `redator`, `seo-researcher`, `web`.

## §8. Delegation & the approval flow

The highest-stakes path, kept on a Cloudflare Workflow for durability ([ADR 0003](adr/0003-approval-gate-on-cloudflare-workflows.md)):

1. The Correspondent calls **`delegateToWorker`** → inserts a `ticket` and creates a **`WorkerJobWorkflow`** run directly (no Worker-DO hop).
2. The Workflow generates the deliverable using the Worker template's skills, then **proposes an `action`** (the backoffice approval card) for high-impact side-effects only ([ADR 0006](adr/0006-approval-gates-only-high-impact-actions.md)).
3. It **pauses at `step.waitForEvent("decision:<actionId>")`**: surviving DO eviction for as long as the operator takes.
4. An operator on the backoffice opens `/approvals`, decides, and `POST /api/backoffice/actions/:id/decide` resumes the Workflow.
5. On approval the side-effect runs (e.g. `generateBrandImage` → R2 → signed URL), the action is marked `executed`, the ticket `done`, and the Workflow **`dispatch()`es the result to the Correspondent**, which presents it in chat (markdown, so images render inline).

A weekly **proactive sweep** (`scheduled()` cron) gates each active company on brief-completeness + a weekly window and `dispatch()`es a "suggest next work" prompt to its Correspondent.

## §9. Channels

The customer reaches the Correspondent over the **web chat only**: the Flue agent route (`POST`/`GET /agents/correspondent/:companyId`, HTTP+SSE). There are no external messaging connectors. Flue's `channels/` convention is reserved for future inter-agent transport; nothing uses it today.

## §10. Authentication & authorization

- **Better Auth** (in `apps/api`, Postgres-backed) issues a cookie scoped to `localhost`; magic-link for customers, email/password for operators.
- **Roles** live in org membership: `OWNER` / `STAFF` (backoffice) and `CUSTOMER` (client). The agents Worker validates sessions against `apps/api` via `/api/me` (cached 30s in KV).
- **Surface guards:** `/agents/*` is CUSTOMER + tenant-checked (§6). Operator REST at `/api/backoffice/*` is OWNER/STAFF; customer REST at `/api/me/*` and `/api/teams/*`. Operators never open a socket to an agent; they act through REST. Cross-subdomain auth: [ADR 0008](adr/0008-production-topology-and-cross-subdomain-auth.md).

## §11. The canonical end-to-end flow

1. **Sign-up / magic-link**: Better Auth issues a `localhost`-scoped cookie.
2. **Client opens**: `requireCustomer` → `/api/me` (relays to `apps/api` for membership).
3. **`status === "onboarding"`**: customer chats the **Planner**; it calls `extractBrief` + `proposeTeam`, then surfaces "Confirmar Time".
4. **Customer confirms**: `POST /api/teams/:companyId/confirm` materialises `team` + `team_member`, flips `company.status = active`, seeds Correspondent memory (`seedCompanyMemory`).
5. **`status === "active"`**: customer chats the **Correspondent**, which `delegateToWorker`s.
   6–8. The **delegation + approval flow** of §8 runs; the deliverable lands back in chat.

## §12. Tooling, conventions & local dev

- **Linter** oxlint · **Formatter** oxfmt (sorts imports) · **Tests** Vitest (`apps/agents` runs on `@cloudflare/vitest-pool-workers` against Miniflare) · **Pre-commit** Husky + lint-staged.
- **Agents bundler** `flue build` (Vite/Rolldown under the hood). **api bundler** tsdown.
- **Imports** `#/*` → `src/*` (Node subpath imports) in `apps/agents`; `@/*` → `src/*` in the Next apps.
- **Client chat** uses `@flue/react` (`useFlueAgent` over the SDK's `agents.observe()`: durable history snapshot, live SSE, reconnection from checkpoints, optimistic reconcile); the SSR-safe `Chat` shell gates the hook behind a client-only flag and shows a skeleton until `historyReady`.
- **Local dev:** `docker compose up -d` (Postgres :5436), push the auth schema + seed (`apps/api`), apply D1 migrations + seeds (`apps/agents/scripts/seed-*.sql`), then `pnpm dev` (turbo runs all four; the agents Worker boots via `flue dev` on :8787). Full steps in [`docs/LOCAL_DEV.md`](LOCAL_DEV.md).

## §13. Migration status & open items

The agent layer is fully on Flue; **no legacy `AIChatAgent` Durable Objects remain**. Whole-monorepo typecheck, build, and tests are green. Deferred (tracked as TODOs in code):

- **Planner auto-open**: the onboarding chat now greets on the first customer turn rather than auto-kicking-off.
- **Live team-roster updates**: now a REST poll; the old WebSocket broadcast is retired pending an SSE/channels rebuild.

See also: [ADRs](adr) · [`AGENTS.md`](../AGENTS.md) (agent-facing build guide) · [`PRODUCT.md`](../PRODUCT.md).
