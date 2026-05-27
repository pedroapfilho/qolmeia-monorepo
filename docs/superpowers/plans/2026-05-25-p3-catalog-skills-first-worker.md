# P3 — Catalog, Skills, First Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the **data-driven Worker catalog** (D1 `template` rows + `skill` overlay) and a **parameterized `WorkerAgent` DO class**. Wire the **Correspondent → Worker delegation** path (DO-to-DO RPC + acyclic graph check). Ship the first real specialist — a **Designer** — that generates brand images via OpenRouter (Nano Banana Pro) and stores them in R2. The agency has its first employee.

**Architecture:** A `template` row is a Worker kind (system prompt, default model, allowed skill ids, default policies). A `skill` row is the **operator-tunable overlay** over the P2 code registry — `execute()` and the zod schema stay code; description, `defaultConfig`, `enabled` move to D1 (spec decision 10). One `WorkerAgent extends Agent` class handles every kind; behavior comes from the row. The Correspondent gets a `delegateToWorker` tool that RPCs the right `worker:{companyId}:{workerId}` DO. `team_member.can_delegate_to` is the acyclic delegation graph — checked before every RPC. R2 holds generated assets; the `asset` D1 row is the system-of-record metadata.

**Tech stack:** `agents` SDK (`Agent` for the Worker), AI SDK with the OpenRouter image route (`google/gemini-3-pro-image-preview` — Nano Banana Pro), Cloudflare R2 binding, `@cloudflare/vitest-pool-workers`.

**Builds on:** `main` after P2 merged.

**Architectural calls baked in** (T1.4 is the override point):

1. **One parameterized `WorkerAgent` class, not one per kind.** Marketing/Designer/Sales differ by their `template` row — system prompt, model, skill set, policy defaults. Adding a kind = one D1 row, not a deploy + DO migration. Matches §4.1 of the spec.
2. **Image bytes flow R2 → URL → message part.** The Correspondent's chat response includes a `file` UIMessage part pointing at a Worker-served R2 URL with a short-lived signed token. Asset metadata in D1 carries `r2_key + sha256` for dedup; the Worker streams bytes back on `/assets/:id`.

---

## File map

| File                                                     | Tasks | Responsibility                                                                              |
| -------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------- |
| `apps/agents/migrations/0003_p3_seed_designer.sql` (new) | 3     | Seed Designer template + skill overlay rows                                                 |
| `apps/agents/src/db/template.ts` (new)                   | 3     | Typed shapes for `template`, `skill`; helpers `getTemplate`, `listSkillsForTemplate`        |
| `apps/agents/src/db/team.ts` (new)                       | 6     | `agent_instance`, `team`, `team_member` helpers + acyclic graph check                       |
| `apps/agents/src/db/asset.ts` (new)                      | 8     | `asset` row helpers + `(company_id, sha256)` dedup                                          |
| `apps/agents/src/skills/registry.ts` (extend)            | 4     | Join `execute` (code) + D1 overlay (description/config/enabled) at agent boot; per-DO cache |
| `apps/agents/src/skills/generate-brand-image.ts` (new)   | 8     | OpenRouter image call → R2 upload → asset row                                               |
| `apps/agents/src/skills/delegate-to-worker.ts` (new)     | 7     | Graph check → resolve worker DO → RPC `handleTicket`                                        |
| `apps/agents/src/agents/worker.ts` (new)                 | 5     | `WorkerAgent extends Agent` — parameterized by template                                     |
| `apps/agents/src/agents/correspondent.ts` (extend)       | 9     | Add `delegateToWorker` to the tool set                                                      |
| `apps/agents/src/lib/r2.ts` (new)                        | 2     | R2 upload / signed-URL helpers                                                              |
| `apps/agents/src/routes/assets.ts` (new)                 | 8     | `/assets/:id` serves R2 bytes (auth-gated)                                                  |
| `apps/agents/wrangler.jsonc`                             | 2, 5  | R2 binding · `WorkerAgent` DO binding + migration tag                                       |
| `apps/agents/src/__tests__/*.test.ts` (new)              | 10    | Template overlay · delegation graph · R2 upload · image-gen skill (mocked)                  |

---

## Tasks

### T1: Setup

- [ ] Branch from `main` → `feat/p3-catalog-skills-worker`. Baseline gates green.
- [ ] Confirm the two baked-in calls (one parameterized DO class · R2-served image URLs).

### T2: R2 binding + asset module

- [ ] Add `r2_buckets` to `wrangler.jsonc`: `[{ binding: "ASSETS", bucket_name: "qolmeia-assets" }]` (placeholder bucket id; created at deploy).
- [ ] `src/lib/r2.ts` — `uploadAsset(env, { key, bytes, mime })`; `signedUrl(env, key, ttl)` (HMAC-signed token verified on read). No external R2 lib — `env.ASSETS.put` / `.get`.
- [ ] Local dev: Miniflare provides local R2. No Cloudflare account needed.

### T3: Template + skill D1 schema + Designer seed

- [ ] The P2 migration already created `template` + `skill` tables (forward-compat). Add `migrations/0003_p3_seed_designer.sql` that inserts one Designer template + `skill` overlay rows for `generateBrandImage`, `delegateToWorker`, `rememberFact`, `recallMemory`.
- [ ] Designer template: `worker_kind='designer'`, `system_prompt` (pt-BR designer persona), `model='google/gemini-3-pro-image-preview'`, `skill_ids=['generateBrandImage','recallMemory','rememberFact']`, `default_policies={'publish_asset':'require-approval'}`.
- [ ] `src/db/template.ts` — typed shapes + `getTemplate(db, id)`, `listSkillsForTemplate(db, templateId)` (joins `skill` overlay).

