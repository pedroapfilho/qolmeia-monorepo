# Qolmeia: Architecture Overview

_Current as of the Flue 2 migration (2026-08). Supersedes the prior revision, which described the retired Node/Postgres monolith and Flue 1 runtime._

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
                 │   • Flue agents (DOs): Planner · Correspondent                 │
                 │   • WorkerJobWorkflow (Cloudflare Workflow, approval gate)     │
                 │   • REST: /api/me /api/teams /api/backoffice /assets          │
                 │   • Prisma/Postgres · R2 · KV · (Vectorize) · Workflows        │
                 └───────────┬───────────────────────────────┬──────────────────┘
                             │ /api/v1/me (membership)        │
                 ┌───────────▼─────────────┐                  ▼
                 │ apps/api  (Hono/Node 24) │           Postgres · R2 · KV · Vectorize
                 │ :4000  Better Auth       │           (shared system of record)
                 │ + Prisma/Postgres        │
                 └─────────────────────────┘
```

Four deployables, one Turborepo. The **agents Worker is the live product runtime**; `apps/api` exists for authentication and future non-agent management features. The browser never talks to `:8787` directly; each Next app rewrites the Worker's surface onto itself so the Better Auth cookie stays first-party (`.localhost` is a public suffix, so no cookie can span `qolmeia.client.localhost` and `localhost:8787`).

## §3. Repo layout

Monorepo: pnpm 11 workspaces + Turborepo, Node 24.

### Apps

| Folder            | Package       | Framework         | Port / dev URL                           | Audience                |
| ----------------- | ------------- | ----------------- | ---------------------------------------- | ----------------------- |
| `apps/api`        | `api`         | Hono on Node 24   | `:4000` · `qolmeia.api.localhost`        | Auth + `/api/v1/me`     |
| `apps/agents`     | `worker-bees` | Cloudflare Worker | `127.0.0.1:8787` (`vite dev`)            | The product runtime     |
| `apps/client`     | `client`      | Next.js 16        | `:3001` · `qolmeia.client.localhost`     | Customers (CUSTOMER)    |
| `apps/backoffice` | `backoffice`  | Next.js 16        | `:3000` · `qolmeia.backoffice.localhost` | Operators (OWNER/STAFF) |

### Packages

| Package                   | Purpose                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| `@repo/auth`              | `createAuth` factory over Better Auth (magic-link + email/password).          |
| `@repo/db`                | Prisma schema plus Node and Cloudflare Worker client entry points.            |
| `@repo/transactional`     | React Email templates + Resend sender.                                        |
| `@repo/ui`                | shadcn-style component library + Tailwind preset shared by the two Next apps. |
| `@repo/observability`     | Structured logging helpers.                                                   |
| `@repo/config-vitest`     | Shared Vitest config.                                                         |
| `@repo/typescript-config` | Shared tsconfig bases (`moduleResolution: Bundler`).                          |

## §4. Runtime topology & data stores

The agents Worker owns all product data. Each store has a single purpose:

| Store         | Binding                      | Holds                                                                                               |
| ------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| **R2**        | `ASSETS`                     | Binary assets (generated images, uploads, brand files), served via HMAC-signed `/assets/:id` URLs.  |
| **KV**        | `SESSIONS`                   | A 30s session-validation cache (keeps the auth service off the hot path).                           |
| **Vectorize** | `VECTORIZE` (prod, optional) | Embeddings for long-term agent memory recall. Falls back to an in-process store when unprovisioned. |
| **Postgres**  | `DATABASE_URL`               | Auth and product system of record, accessed through Prisma from `apps/api` and the Worker.          |
| **Workflows** | `WORKER_JOB`                 | `WorkerJobWorkflow` runs: the durable approval/execution loop for delegated work.                   |

## §5. Data model (Prisma/Postgres)

Schema in [`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma). The idempotent seed in [`packages/db/src/product-seed.ts`](../packages/db/src/product-seed.ts) owns the skill-overlay catalog and default worker templates. Core tables:

| Table                  | Purpose                                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `company`              | The tenant. `status: onboarding \| active`, `brief` (JSON, the AI-extracted business soul), slug, locale, timezone.                                                               |
| `template`             | System-defined agent blueprint. `worker_kind`, `system_prompt`, `model` (OpenRouter id), `skill_ids`, `default_action_type`, `default_policies`, `status`. Seeded through Prisma. |
| `agent_instance`       | A hired agent for a company. `role: correspondent \| worker`, `template_id`, `prompt_override?`, `status`. One Correspondent per active company; N workers.                       |
| `team` / `team_member` | The confirmed roster. `team_member.can_delegate_to` (JSON) encodes the delegation graph.                                                                                          |
| `ticket`               | A unit of delegated work. `status: open \| in_progress \| awaiting_approval \| done`, `origin`, `brief`, `workflow_id`, `result`.                                                 |
| `action`               | A gated side-effect proposed by a Worker. `status: proposed \| executed \| …`, `action_type`, `payload`, decision fields. The backoffice approval card.                           |
| `memory_fact`          | Long-term agent memory. `kind`, `content`, mirrored into Vectorize for recall.                                                                                                    |
| `asset`                | R2 object metadata. `kind` (`generated_image`/`brand_asset`/`user_upload`/`knowledge_doc`/`audio`), `mime`, `size`, visibility, folder.                                           |
| `activity_log`         | Append-only pt-BR timeline. `type` strings are stable, free-form; the backoffice categorises by prefix (`ACTION_*`, `TICKET_*`, `WORKER_*`, `TEAM_*`, `MEMBER_*`).                |
| `operator_assignment`  | Which operator owns which company's approvals.                                                                                                                                    |

