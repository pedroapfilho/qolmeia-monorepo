# P4 — Workflows + Approval Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn every Worker job into a **Cloudflare Workflow** (checkpointed, retried, durable) and wire the **policy-per-action-type approval loop** with `waitForEvent` — the approval/reject/request-changes round-trip the spec's agency model rests on. The Correspondent becomes a true relay: it presents proposed Actions, interprets user replies, and resumes paused Workflows. Adds operator override + a stale-backlog view in the backoffice.

**Architecture:** P3's synchronous delegation is replaced by **Workflow instances**. When the Correspondent delegates, the Worker DO **creates a Workflow** (`env.WORKER_JOB.create({ id, params })`), stores `workflow_id` on the `ticket`, and returns immediately. The Workflow runs checkpointed steps; gated steps file an `action` row and **pause at `step.waitForEvent("decision")`**. The Correspondent presents the proposal to the User; the User's reply ("aprovado", "muda a cor", "não") is interpreted by the Correspondent's model into a decision; the Correspondent calls `instance.sendEvent("decision", { ... })` and the Workflow resumes from the same checkpoint. `request-changes` resumes with feedback appended; `reject` resumes to discard; `approve` resumes to execute. **No timeout** — the half-finished job sleeps in the checkpoint at zero cost. A backoffice view ranks pending Actions by age so the human sees backlog.

