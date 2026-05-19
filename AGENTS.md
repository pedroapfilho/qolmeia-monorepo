# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Commands

```bash
# Development (runs the API via Turborepo)
pnpm dev                          # start the api
pnpm dev --filter=api             # explicit filter (same result)

# Build / Lint / Typecheck
pnpm build                        # all packages + app (turbo cached)
pnpm lint                         # oxlint across all packages
pnpm typecheck                    # tsc --noEmit across all packages
pnpm format                       # oxfmt (write)
pnpm format:check                 # oxfmt (check only, used in CI)

# Testing
pnpm test                         # vitest unit tests

# Database (Prisma, schema in packages/db/prisma/schema.prisma)
pnpm db:generate                  # generate Prisma client
pnpm db:push                      # push schema to database
```

## Architecture

**Monorepo** managed by pnpm workspaces + Turborepo. Node 24, pnpm 10.

### Apps

| App   | Framework                | Dev URL                         | Purpose                               |
| ----- | ------------------------ | ------------------------------- | ------------------------------------- |
| `api` | Hono on Node.js (tsdown) | `http://localhost:4000` | Backend API, Telegram webhook + soul pipeline |

### Packages

| Package                   | Purpose                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `@repo/db`                | Prisma client singleton + schema.                                         |
| `@repo/config-vitest`     | Shared Vitest config. Exports `node.ts` config.                           |
| `@repo/typescript-config` | Shared tsconfig bases: `server.json`.                                     |

### Key Relationships

- **API structure**: Hono app with versioned routes (`/api/v1/*`), health at `/healthz` and `/readyz`, OpenAPI at `/openapi.json`, Scalar UI at `/docs`, LLM text at `/llms.txt`.
- **Build order**: Turborepo handles `^build` dependencies — packages build before the app.

## Tooling

- **Linter**: oxlint (NOT ESLint). Config in `.oxlintrc.json`. Uses `oxlint-config-awesomeness`.
- **Formatter**: oxfmt (NOT Prettier). Config in `.oxfmtrc.json`. Sorts imports.
- **Pre-commit**: Husky + lint-staged runs `oxlint` (on `.ts,.tsx,.js,.jsx` files) and `oxfmt` (on `.ts,.tsx,.js,.jsx,.json,.md` files).
- **Testing**: Vitest for unit tests. `@repo/config-vitest` exports `node.ts` config.
- **Bundler (api)**: tsdown (not tsc). Outputs to `dist/`.

## CI

GitHub Actions workflows are not yet set up. Run `pnpm test`, `pnpm lint`, `pnpm format:check`, and `pnpm fallow:dead` locally before merging.

## Prisma

`prisma.config.ts` uses `process.env.DATABASE_URL ?? ""` (not `env("DATABASE_URL")`) so `prisma generate` works in CI without database credentials.

## Environment

Copy `apps/api/.env.example` to `apps/api/.env`. The API is the only app with env vars. Key variables:

- `DATABASE_URL` — PostgreSQL connection string
- `NODE_ENV` / `PORT` / `HOST` — server config
- `CORS_ORIGINS` — comma-separated allowed origins (defaults to `*`)
- `REDIS_URL` — Redis connection string
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` / `TELEGRAM_WEBHOOK_SECRET_TOKEN` — Telegram bot
- `AI_GATEWAY_API_KEY` — Vercel AI Gateway key
- `R2_ACCOUNT_ID` / `R2_BUCKET` / `R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_REGION` — Cloudflare R2 (Phase 3)

`.env` files are git-ignored; only `.env.example` is committed.

## Conventions

- Path aliases: `@/*` maps to `src/*` in the api and packages.
- API routes are versioned under `/api/v1/`.
- Turbo caches are sensitive to `DATABASE_URL`, `REDIS_URL`, `TELEGRAM_BOT_TOKEN`, and `NODE_ENV`.
