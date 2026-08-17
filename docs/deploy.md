# Deploying Qolmeia to production

The single source of truth for taking Qolmeia live. Deploys are **manual** today
(no CD pipeline). The dev `.localhost` / portless proxy is **dev-only**; prod
uses real subdomains of one parent and a cross-subdomain session cookie
(ADR 0008).

## 1. The stack at a glance

| App               | Package       | Runtime                                                      | Host                     | Prod subdomain       |
| ----------------- | ------------- | ------------------------------------------------------------ | ------------------------ | -------------------- |
| `apps/api`        | `api`         | Hono on Node 24 (tsdown → `node dist/index.mjs`)             | **Railway** (+ Postgres) | `api.qolmeia.com`    |
| `apps/agents`     | `worker-bees` | Cloudflare Worker (DO, Workflows, Prisma, R2, KV, Vectorize) | **Cloudflare**           | `agents.qolmeia.com` |
| `apps/web`        | `web`         | Next.js 16                                                   | **Vercel**               | `app.qolmeia.com`    |
| `apps/backoffice` | `backoffice`  | Next.js 16                                                   | **Vercel**               | `admin.qolmeia.com`  |
| `apps/landing`    | `landing`     | Next.js 16 (static marketing site)                           | **Vercel**               | `www.qolmeia.com`    |

Postgres holds Better Auth and product data (company, ticket, action, asset,
team, memory_fact, …), accessed through Prisma from both the API and Worker.
Binary assets live in **R2**, the session cache in **KV**, and semantic agent
memory in **Vectorize**.

## 2. External accounts you must create

| Service                                     | For                                                                                                | Secret / config name                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Cloudflare**                              | the agents runtime: Workers, Durable Objects, Workflows, R2, KV, Workers AI, Vectorize, AI Gateway | —                                          |
| **Railway** (or any Node host + managed PG) | `apps/api` service + Postgres                                                                      | `DATABASE_URL`                             |
| **Vercel**                                  | the three Next apps (web, backoffice, landing)                                                     | —                                          |
| **OpenRouter**                              | every LLM + image-gen call, routed through the CF AI Gateway                                       | `OPENROUTER_API_KEY`                       |
| **Resend**                                  | transactional email (magic link, verification, password reset)                                     | `RESEND_API_KEY`                           |
| **Exa** (optional)                          | `webSearch` agent skill                                                                            | `EXA_API_KEY`                              |
| **Firecrawl** (optional)                    | `fetchUrl` agent skill (or self-host keyless)                                                      | `FIRECRAWL_API_KEY` / `FIRECRAWL_BASE_URL` |
| **Domain / DNS**                            | `qolmeia.com` + the five subdomains                                                                | —                                          |

See [`docs/agent-tools.md`](./agent-tools.md) for the full agent-integration
catalog (current tools and which agent uses each).

## 3. Domains + the cross-subdomain cookie (ADR 0008)

Everything lives under **`qolmeia.com`**: `www.` (landing), `app.` (web),
`admin.` (backoffice), `api.` (the Railway api service, which is where Better
Auth runs), `agents.` (the Cloudflare Worker). The session is one cookie on the
`.qolmeia.com` parent so every subdomain sends it:

- `apps/api` sets `COOKIE_DOMAIN=.qolmeia.com` → Better Auth writes the cookie
  on the parent (the `crossSubDomainCookies` config, gated on that env).
- `CORS_ORIGINS` (auth) and `CLIENT_ORIGINS` (Worker) list the real app
  subdomains; browser calls use `credentials: include`.
- The Next apps call auth and the Worker **directly** at their subdomains
  (`NEXT_PUBLIC_AUTH_URL`, `NEXT_PUBLIC_AGENTS_URL`); no proxy hop.

## 4. Cloudflare Worker: `apps/agents`

> All commands run from `apps/agents/`. First `wrangler login` (or set
> `CLOUDFLARE_API_TOKEN`).

### 4a. Provision resources

