# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Commands

```bash
# Development
pnpm dev                                 # turbo runs all four apps in parallel
pnpm dev --filter=api                   # api service (Hono, https://qolmeia.api.localhost via portless)
pnpm dev --filter=worker-bees            # Cloudflare Worker (vite dev, 127.0.0.1:8787)
pnpm dev --filter=web                 # customer app (Next.js, https://qolmeia.web.localhost)
pnpm dev --filter=backoffice             # operator panel (Next.js, https://qolmeia.backoffice.localhost)

# Build / Lint / Typecheck
pnpm build                        # all packages + apps (turbo cached)
pnpm lint                         # oxlint
pnpm typecheck                    # tsc --noEmit + wrangler types for agents
pnpm format                       # oxfmt (write)
pnpm format:check                 # oxfmt (check only, used in CI)

# Testing
pnpm test                         # vitest unit tests across all packages

# Database (Prisma/Postgres, shared by api and agents)
pnpm db:generate                  # generate Prisma client
pnpm db:push                      # push schema to Postgres
pnpm --filter=@repo/db db:seed    # seed the default template and skill catalog
```

## Architecture

Monorepo managed by pnpm workspaces + Turborepo. Node 24, pnpm 10. Mid-migration from a Node/Postgres/Redis monolith to a Cloudflare-native runtime; current state below.

### Apps

| Folder            | Package name  | Framework         | Dev URL                                           | Audience                                                                                                                            |
| ----------------- | ------------- | ----------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`        | `api`         | Hono on Node 24   | `https://qolmeia.api.localhost` (portless)        | General API service: auth (`/api/auth/*` Better Auth) + `/api/v1/me` (relay target); home for future non-agent management features. |
| `apps/agents`     | `worker-bees` | Cloudflare Worker | `http://127.0.0.1:8787` (vite dev)                | Customer chat (Flue HTTP+SSE), REST for operators (`/api/backoffice/*`) and customers (`/api/me/*`, `/api/teams/*`).                |
| `apps/web`        | `web`         | Next.js 16        | `https://qolmeia.web.localhost` (portless)        | End-customer chat surface (CUSTOMER role).                                                                                          |
| `apps/backoffice` | `backoffice`  | Next.js 16        | `https://qolmeia.backoffice.localhost` (portless) | Operator panel (OWNER/STAFF roles).                                                                                                 |
| `apps/landing`    | `landing`     | Next.js 16        | `https://qolmeia.landing.localhost` (portless)    | Public marketing site. No auth, no Worker calls.                                                                                    |

The browser never talks to `:8787` directly in dev: each Next app rewrites the Worker's surface to itself (`/api/backoffice/*` on backoffice; `/api/me/*`, `/api/teams/*`, and the `/agents/*` chat HTTP+SSE on client) so the Better Auth cookie stays first-party: `.localhost` hosts are a public suffix, so no cookie can span `qolmeia.web.localhost` and `localhost:8787`. Server-side code reaches the Worker via `AGENTS_INTERNAL_URL` (default `http://127.0.0.1:8787`); `NEXT_PUBLIC_AGENTS_URL` is only for a cross-origin prod Worker.

### Key runtime moves (P1–P7)

- **Per-tenant agents are Durable Objects**: `CorrespondentV2` and `PlannerV2` in `src/agents/` are `'use agent'`
  modules whose exported function names generate `FlueCorrespondentV2Agent` / `FluePlannerV2Agent` (one DO
  instance per company id). Renaming a function changes its storage identity unless pinned with `agentName`.
  Both are mounted explicitly in `app.ts` via `createAgentRouter`, behind `requireCustomerAgent` middleware.
- **Approvals run on Workflows**: every Worker job spawns a `WorkerJobWorkflow`; gated actions pause on `waitForEvent("decision:<actionId>")` until an operator decides via `/api/backoffice/actions/:id/decide`.
- **Postgres is the system of record for auth and product data**, accessed through Prisma from both `apps/api` and the agents Worker. Schema in `packages/db/prisma/schema.prisma`.
- **R2 holds binary assets** (`ASSETS` binding), served via HMAC-signed URLs from `/assets/:id`.
- **KV holds a session-validation cache** (`SESSIONS` binding) to keep the auth service off the hot path.

