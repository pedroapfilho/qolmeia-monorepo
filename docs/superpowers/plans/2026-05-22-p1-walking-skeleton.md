# P1 — Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the new `apps/agents` Cloudflare Worker with one thin end-to-end path live on `*.workers.dev`: an authenticated customer in `apps/client` chats a `CorrespondentAgent` Durable Object over WebSocket; the DO runs an `agents` SDK chat loop through Cloudflare AI Gateway and streams a reply; messages persist to D1. No Team, no Workers, no tools, no Workflows — a hard-coded single Company. This phase proves the hard integration (DO + `agents` SDK + D1 + AI Gateway + WebSocket chat) before anything else is built.

**Architecture:** New `apps/agents` directory, parallel to `apps/api` which keeps serving the live apps untouched. One Worker script, one DO class (`CorrespondentAgent extends AIChatAgent`), one D1 database (three tables), one AI Gateway. The client app's chat surface swaps its hand-rolled SSE transport for the `agents` SDK's `useAgentChat` WebSocket hook; `ai-elements` UI components stay. Auth is **reused, not built** — the existing Better Auth service (in `apps/api`) issues the session; the Worker validates it.

**Tech stack:** Cloudflare Workers + Durable Objects, `agents` SDK (`Agent`/`AIChatAgent`, `routeAgentRequest`), Wrangler 4, D1 (serverless SQLite), Cloudflare AI Gateway proxying OpenRouter (reuses existing `OPENROUTER_API_KEY` credit for P1), Vercel AI SDK v6, Hono on Workers, `@cloudflare/vitest-pool-workers` for tests. Client: Next.js 16, `@cloudflare/ai-chat/react` (`useAgentChat`) + `agents/react` (`useAgent`), existing `ai-elements` components.

**Builds on:** `main` — spec at `docs/superpowers/specs/2026-05-22-cloudflare-agent-platform-design.md` (§11 phase P1). Branch off `main`, not the spec branch.

**Out of scope (later phases):** full D1 schema + role guards (P2), Vectorize memory (P2), the catalog/skills (P3), Worker agents + delegation (P3), Workflows + approval loop (P4), Planner/onboarding (P5), remaining connectors (P6), retiring `apps/api` (P7).

---

## File map (what every task touches)

| File                                                | Tasks      | Responsibility                                                               |
| --------------------------------------------------- | ---------- | ---------------------------------------------------------------------------- |
| `apps/agents/package.json` (new)                    | 2          | Worker package — deps, scripts                                               |
| `apps/agents/wrangler.jsonc` (new)                  | 2, 3, 4, 5 | Worker config — DO binding + migration, D1, AI Gateway vars                  |
| `apps/agents/tsconfig.json` (new)                   | 2          | Extends `@repo/typescript-config`                                            |
| `apps/agents/worker-configuration.d.ts` (generated) | 2, 3       | `wrangler types` output — never hand-edit                                    |
| `apps/agents/migrations/0001_p1_minimal.sql` (new)  | 3          | `company` · `conversation` · `message`                                       |
| `apps/agents/src/index.ts` (new)                    | 6          | Worker `fetch` entry — Hono router, `routeAgentRequest`, CORS, session check |
| `apps/agents/src/agents/correspondent.ts` (new)     | 5          | `CorrespondentAgent extends AIChatAgent`                                     |
| `apps/agents/src/lib/ai-gateway.ts` (new)           | 4          | AI SDK provider pointed at the AI Gateway endpoint                           |
| `apps/agents/src/lib/auth.ts` (new)                 | 6          | Minimal session validation against the existing auth service                 |
| `apps/agents/src/db/schema.ts` (new)                | 3          | Typed D1 row shapes + query helpers                                          |
| `apps/agents/src/__tests__/*.test.ts` (new)         | 8          | `vitest-pool-workers` integration tests                                      |
| `apps/agents/vitest.config.ts` (new)                | 8          | `@cloudflare/vitest-pool-workers` config                                     |
| `turbo.json`                                        | 2          | Register `apps/agents` task pipeline                                         |
| `apps/client/src/components/chat.tsx`               | 7          | Swap `useChat` + custom transport for `useAgentChat`                         |
| `apps/client/src/lib/web-chat-transport.ts`         | 7          | Deleted — replaced by the SDK hook                                           |
| `apps/client/package.json`                          | 7          | Add `agents` + `@cloudflare/ai-chat`                                         |
| `apps/client/.env`                                  | 7, 9       | `NEXT_PUBLIC_AGENTS_URL`                                                     |

