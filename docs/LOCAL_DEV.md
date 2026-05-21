# Running Qolmeia locally

How to get all three apps running on your machine. Last verified against `main` at HEAD `8ebe21f` (557 tests, 3 apps).

For the architecture itself, see `docs/ARCHITECTURE.md`. For the system overview (technical + non-technical), see `docs/strategy/2026-05-21-system-overview.md`.

---

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | ≥ 24 | `node --version` |
| pnpm | 10.x | `pnpm --version` |
| Docker | any recent | `docker --version` |

Optional, only for testing the live Telegram bot: `cloudflared` (`brew install cloudflared`).

---

## 2. Bootstrap (one-time, ~3 minutes)

```bash
git clone git@github.com:pedroapfilho/qolmeia-monorepo.git
cd qolmeia-monorepo
pnpm install
docker compose up -d        # Postgres :5436 + Redis :6382
pnpm db:push                # apply the Prisma schema
pnpm db:generate            # generate the Prisma client
```

`docker compose up -d` starts:
- **Postgres 18** on host port `5436` (container user/pass/db: `qolmeia` / `qolmeia123` / `qolmeia`)
- **Redis 7** on host port `6382`

Non-standard ports are deliberate — `5432`/`6379` are assumed occupied by other local projects.

---

## 3. Environment files

There are **three** `.env` files — one per app. All are git-ignored; each app ships a `.env.example`.

```bash
cp apps/api/.env.example         apps/api/.env
cp apps/backoffice/.env.example  apps/backoffice/.env
cp apps/client/.env.example      apps/client/.env
```

### 3.1 Shared auth secret

`BETTER_AUTH_SECRET` **must be identical across all three `.env` files** — the cookie issued by `apps/api` is validated by both Next apps, and a mismatch silently breaks every login.

```bash
openssl rand -base64 48      # generate once, paste the same value into all 3 files
```

### 3.2 `apps/api/.env` — the only file needing real external service keys

| Variable | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | Postgres connection | Pre-filled for docker; leave as-is locally |
| `REDIS_URL` | BullMQ queues + Chat SDK state | Pre-filled for docker (`redis://localhost:6382`) |
| `BETTER_AUTH_SECRET` | Cookie + token signing | The `openssl rand -base64 48` value (same in all 3 files) |
| `OPENROUTER_API_KEY` | All LLM + image-gen calls | Required for real agent runs. Get one at https://openrouter.ai/keys |
| `TELEGRAM_BOT_TOKEN` | Telegram bot auth | From BotFather. Placeholder OK if not testing Telegram |
| `TELEGRAM_BOT_USERNAME` | Mention detection | From BotFather |
| `TELEGRAM_WEBHOOK_SECRET_TOKEN` | Inbound webhook auth | `openssl rand -hex 32` |
| `R2_ACCOUNT_ID` / `R2_BUCKET` / `R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_REGION` | Cloudflare R2 (brand assets + knowledge docs) | Required for image-gen results + knowledge docs. Placeholders OK if not testing those |
| `RESEND_API_KEY` | Transactional email | Optional — when empty, auth email hooks become silent no-ops |
| `DISPATCH_MODE` | `serial` or `queue` | Default `serial` (agent loop runs inline). See §6.1 |
| `IMAGE_GEN_MODEL` | OpenRouter image model id | Optional; defaults to `google/gemini-3-pro-image-preview` (Nano Banana Pro) |
| `CORS_ORIGINS` | Allowed cross-origin callers | Pre-filled with the backoffice + client dev URLs |
| `AUTH_FROM_EMAIL` | From: address for auth emails | Optional; defaults to `noreply@qolmeia.ai` |
| `WEB_APP_URL` / `AUTH_ALLOWED_HOSTS` / `TRUSTED_ORIGINS` | Production hostnames | Leave unset locally |

### 3.3 `apps/backoffice/.env`

```bash
NEXT_PUBLIC_API_URL=http://localhost:4000
BETTER_AUTH_SECRET=<same value as apps/api>
```

### 3.4 `apps/client/.env`

```bash
NEXT_PUBLIC_API_URL=http://localhost:4000
BETTER_AUTH_SECRET=<same value as apps/api>
```

---

## 4. Seed an owner user (one-time)

```bash
pnpm --filter=api exec tsx src/scripts/seed-owner-user-and-membership.ts
```

Prints an email + temporary password. Use these to log into the backoffice. **Change the password immediately after first login.**

---

## 5. Start the dev servers

Three terminals:

```bash
# Terminal 1 — Backend API (Hono)
pnpm dev --filter=api
# → http://localhost:4000

# Terminal 2 — Operator UI (Next.js)
pnpm dev --filter=backoffice
# → http://localhost:3000

# Terminal 3 — Customer chat UI (Next.js)
pnpm dev --filter=client
# → http://localhost:3001
```

Log into the backoffice at `http://localhost:3000` with the seeded owner credentials.

---

## 6. Optional extras

### 6.1 Queue mode (BullMQ worker)

By default `DISPATCH_MODE=serial` — the agent loop runs inline inside the webhook handler. No worker process needed.

To run the agent loop asynchronously (webhook returns 200 immediately, work happens in a worker):

```bash
# apps/api/.env
DISPATCH_MODE=queue
```

Then add a fourth terminal:

```bash
pnpm --filter=api exec tsx src/workers/index.ts
# Consumes the agent-run + routine-scheduler queues
```

### 6.2 Live Telegram bot

```bash
# Terminal 4
cloudflared tunnel --url http://localhost:4000
```

Then point the bot at the tunnel. You need a `ConnectorInstance` row for the bot first (create it via the backoffice, or seed it). With its id:

```bash
set -a; source apps/api/.env; set +a
TUNNEL="https://<your-cloudflared-url>"
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${TUNNEL}/connectors/telegram/<connectorInstanceId>/webhook" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET_TOKEN}"
```

### 6.3 Sample data + connectors

```bash
# Sample knowledge docs (policy / brand voice / service menu)
pnpm --filter=api exec tsx src/scripts/seed-knowledge-sample.ts

# WhatsApp connector — prints the webhook URL + verify token for Meta's dashboard
pnpm --filter=api exec tsx src/scripts/seed-whatsapp-connector.ts \
  --org-slug=<org> --phone-number-id=<...> --access-token=<...>

# Routines — arrive paused; enable via owner command `/ligar <name>` or the backoffice
pnpm --filter=api exec tsx src/scripts/sync-routines.ts
```

---

## 7. Verify the install

```bash
pnpm typecheck   # 0 errors across all packages
pnpm lint        # 0 warnings, 0 errors
pnpm test        # 557 tests pass

curl http://localhost:4000/healthz   # → 200
curl http://localhost:4000/readyz    # → 200
```

Then open `http://localhost:3000` (backoffice) and `http://localhost:3001` (client) in a browser.

---

## 8. What works without external API keys

If you fill the `.env` files with placeholder values for `OPENROUTER_API_KEY`, `R2_*`, `TELEGRAM_*`, and `RESEND_API_KEY`, you can still:

- Browse both the backoffice and client UIs
- Run all 557 tests (every external seam is mocked)
- Inspect the database: `psql -h localhost -p 5436 -U qolmeia` (password `qolmeia123`)

You **cannot** actually message an agent or generate an image without `OPENROUTER_API_KEY`, and brand-asset + knowledge-doc storage needs real `R2_*` values.

---

## 9. Common pitfalls

| Symptom | Fix |
|---|---|
| `Cannot find module '@tanstack/react-query'` during typecheck | `pnpm install` — lockfile drift after a fresh checkout or branch switch |
| `BETTER_AUTH_SECRET environment variable is required` | The three `.env` files don't all carry the same secret value |
| Logins don't persist between apps | Mismatched `BETTER_AUTH_SECRET`, or wrong `NEXT_PUBLIC_API_URL` |
| BullMQ connects to `localhost:6379` and fails | `REDIS_URL` is empty — our docker Redis is on `:6382`, not the default `:6379` |
| Prisma client errors after pulling new schema | `pnpm db:push && pnpm db:generate` |
| Postgres/Redis connection refused | `docker compose up -d` — containers not running |

---

## 10. Useful commands

```bash
pnpm dev --filter=<api|backoffice|client>   # one app
pnpm build                                  # build everything (turbo-cached)
pnpm test                                    # all tests
pnpm typecheck                               # tsc --noEmit across all packages
pnpm lint                                    # oxlint
pnpm format                                  # oxfmt (write)
pnpm db:push                                 # apply schema changes to the DB
pnpm db:generate                             # regenerate the Prisma client
docker compose up -d                         # start Postgres + Redis
docker compose down                          # stop them (data persists in volumes)
docker compose down -v                       # stop + wipe data volumes
```

---

## 11. Port map

| Port | Service |
|---|---|
| 4000 | `apps/api` (Hono backend) |
| 3000 | `apps/backoffice` (operator UI) |
| 3001 | `apps/client` (customer chat UI) |
| 5436 | Postgres (docker) |
| 6382 | Redis (docker) |
