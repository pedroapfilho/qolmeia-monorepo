# P5 — Onboarding / Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the platform **multi-tenant for real**. Ship the **`PlannerAgent` DO** — a conversational onboarding agent that interviews a new customer in pt-BR, crystallizes a typed `CompanyBrief`, proposes a Team from the live D1 catalog, and on confirmation **materializes** the company + Correspondent + Workers in a D1 `batch()`. The customer lands in a seeded Correspondent chat with memory pre-loaded. Adds a backoffice template/skill editor so operators can tune the catalog without a deploy.

**Architecture:** A `Company` is created via REST (`POST /api/companies`) — auth service creates the org (Postgres), the agent Worker creates the matching `company` row in D1 (id shared), and seeds an `agent_instance` with `role='planner'`. The customer is routed to the Planner chat over the same `routeAgentRequest` path. The Planner's tool set has two skills: `extractBrief` (structured output, `generateObject`) and `proposeTeam` (reads live `template` catalog, returns recommended subset). On the customer's `POST /api/teams/:companyId/confirm { templateIds[] }`, the Worker runs a D1 `batch()`: insert Correspondent `agent_instance` + one Worker per template + `team_member` rows + `team.confirmed_at`, validate the delegation graph acyclic, set `company.status='active'`. The Worker then RPCs the new Correspondent's `seedMemory(brief, debriefSummary)`. Client switches the chat target to the Correspondent.

**Tech stack:** `agents` SDK (`AIChatAgent` for Planner), AI SDK `generateObject` (structured output), D1 `batch()` (atomic team materialization), `@cloudflare/vitest-pool-workers`.

**Builds on:** `main` after P4 merged.

**Architectural calls baked in** (T1.4 override):
1. **Planner is persistent (spec decision 4).** Kept dormant after team confirmation; the customer returns to re-plan (add/remove Workers) without re-debrief. The same DO instance, addressable by `planner:{companyId}`.
2. **`CompanyBrief` is a single typed artifact.** One zod schema, one D1 column (`company.brief` JSON). Versioned via `brief_schema_version` so a future schema change has a migration path.
3. **Re-planning is the same skill set as onboarding.** No separate "edit team" surface — the customer chats the Planner again, the Planner reads the existing brief + team, proposes deltas, runs the same confirm endpoint with the new template set.

---

## File map

| File | Tasks | Responsibility |
|---|---|---|
| `apps/agents/src/agents/planner.ts` (new) | 3 | `PlannerAgent extends AIChatAgent` |
| `apps/agents/src/lib/company-brief.ts` (new) | 4 | `CompanyBrief` zod schema (industry, goals, audience, channels, brand, locale) + version |
| `apps/agents/src/skills/extract-brief.ts` (new) | 4 | `extractBrief` — `generateObject` on the brief schema; writes to `company.brief` |
| `apps/agents/src/skills/propose-team.ts` (new) | 5 | Reads live `template` catalog; returns recommended template ids + rationale |
| `apps/agents/src/routes/companies.ts` (new) | 6 | `POST /api/companies` (auth-create) · `POST /api/teams/:companyId/confirm` |
| `apps/agents/src/agents/correspondent.ts` (extend) | 8 | `seedMemory({ brief, debriefSummary })` RPC method |
| `apps/agents/src/agents/team-materialize.ts` (new) | 7 | The D1 `batch()` materializer + acyclic graph check |
| `apps/agents/src/routes/backoffice-catalog.ts` (new) | 9 | CRUD for `template` + `skill` overlay (OWNER/STAFF gated); bumps `template.version` on edit |
| `apps/client/src/app/(client)/page.tsx` (extend) | 8 | Route to Planner page if `company.status='onboarding'`, Correspondent otherwise |
| `apps/client/src/app/onboarding/page.tsx` (new) | 8 | Renders `<Chat agent="planner" name={companyId}>` with a "Confirm Team" CTA driven by Planner state events |
| `apps/agents/src/__tests__/*.test.ts` (new) | 10 | extractBrief schema · proposeTeam against seeded catalog · confirm batch atomicity · acyclic check · seedMemory · re-plan flow |

---

## Tasks

### T1: Setup

