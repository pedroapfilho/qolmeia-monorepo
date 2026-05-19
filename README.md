# Qolmeia

Monorepo for the Qolmeia API — a Hono-on-Node backend that hosts the Telegram webhook and soul pipeline.

## Stack

- **Framework:** Hono (Node.js)
- **Language:** TypeScript (strict)
- **Database:** Prisma 7, PostgreSQL
- **Monorepo:** Turborepo, pnpm workspaces
- **Linting:** oxlint
- **Formatting:** oxfmt
- **Testing:** Vitest (unit)
- **Bundler:** tsdown

## Apps

| App   | Description      | Dev URL                       |
| ----- | ---------------- | ----------------------------- |
| `api` | Hono backend API | `https://qolmeia.api.localhost` |

## Packages

| Package                   | Description                    |
| ------------------------- | ------------------------------ |
| `@repo/db`                | Prisma database client         |
| `@repo/config-vitest`     | Shared Vitest test configs     |
| `@repo/typescript-config` | Shared TypeScript configs      |

## Setup

### Prerequisites

- **Node.js 24** (use `nvm install 24 && nvm use 24`)
- **pnpm 10** (`npm install -g pnpm@10`)
- **Docker** for local Postgres + Redis (see `docker-compose.yml`)
- **portless** for stable HTTPS dev URLs (see below)

### 1. Install dependencies

```bash
pnpm install
```

### 2. Install portless and start the HTTPS proxy

Dev servers run behind [portless](https://www.npmjs.com/package/portless), which gives the API a stable `https://*.localhost` URL.

One-time per machine:

```bash
npm install -g portless
sudo portless proxy start --https   # binds :443, trusts the local cert
```

### 3. Start local infrastructure

```bash
docker compose up -d   # starts Postgres on :5432 and Redis on :6379
```

### 4. Configure environment variables

```bash
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env` and set at minimum:

- `DATABASE_URL` — already pre-set for the local Docker container
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET_TOKEN`
- `REDIS_URL` — already pre-set for local Docker

### 5. Initialize the database

```bash
pnpm db:generate    # generate the Prisma client
pnpm db:push        # apply the schema to your database
```

### 6. Run the dev server

```bash
pnpm dev
```

Open:

- API: <https://qolmeia.api.localhost>
  - OpenAPI docs (Scalar): <https://qolmeia.api.localhost/docs>
  - Schema JSON: <https://qolmeia.api.localhost/openapi.json>
  - LLM-friendly text: <https://qolmeia.api.localhost/llms.txt>

### Worktrees

Branch name auto-prefixes the subdomain — concurrent worktrees don't collide:

```
main worktree:        https://qolmeia.api.localhost
branch fix-webhook:   https://fix-webhook.qolmeia.api.localhost
```

## Scripts

| Command             | Description                   |
| ------------------- | ----------------------------- |
| `pnpm dev`          | Start the API in development  |
| `pnpm build`        | Build all packages + app      |
| `pnpm test`         | Run Vitest unit tests         |
| `pnpm lint`         | Run oxlint                    |
| `pnpm format`       | Format with oxfmt             |
| `pnpm format:check` | Check formatting              |
| `pnpm typecheck`    | Run TypeScript checks         |
| `pnpm db:generate`  | Generate Prisma client        |
| `pnpm db:push`      | Push schema to database       |
| `pnpm clean`        | Clean all build artifacts     |
