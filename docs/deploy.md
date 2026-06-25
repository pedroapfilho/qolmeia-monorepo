# Deploying Qolmeia to production

The single source of truth for taking Qolmeia live. Deploys are **manual** today
(no CD pipeline). The dev `.localhost` / portless proxy is **dev-only**; prod
uses real subdomains of one parent and a cross-subdomain session cookie
(ADR 0008).

## 1. The stack at a glance

| App               | Package       | Runtime                                                  | Host                     | Prod subdomain       |
| ----------------- | ------------- | -------------------------------------------------------- | ------------------------ | -------------------- |
| `apps/api`        | `api`         | Hono on Node 24 (tsdown → `node dist/index.mjs`)         | **Railway** (+ Postgres) | `api.qolmeia.com`    |
| `apps/agents`     | `worker-bees` | Cloudflare Worker (DO, Workflows, D1, R2, KV, Vectorize) | **Cloudflare**           | `agents.qolmeia.com` |
| `apps/client`     | `client`      | Next.js 16                                               | **Vercel**               | `app.qolmeia.com`    |
| `apps/backoffice` | `backoffice`  | Next.js 16                                               | **Vercel**               | `admin.qolmeia.com`  |

Postgres holds **only** Better Auth tables. All product data (company, ticket,
action, asset, team, memory_fact, …) lives in Cloudflare **D1**; binary assets in
**R2**; a session cache in **KV**; agent memory in **Vectorize**.

## 2. External accounts you must create

| Service                                     | For                                                                                                           | Secret / config name                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Cloudflare**                              | the entire agents runtime: Workers, Durable Objects, Workflows, D1, R2, KV, Workers AI, Vectorize, AI Gateway | —                                          |
| **Railway** (or any Node host + managed PG) | `apps/api` service + Postgres                                                                                 | `DATABASE_URL`                             |
| **Vercel**                                  | the two Next apps                                                                                             | —                                          |
| **OpenRouter**                              | every LLM + image-gen call, routed through the CF AI Gateway                                                  | `OPENROUTER_API_KEY`                       |
| **Resend**                                  | transactional email (magic link, verification, password reset)                                                | `RESEND_API_KEY`                           |
| **Exa** (optional)                          | `webSearch` agent skill                                                                                       | `EXA_API_KEY`                              |
| **Firecrawl** (optional)                    | `fetchUrl` agent skill (or self-host keyless)                                                                 | `FIRECRAWL_API_KEY` / `FIRECRAWL_BASE_URL` |
| **Domain / DNS**                            | `qolmeia.com` + the four subdomains                                                                           | —                                          |

See [`docs/agent-tools.md`](./agent-tools.md) for the full agent-integration
catalog (current tools and which agent uses each).

## 3. Domains + the cross-subdomain cookie (ADR 0008)

Everything lives under **`qolmeia.com`**: `app.` (client), `admin.`
(backoffice), `auth.` (auth), `api.` (Worker). The session is one cookie on the
`.qolmeia.com` parent so every subdomain sends it:

- `apps/api` sets `COOKIE_DOMAIN=.qolmeia.com` → Better Auth writes the cookie
  on the parent (the `crossSubDomainCookies` config, gated on that env).
- `CORS_ORIGINS` (auth) and `CLIENT_ORIGINS` (Worker) list the real app
  subdomains; browser calls use `credentials: include`.
- The Next apps call auth and the Worker **directly** at their subdomains
  (`NEXT_PUBLIC_AUTH_URL`, `NEXT_PUBLIC_AGENTS_URL`) — no proxy hop.

## 4. Cloudflare Worker — `apps/agents`

> All commands run from `apps/agents/`. First `wrangler login` (or set
> `CLOUDFLARE_API_TOKEN`).

### 4a. Provision resources

```bash
wrangler d1 create worker-bees                          # → copy database_id
wrangler r2 bucket create qolmeia-assets
wrangler kv namespace create qolmeia-sessions           # → copy id
wrangler vectorize create qolmeia-memory --dimensions=1024 --metric=cosine
```

In the Cloudflare dashboard: create an **AI Gateway** named `qolmeia`, and note
your **account id** (`wrangler whoami`).

### 4b. Fill `wrangler.jsonc`

Replace every `PLACEHOLDER`:

- D1 `database_id` (from 4a)
- the KV `id` (`SESSIONS`)
- `AI_GATEWAY_ACCOUNT_ID` (your account id)

Update the `vars` for prod:

- `WORKER_PUBLIC_URL=https://agents.qolmeia.com`
- `AUTH_SERVICE_URL=https://api.qolmeia.com` (var name kept — auth is one feature of the api service)
- `CLIENT_ORIGINS=https://app.qolmeia.com,https://admin.qolmeia.com`

Uncomment the **prod-only** block at the bottom of `wrangler.jsonc` (custom
domain route + the `ai` and `vectorize` bindings). Without `ai`+`vectorize` the
Worker still runs, but agent **Memory** degrades to an in-process store that's
lost on DO eviction.

### 4c. Set secrets