- [ ] Branch from `main` → `feat/p5-onboarding-planner`. Baseline gates green.
- [ ] Confirm baked-in calls (persistent Planner, single `CompanyBrief` artifact, re-plan as same skill set).
- [ ] Sanity: `apps/api` exposes a company-creation endpoint we can call from the Worker (or the Worker creates the org directly via Better Auth's organization plugin) — pick the simpler path now (likely "Worker calls `apps/api`'s create-organization route").

### T2: PlannerAgent DO

- [ ] `wrangler.jsonc` — add `PlannerAgent` to the DO bindings + a new `migrations` tag (`v3`, `new_sqlite_classes: ["PlannerAgent"]`).
- [ ] `src/agents/planner.ts` — `PlannerAgent extends AIChatAgent<Env>` with its own system prompt (pt-BR agency intake call), `resolveModel()` seam, recent-turns buffer + memory adapter (re-uses P2 modules), tool set `[extractBrief, proposeTeam]`.

### T3: `CompanyBrief` schema

- [ ] `src/lib/company-brief.ts` — zod schema: industry, primaryGoal, audience, channels (enum array), brand (palette, voice, references), locale. `BRIEF_SCHEMA_VERSION = 1`.

### T4: `extractBrief` skill

- [ ] `src/skills/extract-brief.ts` — uses `generateObject` from `ai` against the brief schema, prompted with the Planner's current Session messages as context. Writes the result to `company.brief` JSON (versioned). Returns the parsed brief.
- [ ] The Planner periodically calls this skill as the debrief progresses — partial briefs are valid (schema fields are optional during interview, required at `proposeTeam` time).

### T5: `proposeTeam` skill

- [ ] `src/skills/propose-team.ts` — reads `template` rows where `status='active'`; given the current `CompanyBrief`, returns `{ templateIds: string[], rationale: { templateId: string, reason: string }[] }`. Pure deterministic match for common cases (e.g. "marketing" goal → Designer + MarketingStrategist) with a model call only for ambiguous cases.

### T6: Company creation REST

- [ ] `POST /api/companies { name, ownerEmail }`: calls `apps/api`'s org-creation endpoint (Better Auth organization plugin), gets back `organizationId`, inserts D1 `company(id=organizationId, status='onboarding')` + `agent_instance(role='planner')`. Returns `{ companyId, plannerChatUrl }`.
- [ ] Gated by an authenticated user; the user becomes OWNER of the new org.

### T7: Team materialization (D1 batch)

- [ ] `src/agents/team-materialize.ts` — `materializeTeam(env, { companyId, templateIds, brief })`: builds the `batch()` of (a) `team` row, (b) Correspondent `agent_instance`, (c) one `agent_instance` per template, (d) `team_member` rows with the default `can_delegate_to` graph (Correspondent → all Workers), (e) acyclic graph validation, (f) `team.confirmed_at`, (g) `company.status='active'`. Atomic. If any step fails the whole batch rolls back.
- [ ] `POST /api/teams/:companyId/confirm { templateIds }` calls it; gated to the company's OWNER.

### T8: Correspondent seeding + client routing

- [ ] `src/agents/correspondent.ts` — add `seedMemory({ brief, debriefSummary })` RPC: writes `memory_fact` rows for the brief + summary so the new Correspondent's first turn already has Company context.
- [ ] Called by `materializeTeam` immediately after the Correspondent's `agent_instance` is inserted.
- [ ] `apps/client/src/app/(client)/page.tsx` — read `company.status` from `/api/v1/me` extended response. If `onboarding`, redirect to `/onboarding`. If `active`, render Correspondent chat as today.
- [ ] `apps/client/src/app/onboarding/page.tsx` — `<Chat>` configured for `agent="planner"`. A side panel shows the live proposed Team (driven by `useAgent`'s state sync: the Planner calls `this.setState({ proposedTeam })` after `proposeTeam`); a "Confirmar Time" button calls `/api/teams/:companyId/confirm` and on success navigates to `/`.

### T9: Backoffice catalog editor

- [ ] `src/routes/backoffice-catalog.ts` — REST CRUD for `template` (system_prompt, model, skill_ids, default_policies) and `skill` overlay (description, defaultConfig, enabled). Every write bumps `template.version` so the per-DO cache (from P3) invalidates on next boot.
- [ ] OWNER/STAFF-only. Backoffice UI implementation can land alongside this slice or as a follow-up.

### T10: Tests

- [ ] `company-brief.test.ts` — schema validation + version field.
- [ ] `extract-brief.test.ts` — mocked `generateObject` returning a partial brief; assert D1 write.
- [ ] `propose-team.test.ts` — against a seeded catalog with three templates; assert deterministic-match cases + at least one model-call branch (scripted).
- [ ] `team-materialize.test.ts` — happy path + acyclic-violation path + a partial-failure path (assert nothing committed).
- [ ] `seed-memory.test.ts` — Correspondent reads its seeded brief in the first turn's retrieval.
- [ ] `replan.test.ts` — second confirm call with a *different* `templateIds` set: add a Worker, remove one, no errors; team_member graph updated correctly.
- [ ] All exit 0.

### T11: Wrap

- [ ] Gates, PR `feat/p5-onboarding-planner → main`, acceptance:
  - [ ] A brand-new email signs up → creates a Company → lands in the Planner debrief → debrief produces a CompanyBrief → confirms a Team of {Designer, MarketingStrategist} → lands in a Correspondent chat that already knows the brand from memory.
  - [ ] Operator edits the Designer template's `system_prompt` in the backoffice → existing Designer DOs pick it up on next boot.
  - [ ] Same customer returns to `/onboarding` later, removes the MarketingStrategist, adds a Sales Worker → re-confirm succeeds; old MarketingStrategist DO goes idle.

---

## Risks

- **Org creation across two stores.** The auth org id must equal the D1 company id, and *both* writes must succeed atomically across two databases. If Postgres write succeeds and D1 write fails, you have a half-onboarded company. Mitigation: D1 write first (D1 has `batch()`, idempotent on PK), then auth org. If auth fails after D1, GC the orphan `company` row from a periodic sweeper (or just let the operator see + delete).
- **`generateObject` reliability for partial briefs.** Early in the debrief, the model may emit a brief missing fields. zod's `.partial()` covers the schema; the Planner re-runs `extractBrief` as context grows. Final `proposeTeam` requires the brief to validate against the full schema.
- **Cycle-creation on re-plan.** A second confirm with different templates rewrites `team_member.can_delegate_to`. Re-validate acyclic on every confirm, not just first.
- **Per-DO catalog cache invalidation on re-plan.** When a Worker's template changes (catalog edit), the Worker DO's cache must invalidate. P3's `template.version` bump handles edits; a `force-refresh` RPC on `WorkerAgent` is a useful escape hatch for emergency operator actions.
- **The Planner's "live proposed team" state.** Using `this.setState({ proposedTeam })` ties the client's confirm UI to the agent's state sync — verify the `agents` SDK's `onStateUpdate` works smoothly when the proposed team is a structured object (not just a primitive).