---

## Task 1: Setup — branch, baseline, Cloudflare prerequisites

**Files:** none modified

- [ ] **Step 1: Branch from `main`**

```bash
git checkout main && git pull && git checkout -b feat/p1-walking-skeleton
git log --oneline -1
```

- [ ] **Step 2: Confirm baseline gates are green**

Each must exit 0: `pnpm install`, `pnpm typecheck`, `pnpm lint`.

- [ ] **Step 3: Confirm Cloudflare access**

Run `pnpm dlx wrangler whoami`. If not logged in, the operator runs `! wrangler login` in this session. Record the **account id** — it is needed for the AI Gateway endpoint (Task 4).

- [ ] **Step 4: Decide the monorepo tooling boundary (open question §14.8 of the spec)**

`apps/agents` uses Wrangler, not the `tsdown` path `apps/api` uses. Decision for this plan: `apps/agents` joins the existing `apps/*` workspace glob (no `pnpm-workspace.yaml` change needed). Its Turborepo tasks are `dev` (`wrangler dev`, not cached, persistent), `deploy` (`wrangler deploy`), `typecheck` (`tsc --noEmit`), `test` (`vitest`). There is no `build` task — `wrangler deploy` bundles at deploy time; `pnpm build` excludes `apps/agents`. This is registered in Task 2, Step 4.

---

## Task 2: Scaffold the `apps/agents` Worker

**Files:** `apps/agents/package.json`, `apps/agents/tsconfig.json`, `apps/agents/wrangler.jsonc`, `turbo.json`

- [ ] **Step 1: Create `apps/agents/package.json`**

Name `agents`, `private: true`, `type: "module"`. Dependencies: `agents`, `@cloudflare/ai-chat`, `ai`, `hono`, `zod`. Dev dependencies: `wrangler`, `@cloudflare/workers-types`, `@cloudflare/vitest-pool-workers`, `vitest`, `typescript`, `@repo/typescript-config` (workspace). Scripts:

```json
{
  "dev": "wrangler dev",
  "deploy": "wrangler deploy",
  "typecheck": "wrangler types && tsc --noEmit",
  "test": "vitest run",
  "cf-typegen": "wrangler types"
}
```

- [ ] **Step 2: Create `apps/agents/tsconfig.json`**

Extend `@repo/typescript-config/server.json`. Add `"types": ["@cloudflare/workers-types", "./worker-configuration.d.ts"]`, `"lib": ["ESNext"]`, path alias `"@/*": ["./src/*"]`. Include `src`, `worker-configuration.d.ts`.

- [ ] **Step 3: Create `apps/agents/wrangler.jsonc`** (DO + migration filled in Task 5, D1 in Task 3, vars in Task 4)

```jsonc
{
  "name": "qolmeia-agents",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
}
```

- [ ] **Step 4: Register the Turborepo pipeline**

In `turbo.json`, ensure `dev` is `"cache": false, "persistent": true`. Add a `deploy` task (`"cache": false`, depends on `^build`). Confirm `typecheck` and `test` tasks already cover `apps/agents` via the glob. Do **not** add `apps/agents` to the `build` task's package set.

- [ ] **Step 5: Verify scaffold**

```bash
pnpm install
pnpm --filter=agents cf-typegen   # generates worker-configuration.d.ts
pnpm --filter=agents typecheck
```

Both must exit 0. Commit: `chore(agents): scaffold apps/agents Cloudflare Worker`.

---

## Task 3: D1 database + minimal schema

**Files:** `apps/agents/wrangler.jsonc`, `apps/agents/migrations/0001_p1_minimal.sql`, `apps/agents/src/db/schema.ts`

