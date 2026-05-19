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
| `api` | Hono backend API | `http://localhost:4000` |

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

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start local infrastructure

```bash
docker compose up -d   # starts Postgres on :5436 and Redis on :6382
```

### 3. Configure environment variables

```bash
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env` and set at minimum:

- `DATABASE_URL` — already pre-set for the local Docker container
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET_TOKEN`
- `REDIS_URL` — already pre-set for local Docker

### 4. Initialize the database

```bash
pnpm db:generate    # generate the Prisma client
pnpm db:push        # apply the schema to your database
```

### 5. Run the dev server

```bash
pnpm dev
```

Open:

- API: <http://localhost:4000>
  - OpenAPI docs (Scalar): <http://localhost:4000/docs>
  - Schema JSON: <http://localhost:4000/openapi.json>
  - LLM-friendly text: <http://localhost:4000/llms.txt>

## Telegram bot (local dev)

The bot (`@qolmeia_mvp_v0_bot`) receives updates via webhook. Telegram requires a
public HTTPS URL, so tunnel the local API to expose it:

1. `docker compose up -d` (Postgres + Redis)
2. `pnpm dev --filter=api`
3. `cloudflared tunnel --url http://localhost:4000` (or `ngrok http 4000`)
4. Register the webhook — token and secret are in `apps/api/.env`:

   ```bash
   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
     -d "url=https://<your-tunnel-host>/telegram/webhook" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET_TOKEN>"
   ```

5. Message the bot on Telegram — it persists the message and replies.

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