[ADR 0002](adr/0002-d1-system-of-record.md) records the superseded D1 decision; the current implementation uses Postgres through Prisma.

## §6. The agent layer (Flue)

The two conversational agents run on **[Flue](https://flueframework.com)** 2 (`@flue/runtime` 2.0.0), a Claude-Code-style harness (sessions, tool loop, compaction) on Cloudflare. Each agent is a `'use agent'` function under [`apps/agents/src/agents/`](../apps/agents/src/agents). Its exported function name determines the generated Durable Object class and storage identity, so renames require an explicit `agentName` pin. ADR 0004 ("Flue rejected") is superseded by the 2026-06 decision to adopt Flue.

| Agent             | Instance key | Role                                                                                                                            |
| ----------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Planner**       | companyId    | Onboarding interview. Extracts the brief (`extractBrief`) and proposes a Team (`proposeTeam`); the customer confirms in the UI. |
| **Correspondent** | companyId    | The customer's single point of contact once active. Uses memory, manages assets, and delegates work (`delegateToWorker`).       |

Template-defined specialists are not conversational Flue agents. `delegateToWorker` creates a ticket and starts `WorkerJobWorkflow`, which resolves the specialist's Prisma template and generates the deliverable with AI SDK `generateText`.

**Build & routing.** Vite runs the `flue()` plugin before the Cloudflare plugin and merges Flue's generated entry and bindings through `flueWorkerConfig()`. [`src/app.ts`](../apps/agents/src/app.ts) mounts the REST routes and explicitly mounts `CorrespondentV2` and `PlannerV2` with `createAgentRouter`. [`src/cloudflare.ts`](../apps/agents/src/cloudflare.ts) exports `WorkerJobWorkflow`, `TeamEvents`, and the scheduled handler. `vite build` emits `FlueCorrespondentV2Agent` and `FluePlannerV2Agent` alongside those app-owned exports, while `wrangler deploy` consumes the generated deployment config. The v3 Durable Object migration deletes the reset-only Flue beta classes and creates these fresh Flue 2 identities. The approval Workflow lives in `src/jobs/`. The repo uses Node `#/*` subpath imports (not a tsconfig path alias).

**Transport.** Agents are HTTP+SSE, not WebSocket:

- `POST /agents/:name/:id` with `{ "message": string, "images"?: [...] }` → `{ streamUrl, submissionId }` (202 admission, durable submission).
- `GET /agents/:name/:id` → SSE event stream; conversation events are durably stored and replayable from any offset (Durable Streams), so clients resume from checkpoints and reload full history.
- Server code reaches an agent with `dispatch(AgentFunction, { id, message })` (used for deliverable delivery and the proactive sweep).

**Auth gate.** `src/app.ts` applies `requireCustomerAgent` before both agent routers: authenticated **CUSTOMER** only, and the `:id` path segment must equal the session's companyId (tenant isolation, [ADR 0001](adr/0001-tenant-isolation-on-agent-path.md)).

**Provider.** Models route through **OpenRouter** (a first-class provider in Flue's pi-ai layer); the key resolves from `OPENROUTER_API_KEY` in the Worker env. Model strings are `openrouter/<model>`.

## §7. Skills catalog

Skills are code modules, `{ id, description, inputSchema (zod), execute(input, ctx) }`, registered in [`apps/agents/src/skills/registry.ts`](../apps/agents/src/skills/registry.ts) and exposed to agents as Flue tools (zod → JSON Schema → Valibot in `lib/skill-tool.ts`; Flue validates tool input with Valibot only). 13 today:

`rememberFact` · `recallMemory` · `delegateToWorker` · `generateBrandImage` · `draftSocialPost` · `decideAction` · `extractBrief` · `proposeTeam` · `listAssets` · `readAsset` · `saveAsset` · `webSearch` · `fetchUrl`

A template's `skillIds` selects which tools the Workflow exposes while generating that specialist's
deliverable. Worker kinds seeded today: `designer`, `marketing-strategist`, `redator`, and
`seo-researcher`.

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
- **Agents bundler** Vite with `@flue/vite` + `@cloudflare/vite-plugin`. **api bundler** tsdown.
- **Imports** `#/*` → `src/*` (Node subpath imports) in `apps/agents`; `@/*` → `src/*` in the Next apps.
- **Client chat** uses `@flue/react` (`useFlueAgent` over the SDK's `agents.observe()`: durable history snapshot, live SSE, reconnection from checkpoints, optimistic reconcile); the SSR-safe `Chat` shell gates the hook behind a client-only flag and shows a skeleton until `historyReady`.
- **Local dev:** `docker compose up -d` (Postgres :5436), push the shared Prisma schema, run the idempotent dev seed (`apps/api`), then `pnpm dev` (turbo runs all four; the agents Worker boots via `vite dev` on `127.0.0.1:8787`). Full steps in [`docs/LOCAL_DEV.md`](LOCAL_DEV.md).

## §13. Migration status

The conversational agent layer is fully on Flue 2; **no legacy `AIChatAgent`, Flue 1 Worker agent, or Flue registry Durable Objects remain**.

- **Planner opening**: the client renders a deterministic greeting and first question immediately, without creating a synthetic user submission. The customer's answer is the first durable Flue message.
- **Live team-roster updates**: `/api/me/team/events` streams `team:status` events from the `TeamEvents` Durable Object; the client retains a 30-second polling fallback.

See also: [ADRs](adr) · [`AGENTS.md`](../AGENTS.md) (agent-facing build guide) · [`PRODUCT.md`](../PRODUCT.md).
