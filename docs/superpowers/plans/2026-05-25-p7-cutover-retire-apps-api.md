# P7 — Cutover + Retire `apps/api` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wind down the legacy `apps/api`. The auth service stays — it's the deliberate "Cloudflare-first, not only" exception. Everything else in `apps/api` (the old REST under `/api/v1/*`, the BullMQ workers, the OpenRouter wiring, the Prisma platform models) is migrated to or deleted by `apps/agents`. Drop Redis. Drop the BullMQ runner. Slim Postgres down to *only* the Better Auth tables. Re-point both Next apps. Update docs.

**Architecture:** By P7 every customer-facing path already lives in `apps/agents`. The remaining `apps/api` surface that *isn't* `/api/auth/*` is:

- `/api/v1/me` — moves to `apps/agents` (the Worker already calls it; we just relocate the handler). Auth service still owns identity; the Worker resolves company + role from the Better Auth user → org membership via a Better Auth `organization` plugin API call.
- `/api/v1/web-chat/*` — already dead in P1 (client moved to `useAgentChat`). Delete.
- `/api/v1/agents`, `/api/v1/approvals`, `/api/v1/activity`, `/api/v1/runs`, `/api/v1/soul`, `/api/v1/team` — backoffice REST. By P4/P5 these live in `apps/agents/src/routes/backoffice*`. Delete the legacy.
- Connector webhooks `/connectors/:type/:id/webhook` — already moved to `/webhooks/:type/:connectorId` in P6. Delete the legacy + update the operator's webhook URLs at each provider.
- BullMQ jobs (`agent-runner`, `routine-scheduler`) — replaced by P4's Workflows + P6's `this.schedule`. Delete.
- OpenRouter wiring in `apps/api/src/lib/ai.ts` and `IMAGE_GEN_MODEL` — replaced by `apps/agents/src/lib/ai-gateway.ts`. Delete.

Auth service: Postgres slimmed to Better Auth's own tables (`user`, `session`, `account`, `verification`, `organization`, `organizationMember`). The Prisma schema is pruned to those.

**Tech stack:** mostly deletions. Some Better Auth handler-mounting refinements. No new libraries.

**Builds on:** `main` after P6 merged. Practically, **acceptance for P7 also requires P2–P6 are not just merged but** ***deployed*** **and verified live** — you can't retire the old service before the new one is the proven path.

**Architectural calls baked in** (T1.4 override):
1. **Cutover happens in a single PR, not incrementally.** The new surfaces are already live; the old surfaces are dead code by P6. One PR removes them atomically with the env re-point. Half-state is worse than either state.
2. **Slim Postgres in place, don't migrate to a new database.** Auth keeps the same instance; we just `prisma migrate` away the platform models. Lower risk than spinning up a fresh Postgres for auth-only.
3. **The `apps/api` directory disappears entirely.** Auth lives in a new `apps/auth` (or stays as `apps/api` renamed). Picking a new clean name removes the cognitive overhang of "the old api" — and forces every consumer's config to update through one explicit cut.

---

## File map

