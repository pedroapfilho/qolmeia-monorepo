# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Commands

```bash
# Development
pnpm dev                                 # turbo runs all four apps in parallel
pnpm dev --filter=auth                   # auth service (Hono, https://qolmeia.auth.localhost via portless)
pnpm dev --filter=worker-bees            # Cloudflare Worker (wrangler dev, :8787)
pnpm dev --filter=client                 # customer app (Next.js, https://qolmeia.client.localhost)
pnpm dev --filter=backoffice             # operator panel (Next.js, https://qolmeia.backoffice.localhost)

# Build / Lint / Typecheck
pnpm build                        # all packages + apps (turbo cached)
pnpm lint                         # oxlint
pnpm typecheck                    # tsc --noEmit + wrangler types for agents
pnpm format                       # oxfmt (write)
pnpm format:check                 # oxfmt (check only, used in CI)

# Testing
pnpm test                         # vitest unit tests across all packages

# Database (Prisma — used only by the auth service; agents Worker uses D1)
pnpm db:generate                  # generate Prisma client
pnpm db:push                      # push schema to Postgres
```

## Architecture

Monorepo managed by pnpm workspaces + Turborepo. Node 24, pnpm 10. Mid-migration from a Node/Postgres/Redis monolith to a Cloudflare-native runtime — current state below.

### Apps

| Folder            | Package name  | Framework         | Dev URL                                           | Audience                                                                                                                            |
| ----------------- | ------------- | ----------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/auth`       | `auth`        | Hono on Node 24   | `https://qolmeia.auth.localhost` (portless)       | Auth service — `/api/auth/*` (Better Auth) + `/api/v1/me` (relay target).                                                           |
| `apps/agents`     | `worker-bees` | Cloudflare Worker | `http://localhost:8787` (wrangler dev)            | Customer chat (WebSocket), provider webhooks, REST for operators (`/api/backoffice/*`) and customers (`/api/me/*`, `/api/teams/*`). |
| `apps/client`     | `client`      | Next.js 16        | `https://qolmeia.client.localhost` (portless)     | End-customer chat surface — CUSTOMER role.                                                                                          |
| `apps/backoffice` | `backoffice`  | Next.js 16        | `https://qolmeia.backoffice.localhost` (portless) | Operator panel — OWNER/STAFF roles.                                                                                                 |

The browser never talks to `:8787` directly in dev: each Next app rewrites the Worker's surface to itself (`/api/backoffice/*` on backoffice; `/api/me/*`, `/api/teams/*`, and the `/agents/*` chat WebSocket on client) so the Better Auth cookie stays first-party — `.localhost` hosts are a public suffix, so no cookie can span `qolmeia.client.localhost` and `localhost:8787`. Server-side code reaches the Worker via `AGENTS_INTERNAL_URL` (default `http://127.0.0.1:8787`); `NEXT_PUBLIC_AGENTS_URL` is only for a cross-origin prod Worker.

### Key runtime moves (P1–P7)

- **Per-tenant agents are Durable Objects**: `CorrespondentAgent`, `WorkerAgent`, `PlannerAgent` (one DO instance per company id).
- **Approvals run on Workflows**: every Worker job spawns a `WorkerJobWorkflow`; gated actions pause on `waitForEvent("decision:<actionId>")` until an operator decides via `/api/backoffice/actions/:id/decide`.
- **D1 is the system of record for product data**: `company`, `ticket`, `action`, `activity_log`, `agent_instance`, `template`, `skill`, `team`, `team_member`, `memory_fact`, `connector`, `webhook_event`, `asset`. Schema in `apps/agents/migrations/*.sql`.
- **R2 holds binary assets** (`ASSETS` binding), served via HMAC-signed URLs from `/assets/:id`.
- **KV holds connector secrets** (`CONNECTOR_SECRETS` binding) so Telegram/etc. configs don't sit in env vars.
- **Postgres remains** for Better Auth's tables only. Legacy product models still exist in `packages/db/prisma/schema.prisma` but are unused by `agents`.

### Packages

| Package                   | Purpose                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `@repo/auth`              | `createAuth` factory wrapping Better Auth (magic-link + email/password). Consumed by `auth`, `backoffice`, `client`. |
| `@repo/db`                | Prisma client singleton + schema (auth-only domain).                                                                 |
| `@repo/transactional`     | React Email templates + Resend sender.                                                                               |
| `@repo/ui`                | shadcn-style component library + Tailwind preset shared by the two Next apps.                                        |
| `@repo/config-vitest`     | Shared Vitest config.                                                                                                |
| `@repo/typescript-config` | Shared tsconfig bases.                                                                                               |

### The canonical E2E flow

1. **Sign-up / magic-link** — Better Auth on `apps/auth` issues a cookie scoped to `localhost`.
2. **Client opens** — `requireCustomer` → `apps/agents/api/me` (relays to `apps/auth/api/v1/me` for membership).
3. **status === "onboarding"** — chat against `/agents/planner/<companyId>`. Planner calls `extractBrief` and `proposeTeam`, then surfaces a "Confirmar Time" button.
4. **Customer confirms** — `POST /api/teams/:companyId/confirm` materialises `team` + `team_member`, flips `company.status = 'active'`, and seeds Correspondent memory.
5. **status === "active"** — chat against `/agents/correspondent/<companyId>`. Correspondent uses `delegateToWorker` to spawn child tickets; Worker DO instantiates a `WorkerJobWorkflow`.
6. **Workflow proposes a `require-approval` action** — injects a 🟡 message via Correspondent, then `waitForEvent("decision:<actionId>")`.
7. **Operator on `apps/backoffice`** — `requireStaff` → `/approvals` lists pending oldest-first → `/approvals/:id` shows the decide form → POST `/api/backoffice/actions/:id/decide` resumes the Workflow.
8. **Workflow executes** — side-effect (e.g. `generateBrandImage` → R2 → signed URL) → marks the action `executed` and ticket `done` → Correspondent renders the result in chat (markdown, so images appear inline).