### T4: Skill registry — D1 overlay join

- [ ] Extend `src/skills/registry.ts` from P2: each agent boot reads `template.skill_ids` → joins with `skill` overlay rows in D1 → builds the AI-SDK `tool()` set. The `description` and `defaultConfig` come from D1; `execute` and `inputSchema` from code.
- [ ] Cache the resolved set in the DO's own SQLite, keyed by `template.version`. Cold-start does one D1 read; hot path is local.

### T5: `WorkerAgent` DO class

- [ ] `src/agents/worker.ts` — `WorkerAgent extends Agent<Env>`. Public RPC method `handleTicket(ticketId: string)`: loads the ticket from D1, runs `streamText` (no chat — task generation) with the template's prompt + the resolved tools, persists result via `db/schema.ts`.
- [ ] Add to `wrangler.jsonc` `durable_objects.bindings` + a new `migrations` tag (`v2`, `new_sqlite_classes: ["WorkerAgent"]`).
- [ ] `resolveModel()` seam mirrors the Correspondent (testable).

### T6: Team materialization

- [ ] `src/db/team.ts` — `materializeTeam(db, { companyId, templateIds })`: in a single D1 `batch()`, insert `team`, `agent_instance` (Correspondent + one Worker per template), `team_member` rows with `can_delegate_to = [Designer]` for the Correspondent. Acyclic graph check (DFS).
- [ ] Extend `scripts/seed-p2.sql` (or add `seed-p3.sql`) to materialize the demo team for the existing seeded company.

### T7: `delegateToWorker` skill

- [ ] `src/skills/delegate-to-worker.ts` — input `{ workerKind: string; brief: string }`. Resolves the Worker `agent_instance.id` for this company + kind, checks the calling agent can delegate to it (`team_member.can_delegate_to` includes the target), inserts a `ticket` row, RPCs `env.WORKER_AGENT.get(idFromName(workerId)).handleTicket(ticketId)`. Returns `{ ticketId, status: "queued" }` (synchronous wait for the Worker's response is P4's Workflow concern).
- [ ] In P3 (no Workflows yet), the Worker DO runs `streamText` inline and writes the result; the skill returns when the Worker finishes. P4 makes this async via Workflows.

### T8: `generateBrandImage` skill + asset serving

- [ ] `src/skills/generate-brand-image.ts` — input `{ prompt: string; size?: string }`. Calls the OpenRouter image route via the AI SDK (or direct `fetch` since image is HTTP, not streamText). Bytes → `uploadAsset(env, { key: "org_<id>/<sha256>.png", bytes, mime: "image/png" })` → `asset` row with metadata.
- [ ] Returns `{ assetId, url }` where `url` = a signed URL through the Worker's `/assets/:id` endpoint.
- [ ] `src/routes/assets.ts` — Hono route `/assets/:id` validates the signed token, fetches from R2, streams bytes. Mounted on the Hono app for non-agent traffic.

### T9: Correspondent wires `delegateToWorker`

- [ ] In `correspondent.ts`, extend the resolved tool set to include `delegateToWorker`. Update the system prompt: "Quando o pedido envolver design, delegue ao Designer com `delegateToWorker`."
- [ ] `stopWhen: stepCountIs(5)` (lets the model: receive request → delegate → present result).

### T10: Tests

- [ ] `template-overlay.test.ts` — D1 overlay joins; an unknown `skill_ids` entry surfaces clearly at boot.
- [ ] `team-graph.test.ts` — `materializeTeam` is acyclic; cycles raise; `delegateToWorker` rejects ungranted edges.
- [ ] `r2-asset.test.ts` — upload + signed-URL round-trip on local R2.
- [ ] `generate-brand-image.test.ts` — mock OpenRouter image fetch with canned bytes; assert R2 + `asset` row + return shape.
- [ ] `worker-handle-ticket.test.ts` — `runInDurableObject` the Worker with a scripted model; assert ticket result persisted.
- [ ] All exit 0.

### T11: Wrap

- [ ] Gates, PR `feat/p3-catalog-skills-worker → main`, acceptance:
  - [ ] Customer asks for an image; Correspondent delegates to Designer; image lands in R2; asset URL streams in the chat as a file part.
  - [ ] An unknown `worker_kind` request returns a graceful "não tenho esse especialista ainda" reply.
  - [ ] Backoffice tweaks the Designer's D1 `system_prompt` (no deploy) → next agent boot picks it up.

---

## Risks

- **Image-generation provider quotas/cost.** Each `generateBrandImage` call hits Nano Banana Pro through OpenRouter — measured per image. Add a per-Worker daily budget hint to the template `defaultConfig` (`maxImagesPerDay`); enforcement is P4's policy concern.
- **R2 signed URLs.** Using HMAC with a Worker secret is simplest; rotation is manual. Alternative: short-lived R2 presigned URLs. Either works for P3 — flag the rotation story.
- **Skill registry D1 cache invalidation.** Per-DO cache keyed by `template.version` — operators must bump the version on edit. Backoffice editor (P5) makes that automatic; until then, operators have to know.
- **The "synchronous delegation" of T7** is a P3 simplification — the Correspondent blocks waiting for the Worker. Acceptable for one Worker doing one short job; falls over with long image generation. P4 fixes this via Workflows.