| File / path | Tasks | Responsibility |
|---|---|---|
| `apps/auth/` (renamed from `apps/api`) | 3 | The lean auth-only service |
| `apps/api/src/routes/v1/web-chat.ts` | 4 | Deleted — superseded by P1 |
| `apps/api/src/routes/v1/{agents,approvals,activity,runs,soul,team}.ts` | 4 | Deleted — superseded by P4/P5 backoffice routes |
| `apps/api/src/connectors/**`, `apps/api/src/inbox/**` | 4 | Deleted — superseded by P6 |
| `apps/api/src/agents/**`, `apps/api/src/workers/**`, `apps/api/src/agent-runtime` | 4 | Deleted — superseded by P3/P4 |
| `apps/api/src/lib/ai.ts`, `apps/api/src/lib/image-gen.ts` | 4 | Deleted — superseded by `apps/agents/src/lib/ai-gateway.ts` |
| `apps/api/src/scripts/**` | 4 | Audited: anything still useful for auth → moved to `apps/auth/scripts/`; the rest deleted |
| `packages/db/prisma/schema.prisma` | 5 | Pruned to Better Auth + Organization tables only |
| `apps/agents/src/routes/me.ts` (new) | 6 | The `/me` shape the Worker (and the client's `requireCustomer`) need — resolves user → currentOrg → role from Better Auth's organization plugin |
| `apps/client/.env` · `apps/backoffice/.env` | 7 | Re-point — `NEXT_PUBLIC_AGENTS_URL` already in client; backoffice gets one too |
| `apps/client/src/lib/api-server.ts` · `apps/client/src/lib/api-client.ts` · `apps/client/src/lib/auth-helpers.ts` | 7 | `apiGetServer` and `requireCustomer` re-point to `apps/agents` instead of `apps/api` |
| `apps/backoffice/src/...` | 8 | Same re-point; if backoffice was already migrated route-by-route in P4/P5, this just deletes the legacy adapter |
| `docker-compose.yml` | 9 | Drop the `redis` service; keep `postgres` for auth |
| `CLAUDE.md`, `docs/LOCAL_DEV.md`, `docs/ARCHITECTURE.md`, root `package.json` | 10 | Reflect the new world — three apps (auth, agents, backoffice + client), no Redis, no BullMQ, no Prisma platform models |
| `pnpm-lock.yaml`, root `package.json` | 10 | Drop unused deps |

---

## Tasks

### T1: Setup + readiness check

- [ ] Branch from `main` → `feat/p7-cutover`. Baseline gates green.
- [ ] **Readiness gate:** P2–P6 are merged AND a deployed `apps/agents` has run a real customer end-to-end (the P6 acceptance bullets). If not, *don't run P7*. Document the gate explicitly here so the future-you doesn't bypass.
- [ ] Confirm baked-in calls (single-PR cutover, slim Postgres in place, rename `apps/api` → `apps/auth`).

### T2: Inventory of remaining `apps/api` consumers

- [ ] Greppable inventory: which paths under `/api/*` does the client still call? `apps/client/src/**` + `apps/backoffice/src/**`. Capture in a one-table doc inside the PR description. If any path lives in `apps/api` but not in `apps/agents`, that's a P7 *migration* task; if everything lives in `apps/agents`, the cutover is pure deletion.
- [ ] Expected after P6: only `/api/auth/*` and possibly `/api/v1/me` remain in `apps/api`. Anything else is a P4/P5/P6 oversight to be back-filled.

### T3: Rename `apps/api` → `apps/auth`

- [ ] `git mv apps/api apps/auth`.
- [ ] Update `pnpm-workspace.yaml` (no change — `apps/*` glob covers it).
- [ ] Update `package.json` name to `auth`. Update `turbo.json` filters if any are name-specific (`--filter=api` → `--filter=auth`).
- [ ] Rename the dev script port if desired (e.g. `:4000` → `:4001` to free `:4000`?) — only if the port reuse is more confusing than helpful. Probably leave at `:4000`.
- [ ] Smoke: `pnpm --filter=auth dev`, `curl http://localhost:4000/api/auth/get-session` returns the expected shape.

### T4: Delete legacy `apps/auth` surface

- [ ] Delete: `src/routes/v1/{web-chat,agents,approvals,activity,runs,soul,team}.ts`. Delete: `src/connectors/**`, `src/inbox/**`, `src/agents/**`, `src/workers/**`, `src/agent-runtime/**`, `src/lib/ai.ts`, `src/lib/image-gen.ts`, `src/scripts/**` (audit each first).
- [ ] Delete the BullMQ + Redis dependency from `apps/auth/package.json` (`bullmq`, `ioredis`).
- [ ] Delete OpenRouter env handling from `apps/auth/.env.example` (move `OPENROUTER_API_KEY` documentation to `apps/agents/.dev.vars.example`).
- [ ] Update `apps/auth/src/index.ts` / route mounts so only `/healthz`, `/readyz`, `/api/auth/*` (Better Auth handler), and `/api/v1/me` (if it stays here) are exposed.
- [ ] Local typecheck + lint + tests green.

### T5: Slim Postgres / Prisma schema

- [ ] `packages/db/prisma/schema.prisma` — keep only: `User`, `Session`, `Account`, `Verification`, `Organization`, `OrgMembership` (or whatever the Better Auth org plugin requires). Delete the agent-domain models (`AgentTemplate`, `AgentInstance`, `Skill`, `ConnectorInstance`, `AgentConnectorBinding`, `AgentAction`, `AgentRun`, `ActivityLog`, `Routine`, `KnowledgeDoc`, `BrandAsset`, `Conversation`, `Message`, …).
- [ ] `pnpm db:push` to apply (the data is already orphaned and won't be queried by the new auth-only service).
- [ ] Optional cleanup: `DROP TABLE` the now-orphan tables explicitly. Or just leave them; they don't hurt anything.

### T6: `/api/v1/me` lives in `apps/agents`

- [ ] If P5 already moved it, skip. Otherwise: `apps/agents/src/routes/me.ts` — Hono route gated by `validateSession`; reads `currentOrg` via Better Auth's organization plugin (call the auth service if needed) and returns `MeResponse` in the shape `apps/client/src/lib/auth-helpers.ts` expects.
- [ ] `apps/client/src/lib/auth-helpers.ts` — `requireCustomer` re-pointed from `apps/api`'s `/api/v1/me` to `apps/agents`'s.

### T7: Re-point client

- [ ] `apps/client/.env` — `NEXT_PUBLIC_API_URL` (which used to point at `apps/api` for non-auth REST) is dropped or re-pointed to `NEXT_PUBLIC_AGENTS_URL`. `NEXT_PUBLIC_AUTH_URL` introduced for auth-only calls (`apps/auth`). Update auth-client to use `NEXT_PUBLIC_AUTH_URL`.
- [ ] `apps/client/src/lib/api-server.ts` + `api-client.ts` — point at `NEXT_PUBLIC_AGENTS_URL`.
- [ ] Verify the legacy `/web-chat/*` calls are truly gone (they should be since P1).

### T8: Re-point backoffice

- [ ] Same exercise for `apps/backoffice/.env` + its `api-server`/`api-client`.
- [ ] If backoffice still consumes any `apps/api` route that wasn't migrated in P4/P5, *that* is a back-fill task — pause P7 and complete the migration first. Don't ship a half-cutover.

### T9: Drop Redis

- [ ] `docker-compose.yml` — delete the `redis` service definition.
- [ ] `docs/LOCAL_DEV.md` — update to reflect the new dev surface (Postgres only, plus the three pnpm dev scripts).
- [ ] `apps/auth/.env.example` — remove `REDIS_URL`.

### T10: Docs, deps, final cleanup

- [ ] Root `package.json` / `pnpm-lock.yaml` — `pnpm install` after the deletions to prune the lockfile.
- [ ] `CLAUDE.md` — update the apps table: now `auth`, `agents`, `backoffice`, `client`. Update commands. Note that Postgres is auth-only.
- [ ] `docs/ARCHITECTURE.md` (or whatever the architecture doc became) — final post-cutover topology diagram. The "P1 walking skeleton" topology section from earlier docs is now the *only* topology.
- [ ] `MEMORY.md` (the project memory file) — update `qolmeia-mvp-decisions.md` to reflect that the system has finished cutover; the file moves to a "post-cutover decisions" or is retired entirely in favor of `cloudflare-rebuild-decisions.md`.
- [ ] Re-issue Telegram / WhatsApp / Slack / Discord webhook URLs at each provider to the new `apps/agents` endpoints (the legacy `apps/api` URLs go dead with this PR).

### T11: Tests + Wrap

- [ ] Full repo gates green. Auth tests pass against the slim Prisma schema. Agents tests untouched. Client/backoffice tests reflect the re-point.
- [ ] PR `feat/p7-cutover → main`. Acceptance:
  - [ ] No process in the repo references `apps/api` anymore.
  - [ ] `docker-compose ps` shows only `postgres` (no `redis`).
  - [ ] A logged-in customer chats end-to-end against `apps/agents` with `apps/auth` as the only Node service in the picture.
  - [ ] An operator uses the backoffice end-to-end against `apps/agents` REST.
  - [ ] Telegram/WhatsApp webhook from the provider hits the new endpoint and round-trips.

---

## Risks

- **The single-PR cutover is also the single-PR rollback risk.** If something the legacy `apps/api` *did* was load-bearing in a non-obvious way (a cron, a side-effecting startup hook, a one-off script someone runs by hand), deleting it surfaces in production. Mitigation: T2's inventory is the gate. If the inventory shows anything you don't recognize, *don't delete*; understand it first.
- **The Prisma model deletion is irreversible without a backup.** `prisma db push` against a schema with no `AgentInstance` will *drop* the table. Snapshot Postgres before T5. Or skip the `DROP TABLE` step and let the orphans sit forever (they cost nothing).
- **Webhook URL re-issue at providers is a coordinated, time-bound act.** Telegram's `setWebhook` is one API call but other providers (WhatsApp, Slack) involve dashboard navigation. Plan the window; communicate to anyone who might message a bot in that minute.
- **`NEXT_PUBLIC_API_URL` going away affects browser caches.** Service workers / browser caches on the client app may hold stale references. Bump a cache-buster in the client's build to invalidate.
- **Auth-domain Postgres is still a single point of failure.** Surviving the cutover only narrows what depends on it. P7 doesn't redundancy that out — that's a separate ops concern (read replicas, backups). Document the new dependency map post-cutover so the failure modes are visible.