```bash
wrangler r2 bucket create qolmeia-assets
wrangler kv namespace create qolmeia-sessions           # → copy id
wrangler vectorize create qolmeia-memory --dimensions=1024 --metric=cosine
```

In the Cloudflare dashboard: create an **AI Gateway** named `qolmeia`, and note
your **account id** (`wrangler whoami`).

### 4b. Fill `wrangler.jsonc`

Replace every `PLACEHOLDER`:

- the KV `id` (`SESSIONS`)
- `AI_GATEWAY_ACCOUNT_ID` (your account id)

Update the `vars` for prod:

- `WORKER_PUBLIC_URL=https://agents.qolmeia.com`
- `AUTH_SERVICE_URL=https://api.qolmeia.com` (var name kept; auth is one feature of the api service)
- `CLIENT_ORIGINS=https://app.qolmeia.com,https://admin.qolmeia.com`

Uncomment the **prod-only** block at the bottom of `wrangler.jsonc` (custom
domain route + the `ai` and `vectorize` bindings). Without `ai`+`vectorize` the
Worker still runs, but agent **Memory** degrades to an in-process store that's
lost on DO eviction.

### 4c. Set secrets

```bash
wrangler secret put OPENROUTER_API_KEY
wrangler secret put DATABASE_URL            # shared Postgres connection string
wrangler secret put ASSETS_SIGNING_KEY      # openssl rand -hex 32
wrangler secret put INTERNAL_SHARED_SECRET  # MUST match apps/api
wrangler secret put EXA_API_KEY             # optional (webSearch skill)
wrangler secret put FIRECRAWL_API_KEY       # optional (fetchUrl skill)
```

### 4d. Initialize Postgres

Push the shared Prisma schema and seed the default template/skill catalog before
deploying the Worker:

```bash
DATABASE_URL=postgresql://... pnpm --filter=@repo/db db:push
DATABASE_URL=postgresql://... pnpm --filter=@repo/db db:seed
```

### 4e. Deploy

```bash
pnpm deploy   # = wrangler deploy
```

The Durable Object + Workflow class migrations (`v1`–`v3` in `wrangler.jsonc`)
apply automatically on first deploy. If you didn't put the custom-domain route
in the config, map `agents.qolmeia.com` to the Worker in the dashboard
(Worker → Settings → Domains & Routes).

## 5. Railway: `apps/api` + Postgres