## Tooling

- **Linter**: oxlint (NOT ESLint). Config in `oxlint.config.ts`.
- **Formatter**: oxfmt (NOT Prettier). Config in `.oxfmtrc.json`. Sorts imports.
- **Pre-commit**: Husky + lint-staged runs `oxlint` + `oxfmt`.
- **Testing**: Vitest. `apps/agents` uses `@cloudflare/vitest-pool-workers` against Miniflare.
- **Bundler (auth)**: tsdown. **Bundler (agents)**: wrangler.

## Environment

Each app has its own `.env.example`:

- **apps/auth** — `DATABASE_URL`, `BETTER_AUTH_SECRET`, `CORS_ORIGINS` (must be explicit — Better Auth refuses `*` for cross-origin cookies), optional `RESEND_API_KEY`, `AUTH_FROM_EMAIL`.
- **apps/agents** — `.dev.vars` (not `.env`). Holds `OPENROUTER_API_KEY` and `ASSETS_SIGNING_KEY`. `wrangler.jsonc` defines the rest in its `vars` block (`CORRESPONDENT_MODEL`, `IMAGE_GEN_MODEL`, `AUTH_SERVICE_URL`, `WORKER_PUBLIC_URL`, `CLIENT_ORIGINS`).
- **apps/client** — `BETTER_AUTH_SECRET` (matches `apps/auth`), `DATABASE_URL` (Next `proxy.ts` validates sessions via Prisma). Auth and the agents Worker are same-origin: `next.config.ts` rewrites `/api/auth/*` to `AUTH_SERVICE_INTERNAL_URL` (default `http://127.0.0.1:4000`) and `/api/me/*` + `/api/teams/*` + `/agents/*` to `AGENTS_INTERNAL_URL` (default `http://127.0.0.1:8787`); `NEXT_PUBLIC_AUTH_URL` / `NEXT_PUBLIC_AGENTS_URL` only override for cross-origin prod deployments.
- **apps/backoffice** — same as client (its Worker rewrite covers `/api/backoffice/*`).

`.env` files are git-ignored; `.env.example` is committed.

## Local development

Bring the stack up (assumes envs are copied from each `.env.example`):

```bash
# 1. Postgres on :5436 (Redis on :6382 is unused but still in compose)
docker compose up -d

# 2. Push the auth-only Prisma schema
DATABASE_URL=postgresql://qolmeia:qolmeia123@localhost:5436/qolmeia \
  pnpm --filter=@repo/db db:push

# 3. Seed Postgres — creates the dev org + OWNER + CUSTOMER users (idempotent)
pnpm --filter=auth exec tsx src/scripts/seed-dev.ts

# 4. Apply D1 migrations + seed the company row, Correspondent + Designer worker
cd apps/agents
pnpm wrangler d1 migrations apply worker-bees --local
pnpm wrangler d1 execute worker-bees --local --file scripts/seed-p2.sql
pnpm wrangler d1 execute worker-bees --local --file scripts/seed-p3-team.sql
cd -

# 5. Run all four apps (or one per terminal with --filter)
pnpm dev
```

**Seeded dev credentials** (created by `apps/auth/src/scripts/seed-dev.ts`):

| Surface                                             | Role     | Email                  | Password                    |
| --------------------------------------------------- | -------- | ---------------------- | --------------------------- |
| Backoffice — `https://qolmeia.backoffice.localhost` | OWNER    | `operator@qolmeia.dev` | `Qolmeia-Dev-OperatorPass!` |
| Client — `https://qolmeia.client.localhost`         | CUSTOMER | `customer@qolmeia.dev` | `Qolmeia-Dev-CustomerPass!` |

The dev org is pinned to `cmpg10ke30000147uj4gpeadb` (slug `qolmeia-dev`) so it matches the D1 seed in `apps/agents/scripts/seed-p2.sql`. The client login is magic-link only; the password above only works on the backoffice. Watch `apps/auth` logs for the magic link in dev.

## Conventions

- Path aliases: `@/*` → `src/*` in every app + package.
- pt-BR is the user-facing locale across agents, backoffice, and client.
- Activity-log `type` strings are stable and free-form; the backoffice categorises by prefix (`ACTION_*`, `TICKET_*`, `WORKER_*`, `TEAM_*`, `MEMBER_*`).
- Operator REST lives at `apps/agents/api/backoffice/*` (OWNER/STAFF only). Customer REST at `apps/agents/api/me/*` and `apps/agents/api/teams/*`.
- Agent paths at `/agents/<name>/<companyId>` are gated to CUSTOMER role. Operators don't open WebSockets to a DO; they call REST.
- Turbo caches: be conscious that `apps/agents` reads `wrangler.jsonc` vars at build time.
