# Qolmeia

Monorepo for Qolmeia, a customer support and agent-orchestration product. The current runtime is split across Better Auth, two Next.js surfaces, and a Cloudflare Worker that hosts Flue agents, customer/operator REST APIs, R2 assets, and approval workflows. Auth and product state share Postgres through Prisma.

Full architecture details live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Local setup is in [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md).

## Apps

| App               | Package       | Framework         | Dev URL                                | Purpose                                               |
| ----------------- | ------------- | ----------------- | -------------------------------------- | ----------------------------------------------------- |
| `apps/api`        | `api`         | Hono on Node 24   | `https://qolmeia.api.localhost`        | Better Auth and `/api/v1/me` membership relay         |
| `apps/agents`     | `worker-bees` | Cloudflare Worker | `http://localhost:8787`                | Flue agents, Prisma/R2-backed product APIs, Workflows |
| `apps/client`     | `client`      | Next.js 16        | `https://qolmeia.client.localhost`     | Customer onboarding and chat                          |
| `apps/backoffice` | `backoffice`  | Next.js 16        | `https://qolmeia.backoffice.localhost` | Operator approvals and team management                |

## Packages

| Package                   | Purpose                                            |
| ------------------------- | -------------------------------------------------- |
| `@repo/auth`              | Better Auth factory shared by API and Next apps    |
| `@repo/db`                | Prisma clients and the shared Postgres schema      |
| `@repo/transactional`     | React Email templates and Resend sender            |
| `@repo/ui`                | Shared shadcn-style UI package and Tailwind preset |
| `@repo/config-vitest`     | Shared Vitest config                               |
| `@repo/typescript-config` | Shared TypeScript config                           |

## Prerequisites

- Node.js 24 or newer
- pnpm 11.1.3, matching `packageManager`
- Docker, for local Postgres on `:5436`
- Wrangler, installed through the workspace dependencies

## Quick Start

```bash
pnpm install
docker compose up -d

DATABASE_URL=postgresql://qolmeia:qolmeia123@localhost:5436/qolmeia \
  pnpm --filter=@repo/db db:push

pnpm --filter=api exec tsx src/scripts/seed-dev.ts

pnpm dev
```

Each app has its own environment file. Copy from the committed examples:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/client/.env.example apps/client/.env
cp apps/backoffice/.env.example apps/backoffice/.env
cp apps/agents/.dev.vars.example apps/agents/.dev.vars
```

`BETTER_AUTH_SECRET` must match across `apps/api`, `apps/client`, and `apps/backoffice`. `apps/agents/.dev.vars` holds `DATABASE_URL` and Worker-only secrets such as `OPENROUTER_API_KEY` and `ASSETS_SIGNING_KEY`.

## Useful Commands

```bash
pnpm dev                  # run all apps through Turbo
pnpm dev --filter=api
pnpm dev --filter=worker-bees
pnpm dev --filter=client
pnpm dev --filter=backoffice

pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

## Local Accounts

`pnpm --filter=api exec tsx src/scripts/seed-dev.ts` creates:

| Surface    | Role     | Email                  | Password                    |
| ---------- | -------- | ---------------------- | --------------------------- |
| Backoffice | OWNER    | `operator@qolmeia.dev` | `Qolmeia-Dev-OperatorPass!` |
| Client     | CUSTOMER | `customer@qolmeia.dev` | `Qolmeia-Dev-CustomerPass!` |

The client flow is magic-link first. In local development, watch the `apps/api` logs for the link.