- [ ] **Step 1: Create the D1 database**

```bash
pnpm dlx wrangler d1 create qolmeia-agents
```

Copy the returned `database_id` into `wrangler.jsonc`:

```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "qolmeia-agents", "database_id": "<id>", "migrations_dir": "migrations" }
]
```

- [ ] **Step 2: Write `migrations/0001_p1_minimal.sql`**

The P1 slice of the §5.1 schema — three tables only. `company`, `conversation`, `message` (columns per spec §5.1, minus tables not needed yet). Add the index `message(conversation_id, created_at)`.

- [ ] **Step 3: Apply the migration locally and remotely**

```bash
pnpm dlx wrangler d1 migrations apply qolmeia-agents --local
pnpm dlx wrangler d1 migrations apply qolmeia-agents --remote
```

- [ ] **Step 4: Seed the hard-coded P1 Company**

Insert one `company` row (id `p1-demo-company`, status `active`) into both local and remote D1 via `wrangler d1 execute`. P1 hard-codes this id; P2 replaces it with real onboarding.

- [ ] **Step 5: Create `src/db/schema.ts`**

Typed row shapes (`type Company`, `type Conversation`, `type Message`) and small query helpers (`upsertConversation`, `insertMessage`, `listMessages`). Plain parameterized `env.DB.prepare(...)` — no ORM in P1. Re-run `cf-typegen` so `env.DB` is typed.

- [ ] **Step 6: Verify + commit**

`pnpm --filter=agents typecheck` exits 0. Commit: `feat(agents): D1 database + minimal P1 schema`.

---

## Task 4: AI Gateway provider

**Files:** `apps/agents/src/lib/ai-gateway.ts`, `apps/agents/wrangler.jsonc`

- [ ] **Step 1: Create the AI Gateway**

In the Cloudflare dashboard (or `wrangler`), create an AI Gateway named `qolmeia`. Note the endpoint shape: `https://gateway.ai.cloudflare.com/v1/{accountId}/qolmeia/openrouter`.

- [ ] **Step 2: Store the provider key as a Worker secret**

P1 reuses existing OpenRouter credit. Take `OPENROUTER_API_KEY` from `apps/api/.env`:

```bash
cd apps/agents && pnpm dlx wrangler secret put OPENROUTER_API_KEY
```

Add non-secret vars to `wrangler.jsonc`: `"vars": { "AI_GATEWAY_ACCOUNT_ID": "<id>", "AI_GATEWAY_NAME": "qolmeia", "CORRESPONDENT_MODEL": "openai/gpt-5.3-chat" }`.

- [ ] **Step 3: Create `src/lib/ai-gateway.ts`**

Export `getModel(env)` — an AI SDK provider (`createOpenAI` from `@ai-sdk/openai`, or `@openrouter/ai-sdk-provider`) with `baseURL` set to the AI Gateway OpenRouter endpoint and `apiKey: env.OPENROUTER_API_KEY`. Returns `provider(env.CORRESPONDENT_MODEL)`. This is the one seam tests stub (Task 8).

- [ ] **Step 4: Verify + commit**

`pnpm --filter=agents typecheck` exits 0. Commit: `feat(agents): AI Gateway provider`.

---

## Task 5: `CorrespondentAgent` Durable Object

**Files:** `apps/agents/src/agents/correspondent.ts`, `apps/agents/wrangler.jsonc`

- [ ] **Step 1: Add the DO binding + migration to `wrangler.jsonc`**

```jsonc
"durable_objects": {
  "bindings": [{ "name": "CORRESPONDENT", "class_name": "CorrespondentAgent" }]
},
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["CorrespondentAgent"] }]
```

- [ ] **Step 2: Implement `CorrespondentAgent extends AIChatAgent`**

In `src/agents/correspondent.ts`. Confirm the exact base class + import against current docs (`@cloudflare/ai-chat` vs `agents`) — verify before coding. The class:

- Implements the `AIChatAgent` chat handler: on an incoming user message, run the AI SDK chat loop (`streamText`) with `getModel(this.env)`, a fixed P1 system prompt (a pt-BR Correspondent persona — friendly account manager, no tools yet), and the conversation history.
- Persists each user + agent message to D1 (`insertMessage`) keyed by a conversation id derived from the DO name.
- Streams the reply back over the WebSocket the SDK manages.
- No tools, no delegation, no memory retrieval — those are P2/P3.

- [ ] **Step 3: Export the DO class from `src/index.ts`**

The Worker entry must `export { CorrespondentAgent }` for the runtime to bind it.

- [ ] **Step 4: Verify + commit**

`pnpm --filter=agents cf-typegen && pnpm --filter=agents typecheck` exits 0. Commit: `feat(agents): CorrespondentAgent durable object`.

---

## Task 6: Worker entry — router, routing, CORS, session check

**Files:** `apps/agents/src/index.ts`, `apps/agents/src/lib/auth.ts`

- [ ] **Step 1: Create `src/lib/auth.ts` — minimal session validation**

P1 reuses the existing auth service. `validateSession(request, env)` reads the Better Auth session cookie and validates it by calling the existing auth service's `get-session` endpoint (`apps/api`'s `/api/auth/get-session`), returning `{ userId } | null`. P1 needs only "is this a logged-in user" — full role guards + membership are P2. Add `AUTH_SERVICE_URL` to `wrangler.jsonc` vars.

- [ ] **Step 2: Create `src/index.ts` — the Hono router**

- CORS middleware: `Access-Control-Allow-Origin` = the `apps/client` origin, `credentials: true`.
- A health route `GET /healthz`.
- WebSocket chat: delegate to `routeAgentRequest(request, env)` so the client's `useAgent` connection routes to the `CorrespondentAgent` DO. Gate it with `validateSession` first — reject unauthenticated upgrades with 401.
- Fallback 404.
- `export default { fetch }` + `export { CorrespondentAgent }`.

- [ ] **Step 3: Local smoke test**

```bash
pnpm --filter=agents dev
```

`curl http://localhost:8787/healthz` returns 200. Leave the server for Task 7's manual test.

- [ ] **Step 4: Verify + commit**

`pnpm --filter=agents typecheck` exits 0. Commit: `feat(agents): worker router, agent routing, session gate`.

---

## Task 7: Re-point the `apps/client` chat to `useAgentChat`

**Files:** `apps/client/src/components/chat.tsx`, `apps/client/src/lib/web-chat-transport.ts` (delete), `apps/client/package.json`, `apps/client/.env`

- [ ] **Step 1: Add client dependencies**

`pnpm --filter=client add agents @cloudflare/ai-chat`.

- [ ] **Step 2: Add `NEXT_PUBLIC_AGENTS_URL` to `apps/client/.env`**

Local: `http://localhost:8787`. (Remote URL set in Task 9.)

- [ ] **Step 3: Rewrite `chat.tsx` to use the SDK hook**

Replace `useChat` (`@ai-sdk/react`) + `createWebChatTransport` with `useAgent({ agent: "correspondent", host: NEXT_PUBLIC_AGENTS_URL })` + `useAgentChat({ agent })`. Keep every `ai-elements` component (`Conversation`, `Message`, `PromptInput`, `Loader`) exactly as-is — they are transport-agnostic. The hook supplies `messages`, `sendMessage`, `status`; the render tree is unchanged.

- [ ] **Step 4: Delete `src/lib/web-chat-transport.ts`**

It is fully replaced by the SDK's WebSocket transport. Remove any now-dead imports.

- [ ] **Step 5: Manual end-to-end test**

With `apps/api` (auth), `apps/agents` (`pnpm --filter=agents dev`), and `apps/client` all running: log into `apps/client`, open the chat, send a message. The reply must stream token-by-token. Refresh — history persists (from D1). Check `wrangler d1 execute qolmeia-agents --local --command "SELECT * FROM message"` shows both rows.

- [ ] **Step 6: Verify + commit**

`pnpm --filter=client typecheck && pnpm --filter=client lint` exit 0. Commit: `feat(client): chat over agents SDK WebSocket transport`.

