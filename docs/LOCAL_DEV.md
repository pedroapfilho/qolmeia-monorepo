# Running Qolmeia Locally

This guide brings up the current four-app stack: auth API, Cloudflare Worker agents, customer client, and operator backoffice. For architecture context, see [`docs/ARCHITECTURE.md`](ARCHITECTURE.md).

## 1. Prerequisites

| Tool    | Version            | Check              |
| ------- | ------------------ | ------------------ |
| Node.js | 24 or newer        | `node --version`   |
| pnpm    | 11.1.3             | `pnpm --version`   |
| Docker  | any recent version | `docker --version` |

## 2. Install and Start Postgres

```bash
pnpm install
docker compose up -d
```

Docker starts Postgres on host port `5436`. Redis may still be present in compose for legacy compatibility. Auth and agent product state live in Postgres; Cloudflare KV and R2 retain their cache and binary-asset roles.

## 3. Environment Files

Copy the committed examples:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp apps/backoffice/.env.example apps/backoffice/.env
cp apps/agents/.dev.vars.example apps/agents/.dev.vars
```

`BETTER_AUTH_SECRET` must be identical in `apps/api/.env`, `apps/web/.env`, and `apps/backoffice/.env`.

Important local variables:

| File                    | Variables                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `apps/api/.env`         | `DATABASE_URL`, `BETTER_AUTH_SECRET`, optional `RESEND_API_KEY`, `AUTH_FROM_EMAIL`                |
| `apps/web/.env`         | `DATABASE_URL`, `BETTER_AUTH_SECRET`, optional `AUTH_SERVICE_INTERNAL_URL`, `AGENTS_INTERNAL_URL` |
| `apps/backoffice/.env`  | `DATABASE_URL`, `BETTER_AUTH_SECRET`, optional `AUTH_SERVICE_INTERNAL_URL`, `AGENTS_INTERNAL_URL` |
| `apps/agents/.dev.vars` | `DATABASE_URL`, `OPENROUTER_API_KEY`, `ASSETS_SIGNING_KEY`                                        |

The Next apps rewrite `/api/auth/*`, `/api/me/*`, `/api/teams/*`, `/api/backoffice/*`, and `/agents/*` to the local API/Worker so cookies stay first-party in development.

## 4. Initialize Data

Push the shared auth and product Prisma schema to Postgres:

```bash
DATABASE_URL=postgresql://qolmeia:qolmeia123@localhost:5436/qolmeia \
  pnpm --filter=@repo/db db:push
```

Seed the dev organization, users, product catalog, and agent team:

```bash
pnpm --filter=api exec tsx src/scripts/seed-dev.ts
```

## 5. Run the Stack

Run everything:

```bash
pnpm dev
```

Or run one app per terminal:

```bash
pnpm dev --filter=api
pnpm dev --filter=worker-bees
pnpm dev --filter=web
pnpm dev --filter=backoffice
```

## 6. Dev URLs

| Surface    | URL                                    |
| ---------- | -------------------------------------- |
| API        | `https://qolmeia.api.localhost`        |
| Worker     | `http://127.0.0.1:8787`                |
| Client     | `https://qolmeia.web.localhost`        |
| Backoffice | `https://qolmeia.backoffice.localhost` |

Seeded accounts:

| Surface    | Role     | Email                  | Password                    |
| ---------- | -------- | ---------------------- | --------------------------- |
| Backoffice | OWNER    | `operator@qolmeia.dev` | `Qolmeia-Dev-OperatorPass!` |
| Client     | CUSTOMER | `customer@qolmeia.dev` | `Qolmeia-Dev-CustomerPass!` |

The client login uses magic links. In local development, watch the `apps/api` logs for the link.

## 7. Verify

```bash
pnpm typecheck
pnpm lint
pnpm test

curl http://127.0.0.1:8787/healthz
```

Useful targeted checks:

```bash
pnpm --filter=web typecheck
pnpm --filter=worker-bees typecheck
pnpm --filter=web test -- --run src/components/chat.test.tsx
pnpm --filter=worker-bees test -- --run apps/agents/src/__tests__/skill-tool-schema.test.ts
```

## 8. Common Pitfalls

| Symptom                                   | Fix                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| Login succeeds but app APIs return 401    | Make `BETTER_AUTH_SECRET` match across API, client, and backoffice       |
| Client/backoffice cannot reach the Worker | Check `AGENTS_INTERNAL_URL`, defaulting to `http://127.0.0.1:8787`       |
| Auth routes fail from Next                | Check `AUTH_SERVICE_INTERNAL_URL`, defaulting to `http://127.0.0.1:4000` |
| Worker has no local data                  | Check its `DATABASE_URL`, then rerun `apps/api/src/scripts/seed-dev.ts`  |
| Real agent calls fail                     | Set `OPENROUTER_API_KEY` in `apps/agents/.dev.vars`                      |
| Asset generation or signed URLs fail      | Set `ASSETS_SIGNING_KEY` in `apps/agents/.dev.vars`                      |