**Tech stack:** Cloudflare Workflows binding, the `agents` SDK (Workflow instances are RPC'd back to the DO on completion), AI SDK for the Correspondent's decision-interpretation step, `@cloudflare/vitest-pool-workers` (Miniflare emulates Workflows).

**Builds on:** `main` after P3 merged.

**Architectural calls baked in** (T1.4 override):
1. **One generic `WorkerJob` Workflow class, dispatched by ticket payload.** Not one Workflow per skill. The Workflow's steps come from `template.workflow_definition` (a JSON spec of step ids) so a new Worker kind doesn't need a new Workflow class.
2. **Decision interpretation by the Correspondent's model.** A dedicated tool `decideAction` is exposed to the model — it takes the User's reply text + the open Action and emits `{ decision: 'approve'|'reject'|'changes'; feedback?: string }`. Keeps natural-language flexibility ("manda ver", "publica aí") without parsing brittle keywords.
3. **`waitForEvent` event names are namespaced by ticket id.** `decision:{ticketId}` so a single Worker DO can have many in-flight Workflows without collision.

---

## File map

| File | Tasks | Responsibility |
|---|---|---|
| `apps/agents/migrations/0004_p4_policy_columns.sql` (new) | 3 | `action.action_type` index; `ticket.workflow_id` already exists |
| `apps/agents/src/workflows/worker-job.ts` (new) | 4 | `WorkerJobWorkflow extends WorkflowEntrypoint` — the one generic class |
| `apps/agents/src/workflows/steps/index.ts` (new) | 4 | Step registry — id → handler (research, generate, propose, execute, …) |
| `apps/agents/src/workflows/steps/propose-action.ts` (new) | 5 | Files the action row + emits `step.waitForEvent("decision:<ticketId>")` |
| `apps/agents/src/db/policy.ts` (new) | 3 | `resolvePolicy(actionType, template, company)` — `require-approval` / `auto-execute` / `notify-only` |
| `apps/agents/src/db/action.ts` (new) | 3 | `action` row helpers — status transitions, decided-by stamping |
| `apps/agents/src/agents/worker.ts` (extend) | 4 | `handleTicket` no longer runs streamText inline — it creates a Workflow |
| `apps/agents/src/agents/correspondent.ts` (extend) | 6 | New `decideAction` tool · presents pending action · sends decision event back |
| `apps/agents/src/routes/backoffice.ts` (new) | 7, 8 | `/api/tickets` · `/api/actions` · `/api/activity` · operator override · stale backlog |
| `apps/agents/src/activity/log.ts` (new) | 5 | `activity_log` writer — best-effort, never fails the request |
| `apps/agents/wrangler.jsonc` | 4 | `workflows: [{ binding: "WORKER_JOB", class_name: "WorkerJobWorkflow", name: "qolmeia-worker-job" }]` |
| `apps/agents/src/__tests__/*.test.ts` (new) | 9 | Workflow checkpoint resume · approval round-trip · request-changes loop · policy resolution · operator override |
| `apps/backoffice/src/...` | 8 | Pending-actions view + decision controls (added later if the backoffice surface migrates here in P7) |

---

## Tasks

### T1: Setup

- [ ] Branch from `main` → `feat/p4-workflows-approvals`. Baseline gates green.
- [ ] Confirm the three baked-in calls (one Workflow class, model-interpreted decisions, namespaced event names).
- [ ] Verify Miniflare-local Workflows emulation works: a hello-world Workflow with one step + `waitForEvent` resumes on event. If not (some `vitest-pool-workers` versions have gaps), the plan adds a thin adapter and falls back to a Queue-based simulation for tests.

### T2: Workflows binding

- [ ] `wrangler.jsonc` — `workflows` block per file-map. Re-run `cf-typegen`; `env.WORKER_JOB` should appear typed.

### T3: Action table polish + policy resolution

- [ ] Migration `0004` adds index `action(company_id, status, created_at)` (the backoffice stale-backlog view). `action` table itself is from P2's full schema.
- [ ] `src/db/policy.ts` — `resolvePolicy(actionType: string, template: Template, company: Company)` returns `require-approval | auto-execute | notify-only`. Reads `template.default_policies` JSON, falls back to `require-approval` for any unknown action type.
- [ ] `src/db/action.ts` — `proposeAction`, `decideAction(actionId, decision, feedback?, decidedBy)`.

### T4: `WorkerJobWorkflow` + Worker handoff

- [ ] `src/workflows/worker-job.ts` — `class WorkerJobWorkflow extends WorkflowEntrypoint<Env, WorkerJobParams>` with `async run(event, step)` that reads the ticket, iterates the step list from `template.workflow_definition`, executes each step via the step registry, persists checkpoints between.
- [ ] `src/agents/worker.ts` — `handleTicket(ticketId)` now does `await env.WORKER_JOB.create({ id: ticketId, params: {...} })`, writes `ticket.workflow_id`, returns `{ ok: true, workflowId }`. No more inline `streamText`.
- [ ] Each step handler accepts `{ ticket, state, step, env }` and returns `{ outputs }` saved to `ticket.result` JSON.

### T5: `proposeAction` step + activity log

- [ ] `src/workflows/steps/propose-action.ts` — given `{ actionType, proposed }`, resolves the policy. `auto-execute` → calls the executor directly; `notify-only` → writes activity_log + returns; `require-approval` → inserts `action(status='pending')`, RPCs the Correspondent (`env.CORRESPONDENT.get(...).presentAction(actionId)`), then `await step.waitForEvent("decision:" + ticketId, { timeout: "60 days" })`. On resume: `approve` → executor + log; `reject` → log + close ticket; `changes` → re-queue (jump back to a prior step with feedback context). Spec calls "no timeout"; we set a generous fallback (60 days) for safety but the backoffice surfaces stale items long before.
- [ ] `src/activity/log.ts` — single writer, swallows errors with a single warning log (no silent silence — visibility). Every Workflow transition writes.

### T6: Correspondent decision flow

- [ ] New public RPC `presentAction(actionId)` on the Correspondent — pulls the action, formats a natural-language proposal in pt-BR, sends it as an assistant message via the AIChatAgent message API (`this.saveMessages(...)`).
- [ ] New `decideAction` tool exposed in the Correspondent's tool set — the model calls it when interpreting a User's reply to a pending action. Tool body: validates the action belongs to this company + still pending; calls `env.WORKER_JOB.get(workflowId).sendEvent("decision:" + ticketId, { decision, feedback, userId })`; updates the `action` row.
- [ ] System-prompt addition: "Quando houver uma ação pendente e o usuário responder, interprete a resposta e use `decideAction`."

### T7: Backoffice REST surface

- [ ] `src/routes/backoffice.ts` — Hono routes mounted at `/api/backoffice/*`, gated by an OWNER/STAFF role guard (the validator from P2 returns role; gate here). Endpoints: `GET /tickets` (paginated, filterable by status/company), `GET /actions?status=pending&sort=age`, `POST /actions/:id/decide { decision, feedback }` (operator override), `GET /activity?companyId=&since=`.
- [ ] All writes go through the same paths the Correspondent uses (`db/action.ts` + `sendEvent`) — no privileged shortcut.

### T8: Stale-backlog view

- [ ] `GET /actions?status=pending&sort=age` returns pending actions oldest-first with `{ ageSeconds, companyId, ticketTitle, proposedSummary }`. Backoffice UI consumes this; the *implementation* of the UI is its own slice (likely landing alongside P5's Planner UI work in the backoffice).

### T9: Tests

- [ ] `workflow-resume.test.ts` — start a Workflow, fire a decision event, assert resumes from the right checkpoint with the feedback in scope.
- [ ] `approval-round-trip.test.ts` — Correspondent + Worker + Workflow end-to-end with scripted models: user asks → Designer proposes → Correspondent surfaces → user "aprovado" → Workflow executes → assertion on `action.status='executed'`.
- [ ] `request-changes.test.ts` — same loop with "muda a cor para azul" — Workflow re-runs the generation step with `feedback` appended to the step's input.
- [ ] `policy-auto-execute.test.ts` — action type with `auto-execute` policy bypasses `waitForEvent` entirely.
- [ ] `operator-override.test.ts` — `POST /backoffice/actions/:id/decide` triggers the same `sendEvent` path.
- [ ] All exit 0.

### T10: Wrap

- [ ] Gates, PR `feat/p4-workflows-approvals → main`, acceptance:
  - [ ] Live test: customer asks for a Black-Friday post, Correspondent delegates, Designer proposes an image, Correspondent surfaces it as "aprova ou ajusta?", customer replies "ajusta a cor", Workflow resumes with feedback, Designer regenerates, customer "aprovado", Workflow executes the publish step.
  - [ ] Operator opens backoffice pending-actions list (REST) — sees the action mid-flight.

---

## Risks

- **Miniflare Workflows emulation.** Cloudflare Workflows in `vitest-pool-workers` may be partial or absent on the installed version. T1 step 3 verifies. Fallback: a queue-based stand-in for tests + real Workflows on deploy.
- **`waitForEvent` semantics.** Long-duration pauses are checkpointed but the Workflow consumes some platform allowance; verify behaviour for multi-day waits on a deploy before promising customers.
- **Decision-interpretation false positives.** The model interpreting "manda ver" as approve is fine; interpreting "talvez" as approve is dangerous. Mitigation: `decideAction` tool requires the model to also include a short justification field — surfaced in the activity log so misinterpretations are auditable.
- **Step re-entry on `request-changes`.** The Workflow design must support jumping back to a prior step with new input. If Cloudflare Workflows' API doesn't support backward step jumps, the alternative is to start a *new* Workflow instance with feedback in the params and close the old one. T4 verifies which the SDK supports.
- **`stopWhen: stepCountIs(5)` from P3** caps the model loop, but the Correspondent's new `decideAction` interaction extends the loop. Bump to `stepCountIs(8)` and document the budget.
