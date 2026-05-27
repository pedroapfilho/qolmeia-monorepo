# P2 — Schema, Auth, Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the P1 walking skeleton to be (1) **multi-tenant-ready** in the code path — the Correspondent DO is keyed by the customer's real org id resolved from session membership, not a hard-coded `p1-demo-company`; (2) **properly gated** — the Worker enforces CUSTOMER role/membership against the auth service, not just "is a logged-in user"; (3) **memory-bearing** — every turn assembles context from a recent-turns buffer (always-in-context) plus semantic recall (top-K from a vector store), and two skills (`rememberFact`, `recallMemory`) let the model write and search durable facts. P5's onboarding then adds _new_ companies to a code path that is already multi-tenant — no refactor.

**Architecture:** The full §5.1 schema lands in D1 (catalog and ticket/action tables remain unused until P3/P4 but the shape is in place). The session validator hits `apps/api`'s `/api/v1/me` with a Bearer token, resolves `{ userId, companyId, role }`, and rejects anything that isn't CUSTOMER on agent paths. The memory layer is a `MemoryAdapter` interface with two implementations: **production** (Workers AI `@cf/baai/bge-m3` for embeddings + Vectorize for storage/recall) and **local-dev** (an in-memory cosine-similarity store), selected by env. Each agent gets a recent-turns buffer in its DO SQLite — the always-in-context window the SDK reads on reconnect — plus a semantic recall step that fires at turn start. `MemoryAdapter` mirrors `getModel`'s "Cloudflare prod / local dev" split (P1's spine for the "Cloudflare-first, not only" principle).

**Tech stack:** `agents` SDK (`AIChatAgent` + `this.sql`), AI SDK v6, Workers AI binding (`@cf/baai/bge-m3` — multilingual embeddings; pt-BR-capable), Vectorize index with metadata filter on `agentInstanceId`, in-memory cosine fallback for dev/tests, `@cloudflare/vitest-pool-workers`.

**Builds on:** `main` at `0550292` (P1 walking skeleton verified live + the two fix-forward commits for CORS and Bearer auth). Spec: `docs/superpowers/specs/2026-05-22-cloudflare-agent-platform-design.md` §11 P2.

**Out of scope:** the catalog/skills D1 overlay (P3 — code registry is in scope here, the D1 `skill` table is not), Worker agents and delegation (P3), Workflows + approval loop (P4), onboarding (P5), more connectors (P6).

**Two architectural calls baked into this plan** (open for review before T1):

1. **Memory uses an adapter with a dev backend** — local dev stays Cloudflare-account-free. Same shape as `getModel`'s OpenRouter-direct fallback.
2. **Multi-tenant code path, single-tenant data** — DO name resolves from real membership; we seed one company whose id equals the auth org id.

---

## File map (what every task touches)