---

## Task 8: Tests — `vitest-pool-workers`

**Files:** `apps/agents/vitest.config.ts`, `apps/agents/src/__tests__/*.test.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

Use `@cloudflare/vitest-pool-workers`'s `defineWorkersConfig`, pointing at `wrangler.jsonc` so tests run in real `workerd` with Miniflare D1 + DO.

- [ ] **Step 2: Stub the model seam**

A test helper that swaps `getModel` for a scripted AI SDK `LanguageModel` returning a canned streamed reply — the loop must be deterministic.

- [ ] **Step 3: Write the tests**

- `healthz` returns 200.
- Unauthenticated WebSocket upgrade → 401.
- `CorrespondentAgent`: an authenticated chat message runs the loop with the scripted model, streams the canned reply, and writes two `message` rows to D1.
- `db/schema.ts` helpers: `upsertConversation` idempotency, `listMessages` ordering.

- [ ] **Step 4: Verify + commit**

`pnpm --filter=agents test` exits 0. Commit: `test(agents): P1 walking-skeleton integration tests`.

---

## Task 9: Deploy to `*.workers.dev` + remote smoke test

**Files:** `apps/client/.env`

- [ ] **Step 1: Deploy the Worker**

```bash
pnpm --filter=agents deploy
```

Record the `https://qolmeia-agents.<subdomain>.workers.dev` URL. Confirm the remote D1 migration + seed (Task 3 Steps 3–4) ran against the remote database.

- [ ] **Step 2: Point the client at the deployed Worker**

Set `NEXT_PUBLIC_AGENTS_URL` to the `workers.dev` URL. Confirm the Worker's CORS origin var covers the client's deployed origin (and `localhost:3001` for dev).

- [ ] **Step 3: Remote end-to-end smoke test**

Against the deployed Worker: log in, chat, confirm the reply streams and history persists. `curl https://qolmeia-agents.<subdomain>.workers.dev/healthz` returns 200.

- [ ] **Step 4: Commit**

`chore(client): point chat at deployed agents Worker`.

---

## Task 10: Wrap-up

**Files:** none modified

- [ ] **Step 1: Full-repo gates**

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check` — each exits 0. `apps/api` and `apps/backoffice` are untouched and still pass.

- [ ] **Step 2: Open the PR**

Push `feat/p1-walking-skeleton`; open a PR titled `P1 — Cloudflare walking skeleton`. Body links the spec §11 P1 row and lists the acceptance criteria below.

- [ ] **Step 3: Confirm acceptance**

- [ ] A logged-in customer chats a DO-hosted `CorrespondentAgent` in `apps/client` over WebSocket.
- [ ] The reply streams token-by-token through AI Gateway.
- [ ] Messages persist to D1; history survives a refresh.
- [ ] Unauthenticated connections are rejected.
- [ ] The Worker is live on `*.workers.dev`.
- [ ] `apps/api`, `apps/backoffice` are unchanged and green.

---

## Risks specific to P1

- **`agents` SDK base-class import.** `AIChatAgent` and `useAgentChat` may live in `@cloudflare/ai-chat` or `agents` depending on the SDK version — Task 5 Step 2 and Task 7 Step 3 must verify against current docs before coding, not assume.
- **AI Gateway endpoint shape.** The `/openrouter` provider path and auth-header passing are version-sensitive — verify with a `curl` against the Gateway before wiring the provider.
- **Session validation cross-service latency.** Calling `apps/api`'s `get-session` on every WebSocket upgrade is acceptable for P1; P2 replaces it with the proper validator (spec §9) and a short-TTL cache.
- **`workers.dev` cookie scope.** The session cookie is issued by the `apps/api` domain; the Worker is on `workers.dev`. P1 validates server-side (the Worker calls the auth service) so cross-domain cookie reads are not required — but confirm the client sends credentials on the WebSocket handshake.
- **DO migration tag.** `new_sqlite_classes` must be set once with tag `v1`; changing the class name later needs a new migration tag. Get the name right in Task 5.
