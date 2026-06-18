# Production topology: split hosting under one parent domain, cross-subdomain auth cookie

The repo only codifies the Worker deploy; auth and the Next apps had no target, and the dev auth flow relies on a `.localhost` proxy trick that doesn't translate to prod. This fixes where each piece runs and how the session survives across them.

**Decision — hosting:**

| Piece                            | Host           | Notes                                                     |
| -------------------------------- | -------------- | --------------------------------------------------------- |
| `apps/agents` (worker-bees)      | **Cloudflare** | `wrangler deploy`; D1, R2, KV, Vectorize, Workflows       |
| `apps/auth` + **Postgres**       | **Railway**    | Hono/Node service + managed Postgres (Better Auth tables) |
| `apps/client`, `apps/backoffice` | **Vercel**     | two Next 16 projects                                      |

**Decision — domains + auth cookie:** everything under **`qolmeia.com`** (e.g. `app.` = client, `admin.` = backoffice, `auth.` = auth, `api.` = Worker; exact names TBD). The session is a **cross-subdomain cookie on `.qolmeia.com`**:

- Better Auth sets the cookie on the `.qolmeia.com` parent (`advanced.crossSubDomainCookies`), so every subdomain sends it.
- `CORS_ORIGINS` (auth) and the Worker's `CLIENT_ORIGINS` list the real app subdomains; browser calls use `credentials: include`.
- The apps call auth and the Worker **directly** at their real subdomains (`NEXT_PUBLIC_AUTH_URL` / `NEXT_PUBLIC_AGENTS_URL`) — no proxy hop.

Chosen over **proxying** (the dev model, where each Next app rewrites `/api/auth/*` + `/agents/*` to stay same-origin): proxying across three different providers (Vercel → Railway → Cloudflare) means rewriting `Set-Cookie` domains across hops, which is fragile. A shared parent domain is the purpose-built solution for cross-subdomain auth. The dev `.localhost` rewrite trick stays **dev-only** (it exists because `.localhost` is a public suffix and can't share a cookie across ports).

## Provisioning sequence (no CD yet — manual)

1. **Cloudflare:** create account; `wrangler d1 create worker-bees`, R2 bucket `qolmeia-assets`, KV namespaces (`CONNECTOR_SECRETS`, `SESSIONS`), Vectorize index; fill the real ids + `AI_GATEWAY_ACCOUNT_ID` in `wrangler.jsonc`; `wrangler secret put` (`OPENROUTER_API_KEY`, `ASSETS_SIGNING_KEY`, `INTERNAL_SHARED_SECRET`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`). Apply D1 migrations — **`0007` needs the `wrangler d1 execute --remote --file` + manual `d1_migrations` insert workaround** (FK-rebuild the migration runner rejects); `0008`–`0010` apply normally. Then `wrangler deploy`.
2. **Railway:** deploy `apps/auth` + Postgres; env (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `CORS_ORIGINS`, `INTERNAL_SHARED_SECRET` matching the Worker, `RESEND_API_KEY`); `prisma db push`/migrate.
3. **Vercel:** two projects (client, backoffice); env (`BETTER_AUTH_SECRET`, `DATABASE_URL`, `NEXT_PUBLIC_AUTH_URL`, `NEXT_PUBLIC_AGENTS_URL`).

## Consequences

- Better Auth needs `crossSubDomainCookies` + `trustedOrigins` for the prod subdomains; prod differs from dev in the auth _model_ (cross-origin), not just URLs — the one place dev and prod diverge.
- A future CD pipeline (currently only check workflows exist) would wire these three deploys; until then it's manual.