### Packages

| Package                   | Purpose                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@repo/auth`              | `createAuth` factory wrapping Better Auth (magic-link + email/password). Consumed by `api`, `backoffice`, `web`. |
| `@repo/db`                | Prisma schema plus Node and Cloudflare Worker client entry points.                                               |
| `@repo/transactional`     | React Email templates + Resend sender.                                                                           |
| `@repo/ui`                | shadcn-style component library + Tailwind preset shared by the two Next apps.                                    |
| `@repo/config-vitest`     | Shared Vitest config.                                                                                            |
| `@repo/typescript-config` | Shared tsconfig bases.                                                                                           |
| `@repo/app-shell`         | Next-side auth/session glue shared by `web` and `backoffice`: `./auth-client`, `./auth-server`, `./session`, `./agents-url`. |
| `@repo/worker-api`        | Typed client for the agents Worker plus its request/response contracts (`./contracts`, `./brief`, `./internal`). |
| `@repo/internal-auth`     | Constant-time bearer-token check guarding Worker-to-service internal routes.                                     |
| `@repo/observability`     | Structured logging. Exports `./client`, `./fields`, `./next`, `./next/instrumentation`, `./hono`.                |
| `@repo/portless-env`      | `applyPortlessUrls`: fills dev URL env vars from `portless get`.                                                 |

### The canonical E2E flow

1. **Sign-up / magic-link**: Better Auth on `apps/api` issues a cookie scoped to `localhost`.
2. **Client opens**: `requireCustomer` → `GET /api/me` on `apps/agents`, which relays to `GET /api/me` on `apps/api` (`AUTH_SERVICE_URL`) for membership.
3. **status === "onboarding"**: chat against `/agents/planner/<companyId>`. Planner calls `extractBrief` and `proposeTeam`, then surfaces a "Confirmar Time" button.
4. **Customer confirms**: `POST /api/teams/:companyId/confirm` materialises `team` + `team_member`, flips `company.status = 'active'`, and seeds Correspondent memory.
5. **status === "active"**: chat against `/agents/correspondent/<companyId>`. Correspondent uses `delegateToWorker` to spawn child tickets, each of which instantiates a `WorkerJobWorkflow` (the deliverable is generated with `generateText`, not a Flue agent).
6. **Workflow proposes a `require-approval` action**: injects a 🟡 message via Correspondent, then `waitForEvent("decision:<actionId>")`.
7. **Operator on `apps/backoffice`**: `requireStaff` → `/approvals` lists pending oldest-first → `/approvals/:id` shows the decide form → POST `/api/backoffice/actions/:id/decide` resumes the Workflow.
8. **Workflow executes**: side-effect (e.g. `generateBrandImage` → R2 → signed URL) → marks the action `executed` and ticket `done` → dispatches a `worker.deliverable_ready` **signal** to Correspondent, which renders the result in chat (markdown, so images appear inline). Internal dispatches must be signals: Flue marks them `display: "diagnostic"` so the prompt itself stays out of the customer's transcript, and the client filters on that field.

## Tooling

- **Linter**: oxlint (NOT ESLint). Config in `oxlint.config.ts`.
- **Formatter**: oxfmt (NOT Prettier). Config in `.oxfmtrc.json`. Sorts imports.
- **Pre-commit**: Husky + lint-staged runs `oxlint` + `oxfmt`.
- **Testing**: Vitest. `apps/agents` uses `@cloudflare/vitest-pool-workers` against Miniflare.
- **Bundler (api)**: tsdown. **Bundler (agents)**: Vite, via `@flue/vite` + `@cloudflare/vite-plugin`. The
  Worker entry and the per-agent Durable Object bindings are generated (`.flue-vite/`,
  `.flue-vite.wrangler.jsonc`); `wrangler.jsonc` has no `main`. Deploy is `vite build && wrangler deploy`.

## Environment

Each app has its own `.env.example`:

- **apps/api**: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `CORS_ORIGINS` (must be explicit; Better Auth refuses `*` for cross-origin cookies), optional `RESEND_API_KEY`, `AUTH_FROM_EMAIL`.
- **apps/agents**: `.dev.vars` (not `.env`). Holds `DATABASE_URL`, `OPENROUTER_API_KEY`, and `ASSETS_SIGNING_KEY`. `wrangler.jsonc` defines the rest in its `vars` block (`CORRESPONDENT_MODEL`, `IMAGE_GEN_MODEL`, `AUTH_SERVICE_URL`, `WORKER_PUBLIC_URL`, `CLIENT_ORIGINS`).
- **apps/web**: `BETTER_AUTH_SECRET` (matches `apps/api`), `DATABASE_URL` (Next `proxy.ts` validates sessions via Prisma). Auth and the agents Worker are same-origin: `next.config.ts` rewrites `/api/auth/*` to `AUTH_SERVICE_INTERNAL_URL` (default `http://127.0.0.1:4000`) and `/api/me/*` + `/api/teams/*` + `/agents/*` to `AGENTS_INTERNAL_URL` (default `http://127.0.0.1:8787`); `NEXT_PUBLIC_AUTH_URL` / `NEXT_PUBLIC_AGENTS_URL` only override for cross-origin prod deployments.
- **apps/backoffice**: same as client (its Worker rewrite covers `/api/backoffice/*`).

`.env` files are git-ignored; `.env.example` is committed.

## Local development

Bring the stack up (assumes envs are copied from each `.env.example`):

```bash
# 1. Postgres on :5436 (Redis on :6382 is unused but still in compose)
docker compose up -d

# 2. Push the shared Prisma schema
DATABASE_URL=postgresql://qolmeia:qolmeia123@localhost:5436/qolmeia \
  pnpm --filter=@repo/db db:push

# 3. Seed Postgres: creates auth users, product company, catalog, and team (idempotent)
pnpm --filter=api exec tsx src/scripts/seed-dev.ts

# 4. Run all five apps (or one per terminal with --filter)
pnpm dev
```

**Seeded dev credentials** (created by `apps/api/src/scripts/seed-dev.ts`):

| Surface                                            | Role     | Email                  | Password                    |
| -------------------------------------------------- | -------- | ---------------------- | --------------------------- |
| Backoffice: `https://qolmeia.backoffice.localhost` | OWNER    | `operator@qolmeia.dev` | `Qolmeia-Dev-OperatorPass!` |
| Client: `https://qolmeia.web.localhost`            | CUSTOMER | `customer@qolmeia.dev` | `Qolmeia-Dev-CustomerPass!` |

The dev org is pinned to `cmpg10ke30000147uj4gpeadb` (slug `qolmeia-dev`). The client login is magic-link only; the password above only works on the backoffice. Watch `apps/api` logs for the magic link in dev.

App configs resolve those URLs through `@repo/portless-env` rather than hardcoding them. `applyPortlessUrls({ ENV_VAR: ["<subdomain>"] })` runs at the top of each `next.config.ts` / `tsdown.config.ts` and shells out to `portless get` for every name, filling the env var only when it is unset or still holds the canonical `*.localhost` default. It is a no-op unless `PORTLESS_URL` is set, so CI and production keep their real values. Import it by bare specifier (`@repo/portless-env`): a relative path resolves from the process cwd and breaks `next start apps/web` from the repo root.

## Conventions

- Path aliases: `@/*` → `src/*` in every app + package.
- pt-BR is the user-facing locale across agents, backoffice, and client.
- Activity-log `type` strings are stable and free-form; the backoffice categorises by prefix (`ACTION_*`, `TICKET_*`, `WORKER_*`, `TEAM_*`, `MEMBER_*`).
- Operator REST lives at `apps/agents/api/backoffice/*` (OWNER/STAFF only). Customer REST at `apps/agents/api/me/*` and `apps/agents/api/teams/*`.
- Agent paths at `/agents/<name>/<companyId>` are gated to CUSTOMER role. Operators don't open WebSockets to a DO; they call REST.
- Turbo caches: be conscious that `apps/agents` reads `wrangler.jsonc` vars at build time.