| File                                                   | Tasks    | Responsibility                                                                                                                                                                               |
| ------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/agents/migrations/0002_p2_full_schema.sql` (new) | 2        | Extend D1 with team / agent_instance / connector / conversation extensions / ticket / action / asset / memory_fact / activity_log (per §5.1) — catalog tables included; left unused until P3 |
| `apps/agents/scripts/seed-p2.sql` (new)                | 3        | Re-seed company with the real auth org id; supersedes `seed-p1.sql`                                                                                                                          |
| `apps/agents/src/db/schema.ts`                         | 2, 11    | Typed row shapes + query helpers for the new tables and `memory_fact`                                                                                                                        |
| `apps/agents/src/lib/auth.ts`                          | 4        | Validator returns `{ userId, companyId, role }` from `/api/v1/me`; not just "is a logged-in user"                                                                                            |
| `apps/agents/src/lib/membership.ts` (new)              | 4        | Typed parse of the `/api/v1/me` response (zod)                                                                                                                                               |
| `apps/agents/src/index.ts`                             | 5        | CUSTOMER role guard on agent paths; resolved company id put on request context                                                                                                               |
| `apps/agents/src/agents/correspondent.ts`              | 6, 8, 10 | DO no longer references `P1_COMPANY_ID`; reads its company id from `this.name` (set by `routeAgentRequest`); memory wired into `onChatMessage`                                               |
| `apps/agents/src/lib/memory/adapter.ts` (new)          | 7        | `MemoryAdapter` interface — `embed`, `upsert`, `retrieve`                                                                                                                                    |
| `apps/agents/src/lib/memory/in-memory.ts` (new)        | 7        | Cosine-similarity dev/test backend                                                                                                                                                           |
| `apps/agents/src/lib/memory/vectorize.ts` (new)        | 8        | Workers AI embed + Vectorize upsert/query backend                                                                                                                                            |
| `apps/agents/src/lib/memory/index.ts` (new)            | 7, 8     | `getMemoryAdapter(env)` — selects backend based on bindings                                                                                                                                  |
| `apps/agents/src/agents/recent-turns.ts` (new)         | 9        | DO-SQLite-backed recent-turns buffer (the always-in-context window)                                                                                                                          |
| `apps/agents/src/skills/registry.ts` (new)             | 11       | Typed skill module pattern; export `ALL_SKILLS`                                                                                                                                              |
| `apps/agents/src/skills/remember-fact.ts` (new)        | 11       | `rememberFact` skill — writes a structured fact (D1 + memory adapter)                                                                                                                        |
| `apps/agents/src/skills/recall-memory.ts` (new)        | 11       | `recallMemory` skill — semantic search over the agent's memory                                                                                                                               |
| `apps/agents/wrangler.jsonc`                           | 2, 8     | New bindings: `AI` (Workers AI), `VECTORIZE` (Vectorize index)                                                                                                                               |
| `apps/agents/src/__tests__/*.test.ts` (new)            | 12       | Schema migrations · session validator · role guard · in-memory adapter · DO with memory · skills                                                                                             |
| `apps/client/src/components/chat.tsx`                  | 5        | `name` prop on `useAgent` becomes the real org id (passed from server)                                                                                                                       |
| `apps/client/src/app/(client)/page.tsx`                | 5        | Server component passes the user's membership company id alongside the session token                                                                                                         |

---

## Task 1: Setup — branch, baseline, prereqs

**Files:** none modified

- [ ] **Step 1: Branch from `main`**

```bash
git checkout main && git pull && git checkout -b feat/p2-schema-auth-memory
git log --oneline -1   # expect: 0550292 fix(agents): CORS for agent paths + Bearer-based session validation
```

- [ ] **Step 2: Baseline gates green**

Each must exit 0: `pnpm typecheck`, `pnpm lint`. `pnpm test` should show all groups green including `qolmeia-agents` at 9 tests.

- [ ] **Step 3: Confirm the auth org id we're aligning to**

```bash
docker compose exec -T postgres psql -U qolmeia -d qolmeia -tAc 'SELECT id, slug FROM "Organization";'
```

Record the id (the org `qolmeia-dev` is the existing dev tenant — its id becomes the new D1 `company.id`).

- [ ] **Step 4: Confirm the two baked-in architectural calls**

Either proceed (calls in §intro stand) or amend the plan before T2. Specifically:

- Memory uses an adapter with a dev backend (no Cloudflare account required for local dev).
- DO name = real membership company id in the code path; data still single-tenant.

---

## Task 2: Full D1 schema migration

**Files:** `apps/agents/migrations/0002_p2_full_schema.sql`, `apps/agents/src/db/schema.ts`, `apps/agents/wrangler.jsonc`

- [ ] **Step 1: Write `migrations/0002_p2_full_schema.sql`**

Land every table from spec §5.1 that isn't in P1's migration: `team`, `agent_instance`, `team_member`, `connector`, `webhook_event`, `ticket`, `action`, `asset`, `memory_fact`, `activity_log`. Catalog tables (`template`, `skill`) also land here for forward-compat — they sit empty until P3. **Drop the connector reference from `conversation` for P2** (still optional) — it lands properly when P6 adds connectors. Same indexes as §5.1.

- [ ] **Step 2: Apply locally + verify**

```bash
cd apps/agents
pnpm exec wrangler d1 migrations apply qolmeia-agents --local
pnpm exec wrangler d1 execute qolmeia-agents --local --command "SELECT name FROM sqlite_master WHERE type='table'"
```

Expect all the new table names listed alongside the P1 three.

- [ ] **Step 3: Extend `src/db/schema.ts`**

Typed row shapes + query helpers for `memory_fact` only (the other tables are populated in P3/P4/P6 — defining `MemoryFact` and `insertMemoryFact` / `listMemoryFacts` is what P2 needs). Keep the P1 helpers untouched.

- [ ] **Step 4: Verify + commit**

`pnpm typecheck` exit 0. Commit: `feat(agents): D1 schema for P2 (memory + catalog + tickets)`.

---

## Task 3: Tenancy realignment — seed company with the auth org id

**Files:** `apps/agents/scripts/seed-p2.sql`, `apps/agents/scripts/seed-p1.sql` (deleted)

- [ ] **Step 1: Replace the P1 seed**

`seed-p2.sql` inserts (idempotent) one `company` row with id = the auth `Organization.id` from T1.3 (e.g. `cmpg10ke30000147uj4gpeadb`), slug `qolmeia-dev`, status `active`. Delete `seed-p1.sql`.

- [ ] **Step 2: Reset local D1 and reseed**

The P1-seeded `p1-demo-company` is now stale. Either drop and recreate the local D1, or delete the stale row first.

```bash
pnpm exec wrangler d1 execute qolmeia-agents --local --command "DELETE FROM message; DELETE FROM conversation; DELETE FROM company WHERE id='p1-demo-company';"
pnpm exec wrangler d1 execute qolmeia-agents --local --file scripts/seed-p2.sql
```

- [ ] **Step 3: Commit**

`feat(agents): seed company with the real auth org id`.

---

## Task 4: Real session validator — `/api/v1/me` for membership

**Files:** `apps/agents/src/lib/auth.ts`, `apps/agents/src/lib/membership.ts`

- [ ] **Step 1: Create `src/lib/membership.ts`**

Zod schema for the `/api/v1/me` response (`{ user: {...}, currentOrg: { id, slug, role }, role }`). Single source of truth for the parsed shape. Export `MeResponse` type + `parseMeResponse(json: unknown): MeResponse | null`.

- [ ] **Step 2: Rewrite `validateSession` to return `{ userId, companyId, role }`**

It still takes the `cf_session` token (Bearer) or forwarded cookie, but now hits `/api/v1/me` (not `/api/auth/get-session`) — `/api/v1/me` is the project's resolved-membership endpoint and the _one_ shape the Worker should depend on. Returns `null` for unauthenticated, network error, or non-CUSTOMER role.

> **Note:** `/api/v1/me` currently uses `requireAnyMember` (cookie-based). Verify it also accepts Bearer auth (Better Auth's bearer plugin is loaded — should work out of the box). If it doesn't, the smallest unblock is to add an explicit Bearer header pass-through in this T4 step rather than touch `apps/api`.

- [ ] **Step 3: Verify + commit**

Typecheck + lint exit 0. The session-validator unit (the zod schema, the role rejection branch) is testable in isolation — sketch tests now but the full test lands in T12. Commit: `feat(agents): session validator resolves membership from /api/v1/me`.

---

## Task 5: CUSTOMER role guard + DO name resolution

**Files:** `apps/agents/src/index.ts`, `apps/agents/src/agents/correspondent.ts`, `apps/client/src/app/(client)/page.tsx`, `apps/client/src/components/chat.tsx`

- [ ] **Step 1: Enforce CUSTOMER on agent paths**

In `src/index.ts`, after `validateSession` returns the resolved `{ userId, companyId, role }`, reject (403, with CORS) if `role !== "CUSTOMER"`. Backoffice operators still authenticate; they just don't connect to the customer chat surface.

- [ ] **Step 2: Drop the hard-coded company id in the DO**

Remove `P1_COMPANY_ID`, `P1_THREAD_ID`, `P1_CONVERSATION_ID` constants from `agents/correspondent.ts`. The DO reads its company id from `this.name` (the `agents` SDK sets it from `routeAgentRequest`'s name segment). Conversation id becomes `web:{this.name}` (the company id is `this.name`).

- [ ] **Step 3: Pass the real company id from the server component**

`apps/client/src/app/(client)/page.tsx` reads `requireCustomer()` (the existing helper already returns `MeResponse`) and passes `currentOrg.id` to `<Chat>` as the new `companyId` prop.

- [ ] **Step 4: `<Chat>` uses the real company id**

`useAgent({ agent: "correspondent", name: companyId, ... })`. The hard-coded `AGENT_INSTANCE` constant is removed.

- [ ] **Step 5: Manual end-to-end check**

With the full local stack running and a fresh customer login: confirm the chat reaches the Correspondent DO keyed by the auth org id (check the wrangler log for the route). Send a message; the D1 `conversation.company_id` should equal the auth org id, not `p1-demo-company`.

- [ ] **Step 6: Commit**

`feat(agents,client): real company-id-driven DO routing + CUSTOMER role guard`.

---

## Task 6: Memory adapter contract + in-memory dev backend

**Files:** `apps/agents/src/lib/memory/adapter.ts`, `apps/agents/src/lib/memory/in-memory.ts`, `apps/agents/src/lib/memory/index.ts`

- [ ] **Step 1: Define the `MemoryAdapter` interface**

```
type MemoryRecord = {
  id: string;              // ulid
  agentInstanceId: string; // per-agent isolation
  companyId: string;
  kind: 'message' | 'fact';
  content: string;
  createdAt: number;
};

type MemoryAdapter = {
  upsert(record: MemoryRecord): Promise<void>;
  retrieve(args: {
    agentInstanceId: string;
    query: string;       // embedded; the adapter handles the embedding call
    topK: number;
    minScore?: number;   // 0..1; default 0.5
  }): Promise<ReadonlyArray<MemoryRecord & { score: number }>>;
};
```

The adapter owns the embedding call so callers don't care which embedding model is used. Two implementations under this contract.

- [ ] **Step 2: Implement `in-memory.ts`**

A simple class holding `Map<agentInstanceId, MemoryRecord[]>` with cosine similarity over a small deterministic embedding (e.g. character n-grams or a tiny hash-based bag-of-words). The point isn't recall _quality_ in dev — it's running the _code path_ without a Cloudflare account. Tests use this same adapter.

- [ ] **Step 3: Implement `index.ts` — selector**

```
const getMemoryAdapter = (env: Env): MemoryAdapter => {
  if (env.VECTORIZE && env.AI) return new VectorizeMemoryAdapter(env);
  return new InMemoryMemoryAdapter();
};
```

Vectorize/Workers AI bindings present → production. Otherwise → dev. Mirrors `getModel`'s gateway-vs-direct fallback.

- [ ] **Step 4: Verify + commit**

Typecheck + lint exit 0. Commit: `feat(agents): MemoryAdapter contract + in-memory dev backend`.

---

## Task 7: Production memory backend — Vectorize + Workers AI

**Files:** `apps/agents/src/lib/memory/vectorize.ts`, `apps/agents/wrangler.jsonc`

- [ ] **Step 1: Add bindings to `wrangler.jsonc`**

```
"ai": { "binding": "AI" },
"vectorize": [{ "binding": "VECTORIZE", "index_name": "qolmeia-memory" }]
```

Both are PLACEHOLDER for local dev (no account); the adapter selector falls through to the in-memory backend. They become real during deploy (Cloudflare-account step, analogous to P1's `wrangler d1 create`).

- [ ] **Step 2: Implement `vectorize.ts`**

`embed(text)` → `env.AI.run("@cf/baai/bge-m3", { text: [text] })` (multilingual; covers pt-BR). `upsert` → `env.VECTORIZE.upsert([{ id, values, metadata: { agentInstanceId, companyId, kind, content, createdAt } }])`. `retrieve` → embed the query, then `env.VECTORIZE.query(vector, { topK, filter: { agentInstanceId } })`, hydrate metadata back into `MemoryRecord`, threshold on `score`.

- [ ] **Step 3: Re-run `cf-typegen` + typecheck**

The new `AI` and `VECTORIZE` bindings should appear in the generated `Env`. Typecheck exits 0.

- [ ] **Step 4: Commit**

`feat(agents): Vectorize + Workers AI memory backend`.

---

## Task 8: Recent-turns buffer (DO SQLite) + DO memory wiring

**Files:** `apps/agents/src/agents/recent-turns.ts`, `apps/agents/src/agents/correspondent.ts`

- [ ] **Step 1: `recent-turns.ts`**

A small module that reads/writes a `recent_turns` table on `this.sql` (per-agent DO SQLite). Functions: `appendTurn(sql, { role, content })`, `getRecentTurns(sql, n = 12)`, `pruneOldTurns(sql, keep = 100)`. The schema is initialized lazily on first write.

- [ ] **Step 2: Wire `onChatMessage` to memory**

In `CorrespondentAgent.onChatMessage`, before calling `streamText`:

- Persist the inbound user turn to D1 (already does this) + `appendTurn` + `memory.upsert({ kind: "message", ... })`.
- Build the model `messages` array as: system prompt + retrieved facts (top-K from `memory.retrieve(query=latestUserText)`) as a context block + last N recent turns (`getRecentTurns`). Do **not** feed all of `this.messages` — that's the dual-storage trap; the SDK persists for client history, but the model context is now built by us.
- After the stream completes (in `onFinish`), append the assistant turn to D1 + recent-turns + `memory.upsert({ kind: "message", ... })`.

- [ ] **Step 3: Verify locally**

With the in-memory backend active (no Vectorize), restart `wrangler dev`. Two turns: assert the second turn sees the first in context (e.g. ask "what did I just say?" → the agent references it via the recent-turns buffer; vector recall is a no-op for adjacent turns).

- [ ] **Step 4: Commit**

`feat(agents): recent-turns buffer + memory-aware context assembly`.

---

## Task 9: Skill registry + `rememberFact` + `recallMemory`

**Files:** `apps/agents/src/skills/registry.ts`, `apps/agents/src/skills/remember-fact.ts`, `apps/agents/src/skills/recall-memory.ts`, `apps/agents/src/agents/correspondent.ts`

- [ ] **Step 1: Define the skill module pattern**

```
type Skill<Input> = {
  id: string;
  description: string;
  inputSchema: ZodType<Input>;
  execute(input: Input, ctx: SkillContext): Promise<unknown>;
};
type SkillContext = { env: Env; agentInstanceId: string; companyId: string };
```

Export `ALL_SKILLS` from `registry.ts`. The D1 overlay table is P3; for P2 the description + config live in code.

- [ ] **Step 2: `remember-fact.ts`**

Input: `{ content: string; kind?: string }`. Execute: insert a `memory_fact` row in D1 + `memory.upsert({ kind: "fact", content })`. Returns `{ id, savedAt }`. This is the durable-fact write path — agents call it when they decide something is worth remembering long-term.

- [ ] **Step 3: `recall-memory.ts`**

Input: `{ query: string; topK?: number }`. Execute: `memory.retrieve` filtered to the calling agent. Returns the matches. This is the explicit recall path — the model can search past memory when retrieval-on-turn isn't enough (e.g. user asks "what did we decide about X").

- [ ] **Step 4: Expose skills to the Correspondent**

In `onChatMessage`, build the AI SDK tool set from `ALL_SKILLS` (id → `tool({ description, inputSchema, execute: (in) => skill.execute(in, ctx) })`). Pass to `streamText({ tools, stopWhen: stepCountIs(3) })`. The Correspondent now has two tools.

- [ ] **Step 5: Manual sanity check**

Send: "lembre que minha cor preferida é azul" — the agent should call `rememberFact`. Then start a fresh conversation (refresh): "qual é minha cor preferida?" — the agent calls `recallMemory`, finds the fact, answers correctly.

- [ ] **Step 6: Commit**

`feat(agents): rememberFact + recallMemory skills wired to the Correspondent`.

---

## Task 10: Tests — vitest-pool-workers

**Files:** `apps/agents/src/__tests__/*.test.ts` (new and extended)

Each layer gets a focused test. The model is mocked via the existing `resolveModel` seam.

- [ ] **Step 1: `auth-validator.test.ts`** — mock `/api/v1/me` fetch with three cases: 200+CUSTOMER → returns `{ userId, companyId, role: "CUSTOMER" }`; 200+STAFF → returns `null` (or the role; the guard rejects in `index.ts`); 401 → `null`; network error → `null` and `console.error` called.
- [ ] **Step 2: `worker-role-guard.test.ts`** — extend the existing worker test: a non-CUSTOMER session → 403 on agent paths.
- [ ] **Step 3: `memory-in-memory.test.ts`** — upsert + retrieve over the in-memory adapter; assert `topK` ordering, `minScore` filtering, per-`agentInstanceId` isolation.
- [ ] **Step 4: `correspondent-memory.test.ts`** — extend the existing DO test: after two turns, the third turn's `streamText` input contains both recent-turns and a retrieved-fact context block.
- [ ] **Step 5: `skills.test.ts`** — `rememberFact` writes a `memory_fact` row + a memory record; `recallMemory` returns it.
- [ ] **Step 6: All pass**

`pnpm --filter=qolmeia-agents test` exits 0. Commit: `test(agents): P2 integration tests`.

---

## Task 11: Wrap-up

- [ ] **Step 1: Full-repo gates**

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check` — same status as P1's wrap-up. `apps/api`, `apps/backoffice` untouched.

- [ ] **Step 2: Open the PR**

Push `feat/p2-schema-auth-memory`. Title: `P2 — Schema, Auth, Memory`. Body links the spec §11 P2 row and lists acceptance below.

- [ ] **Step 3: Acceptance**

- [ ] A logged-in CUSTOMER chats the Correspondent; the DO is keyed by the real auth org id (visible in wrangler log + D1 `conversation.company_id`).
- [ ] A logged-in STAFF/OWNER user receives 403 from agent paths.
- [ ] Across two turns, the agent demonstrably references the prior turn (recent-turns buffer working).
- [ ] After a "lembre que X" / "qual é X" round-trip, the recalled fact is correct (skills + memory adapter working end-to-end).
- [ ] D1 `memory_fact` table has the persisted fact; in-memory adapter holds it for the agent during the session.
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm test` all green.

- [ ] **Step 4: Cloudflare-account checklist for deploy** (analogous to P1's T9, not blocking the PR)

To run with the _production_ memory backend later, the operator will need to (from `apps/agents/`):

```
! wrangler vectorize create qolmeia-memory --dimensions=1024 --metric=cosine
! wrangler d1 migrations apply qolmeia-agents --remote
! wrangler d1 execute qolmeia-agents --remote --file scripts/seed-p2.sql
! wrangler deploy
```

`AI` is a built-in binding (no separate setup). The adapter selector flips to `VectorizeMemoryAdapter` automatically once the bindings exist.

---

## Risks + things to watch in P2

- **Bearer auth at `/api/v1/me`** — the route was built for cookies. If the bearer plugin doesn't cover it out of the box, T4 grows by one step (Worker forwards Bearer to a dedicated lightweight endpoint, OR `apps/api` middleware is widened to accept Bearer). Sanity-test this in T1 by curl'ing `/api/v1/me` with `Authorization: Bearer <token>`.
- **Local-dev embedding model quality** — the in-memory backend's "embedding" is intentionally crude. Recall _quality_ in dev is bad; recall _plumbing_ works. Don't read into bad dev recall — verify recall on a deploy.
- **Per-agent isolation in Vectorize** — metadata filter on `agentInstanceId`. Get the metadata schema right at upsert time; queries that forget the filter would leak across agents. T7 Step 2 must include the filter.
- **`recent-turns` table on DO SQLite vs `AIChatAgent.messages`** — both store turns. They serve different purposes: `AIChatAgent.messages` is the SDK's history for the client (reconnect, history-on-mount); our `recent_turns` is the _model-context window_. Keep them in sync but don't conflate them.
- **The seed tenancy choice locks the local D1 to the _current_ auth org** — if the local Postgres is wiped and reseeded with a new org id, the local D1 needs the same reseed. P5 makes both dynamic; until then this is a manual co-dependency worth flagging in `LOCAL_DEV.md`.
- **Vectorize index dimensions** — `bge-m3` is 1024-dim. The `vectorize create` command in the deploy checklist hard-codes that; if the embedding model changes later, the index has to be recreated.