Build from the repo root with pnpm (it's a workspace). Build: the monorepo
`pnpm build` (or filtered `--filter=api`); start: `node dist/index.mjs`
(listens on `PORT`, default 4000). Create a Postgres service and run the schema:

```bash
pnpm --filter=@repo/db db:push   # against the prod DATABASE_URL
pnpm --filter=@repo/db db:seed   # idempotent product catalog defaults
```

Environment:

| Var                      | Value                                                   |
| ------------------------ | ------------------------------------------------------- |
| `DATABASE_URL`           | Railway Postgres connection string                      |
| `BETTER_AUTH_SECRET`     | `openssl rand -base64 48` (shared with the Next apps)   |
| `CORS_ORIGINS`           | `https://app.qolmeia.com,https://admin.qolmeia.com`     |
| `COOKIE_DOMAIN`          | `.qolmeia.com`                                          |
| `AUTH_ALLOWED_HOSTS`     | `qolmeia.com,*.qolmeia.com`                             |
| `TRUSTED_ORIGINS`        | `https://app.qolmeia.com,https://admin.qolmeia.com`     |
| `AGENTS_INTERNAL_URL`    | `https://agents.qolmeia.com` (org-create relay target)  |
| `INTERNAL_SHARED_SECRET` | MUST match the Worker secret                            |
| `RESEND_API_KEY`         | from Resend                                             |
| `AUTH_FROM_EMAIL`        | e.g. `noreply@qolmeia.com`                              |
| `WEB_APP_URL`            | `https://app.qolmeia.com` (drives `useSecureCookies`)   |
| `NODE_ENV`               | `production` (Better Auth rate limiting is gated on it) |

## 6. Vercel: `apps/web`, `apps/backoffice`, `apps/landing`

Three projects, each with **Root Directory** set to the app folder. Leave the
build and install commands empty: Vercel's monorepo detection installs from the
repo root (pnpm workspaces) and runs `next build` in the root directory. Node
24.x, framework preset Next.js.

Existing projects live in the **`unlockers`** Vercel team as `qolmeia-web`,
`qolmeia-backoffice` and `qolmeia-landing`, mirroring the sibling monorepos
(`frow-web` / `frow-landing`).

`apps/landing` is a static marketing site: no auth, no Prisma, no session. It
needs only two vars:

| Var                       | Value                     |
| ------------------------- | ------------------------- |
| `NEXT_PUBLIC_WEB_APP_URL` | `https://app.qolmeia.com` |
| `NEXT_PUBLIC_LANDING_URL` | `https://www.qolmeia.com` |

`apps/web` and `apps/backoffice` both construct their own Better Auth instance
in `proxy.ts`, so they need the full cookie configuration, not just the first
four rows:

| Var                      | Value                                                                  |
| ------------------------ | ---------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`     | same secret as `apps/api`; a mismatch invalidates every session cookie |
| `DATABASE_URL`           | Railway Postgres, `sslmode=require` (see the TLS note below)           |
| `NEXT_PUBLIC_AUTH_URL`   | `https://api.qolmeia.com`                                              |
| `NEXT_PUBLIC_AGENTS_URL` | `https://agents.qolmeia.com`                                           |
| `WEB_APP_URL`            | `https://app.qolmeia.com`                                              |
| `COOKIE_DOMAIN`          | `.qolmeia.com`                                                         |
| `AUTH_ALLOWED_HOSTS`     | `qolmeia.com,*.qolmeia.com`                                            |
| `TRUSTED_ORIGINS`        | `https://app.qolmeia.com,https://admin.qolmeia.com`                    |

The last four are load-bearing and easy to miss:

- **`WEB_APP_URL` is the only input to `useSecureCookies`**
  (`packages/auth/src/env-config.ts`). Unset, or not starting with `https://`,
  and Better Auth issues the cross-subdomain `.qolmeia.com` session cookie
  **without the `Secure` flag**.
- **`COOKIE_DOMAIN` belongs on the Vercel projects too**, not only on Railway.
  `nextCookies()` can write a cookie from a Next server action; without the
  domain that write lands a host-only cookie on `app.qolmeia.com` which shadows
  the parent-domain one.

**Database TLS.** Railway exposes two public endpoints. The **Postgres** one
answers the Postgres `SSLRequest` with `S` (TLS available); the **PgBouncer**
one answers `N` (no TLS). Vercel sits outside Railway's private network, so it
must use the Postgres public URL with `?sslmode=require`. PgBouncer is the right
target only for services running _inside_ Railway, where traffic never leaves
the private network.

Point `www.qolmeia.com` (and the `qolmeia.com` apex) at the landing project,
`app.qolmeia.com` at the web project, and `admin.qolmeia.com` at the backoffice
project in Vercel's domain settings. DNS for `qolmeia.com` is on Cloudflare;
each host needs a CNAME to the value Vercel shows under the project's Domains
tab, or an A record to `216.150.1.1` / `216.150.16.1`.

## 7. Order of operations

1. **Cloudflare** first; you need `agents.qolmeia.com` for `AGENTS_INTERNAL_URL`.
2. **Railway**: auth + Postgres; gives you `api.qolmeia.com`.
3. **Vercel**: the two Next apps, pointed at both.

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

- No CD pipeline: these three deploys are manual.
- An **operator directory** (listing OWNER/STAFF users) doesn't exist yet, so
  the backoffice ships **self-service** coverage; an admin-assigns-others
  surface needs that directory first (ADR 0005 / 0008).
- A staged dependency update (`--latest`) was deferred; do it on its own, not
  bundled with a deploy.