```bash
wrangler secret put OPENROUTER_API_KEY
wrangler secret put ASSETS_SIGNING_KEY      # openssl rand -hex 32
wrangler secret put INTERNAL_SHARED_SECRET  # MUST match apps/api
wrangler secret put EXA_API_KEY             # optional (webSearch skill)
wrangler secret put FIRECRAWL_API_KEY       # optional (fetchUrl skill)
```

### 4d. Apply D1 migrations (the one gotcha)

```bash
wrangler d1 migrations apply worker-bees --remote
```

Migration **`0007_agent_instance_multi_hire.sql`** rebuilds an FK table, which
the migrations runner rejects (it keeps FK enforcement on inside its
transaction). When it stops there, apply that file directly and record it by
hand, then resume:

```bash
wrangler d1 execute worker-bees --remote --file migrations/0007_agent_instance_multi_hire.sql
wrangler d1 execute worker-bees --remote \
  --command "INSERT INTO d1_migrations (name, applied_at) VALUES ('0007_agent_instance_multi_hire.sql', CURRENT_TIMESTAMP);"
wrangler d1 migrations apply worker-bees --remote   # picks up 0008–0012
```

`0011_operator_assignment` and `0012_asset_visibility` are plain `CREATE`/`ADD`
and apply normally. Optionally seed the dev org row:

```bash
wrangler d1 execute worker-bees --remote --file scripts/seed-p2.sql
wrangler d1 execute worker-bees --remote --file scripts/seed-p3-team.sql
```

### 4e. Deploy

```bash
pnpm deploy   # = wrangler deploy
```

The Durable Object + Workflow class migrations (`v1`–`v3` in `wrangler.jsonc`)
apply automatically on first deploy. If you didn't put the custom-domain route
in the config, map `agents.qolmeia.com` to the Worker in the dashboard
(Worker → Settings → Domains & Routes).

## 5. Railway — `apps/api` + Postgres

Build from the repo root with pnpm (it's a workspace). Build: the monorepo
`pnpm build` (or filtered `--filter=api`); start: `node dist/index.mjs`
(listens on `PORT`, default 4000). Create a Postgres service and run the schema:

```bash
pnpm --filter=@repo/db db:push   # against the prod DATABASE_URL
```

Environment:

| Var                      | Value                                                  |
| ------------------------ | ------------------------------------------------------ |
| `DATABASE_URL`           | Railway Postgres connection string                     |
| `BETTER_AUTH_SECRET`     | `openssl rand -base64 48` (shared with the Next apps)  |
| `CORS_ORIGINS`           | `https://app.qolmeia.com,https://admin.qolmeia.com`    |
| `COOKIE_DOMAIN`          | `.qolmeia.com`                                         |
| `AUTH_ALLOWED_HOSTS`     | `qolmeia.com,*.qolmeia.com`                            |
| `TRUSTED_ORIGINS`        | `https://app.qolmeia.com,https://admin.qolmeia.com`    |
| `AGENTS_INTERNAL_URL`    | `https://agents.qolmeia.com` (org-create relay target) |
| `INTERNAL_SHARED_SECRET` | MUST match the Worker secret                           |
| `RESEND_API_KEY`         | from Resend                                            |
| `AUTH_FROM_EMAIL`        | e.g. `noreply@qolmeia.com`                             |

## 6. Vercel — `apps/client` + `apps/backoffice`

Two projects, each with **Root Directory** set to the app folder and the
monorepo install/build wired through pnpm + Turborepo (`pnpm build --filter=…`).
Both need:

| Var                      | Value                                                                        |
| ------------------------ | ---------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`     | same secret as `apps/api`                                                    |
| `DATABASE_URL`           | the Railway Postgres URL — the Next middleware validates sessions via Prisma |
| `NEXT_PUBLIC_AUTH_URL`   | `https://api.qolmeia.com`                                                    |
| `NEXT_PUBLIC_AGENTS_URL` | `https://agents.qolmeia.com`                                                 |

Point `app.qolmeia.com` at the client project and `admin.qolmeia.com` at the
backoffice project in Vercel's domain settings.

## 7. Order of operations

1. **Cloudflare** first — you need `agents.qolmeia.com` for `AGENTS_INTERNAL_URL`.
2. **Railway** — auth + Postgres; gives you `api.qolmeia.com`.
3. **Vercel** — the two Next apps, pointed at both.

`INTERNAL_SHARED_SECRET` and `BETTER_AUTH_SECRET` must be **identical** across
the sides that share them. Rotating `INTERNAL_SHARED_SECRET` breaks org-create
until both the Worker and `apps/api` are redeployed.

## 8. Smoke test after deploy

1. Sign up / magic-link on `app.qolmeia.com` → cookie set on `.qolmeia.com`.
2. Client onboarding chat (Planner) → confirm a team.
3. Customer chat → Correspondent delegates → a Worker job runs.
4. A gated action lands on `admin.qolmeia.com` `/approvals` → decide it.
5. The approved deliverable appears in the customer chat and `/assets`.

## 9. Still open before "done"

- No CD pipeline — these three deploys are manual.
- An **operator directory** (listing OWNER/STAFF users) doesn't exist yet, so
  the backoffice ships **self-service** coverage; an admin-assigns-others
  surface needs that directory first (ADR 0005 / 0008).
- A staged dependency update (`--latest`) was deferred — do it on its own, not
  bundled with a deploy.
