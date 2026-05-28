# Customer Team Sidebar + Company Page — Design

**Date:** 2026-05-27
**Surfaces:** `apps/client` (CUSTOMER), `apps/backoffice` (OWNER/STAFF), `apps/agents` (Worker)
**Status:** Approved for implementation planning

## Goal

Give the customer an ambient, always-visible view of which of their agents is doing what, and a dedicated page to manage the full roster — including hiring more agents and personalising each agent's prompt. Operators get the same prompt-editing surface from the backoffice.

## Non-goals

- External agent marketplace beyond the existing `template` table
- Per-agent billing, settings, or preferences page
- Per-agent historical timeline (the existing `/activity` page covers this)
- Avatar uploads — initials + deterministic colour suffice
- Versioning / A/B testing of prompts (single current override; audit lives in `activity_log`)
- Realtime status for operators in the backoffice — they have approvals and tickets pages already

## Two surfaces, one source of truth

### 1. Chat right-rail sidebar

Lives on the existing chat page (`apps/client/src/app/(client)/page.tsx`). Always rendered on `lg` screens and up as a right column next to the chat; collapses into a drawer triggered by a top-bar button on smaller screens.

Per team member, a compact card shows:

- Avatar — initials from `display_name`, background colour deterministically derived from `agent_instance.id`
- `display_name`
- Role label — `Correspondente`, `Designer`, `Estrategista de Marketing`, etc. (derived from `template.display_name` for workers, fixed string for `correspondent`/`planner`)
- Status pill (see "Status taxonomy" below)
- When status is `working` or `awaiting_approval`: a one-line summary `→ <ticket.summary>` truncated to a single line
- Small pencil indicator when `prompt_override IS NOT NULL`

Footer: `Ver minha empresa →` linking to `/company`.

Sidebar order: `correspondent` first, then workers ordered by most-recently-active (any open ticket → top), then alphabetical.

### 2. Company page

New route `apps/client/src/app/(client)/company/page.tsx`, new nav entry beside Chat / Assets / Activity in `apps/client/src/components/nav.tsx`.

Two sections:

**Meu time** — detailed agent cards (same data as the sidebar, expanded):

- Header: avatar, `display_name`, role, status pill
- `Capacidades` — `template.description` (read-only)
- `Trabalho atual` — list of open `ticket`s (status + summary)
- `Tickets concluídos: N` — lifetime count from `ticket` where `status = 'done'`
- ••• menu: `Renomear`, `Pausar` / `Retomar`
- `Comportamento` section (collapsible):
  - `Padrão do template` — read-only pane showing `template.system_prompt`
  - `Sua personalização` — autosize monospace textarea bound to `prompt_override`
  - Buttons: `Salvar`, `Restaurar padrão`
  - Hint: `Você modificou este prompt em <date>` when overridden (sourced from the latest `MEMBER_PROMPT_EDITED` activity_log row for this instance)

**Contratar mais agentes** — grid of templates that can be hired:

- Card per template: `template.display_name`, `template.description`, `worker_kind` badge, `Você já tem N` if `hiredCount > 0`, `Contratar` button
- Clicking `Contratar` opens a small dialog that lets the customer set a custom `display_name` (default `template.display_name` or `template.display_name #2` if a duplicate exists) and confirm
- Confirm → `POST /api/me/team/hire` → roster refreshes → toast `<name> contratado(a)`

## Status taxonomy

Single shared helper `resolveAgentStatus(instance, openTickets)`, used by both the API formatter and the UI:

| Display status         | Rule                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `paused`               | `agent_instance.status === 'paused'`                                                      |
| `working`              | `agent_instance.status === 'active'` AND any open ticket has `status === 'in_progress'`   |
| `awaiting_approval`    | `agent_instance.status === 'active'` AND any open ticket has `status === 'awaiting_approval'` AND none `in_progress` |
| `available`            | otherwise                                                                                 |

Display label mapping (pt-BR): `paused → Pausado`, `working → Trabalhando`, `awaiting_approval → Aguardando aprovação`, `available → Disponível`.

The helper lives in `apps/agents/src/team/status.ts` and is invoked by the API formatter when assembling `TeamMemberView`. The server returns the derived `status` string — clients never re-derive. The client owns only the pt-BR display map (`available → Disponível`, etc.) in `apps/client/src/lib/team.ts`. No cross-app code import.

## Schema change

One additive migration:

```sql
-- apps/agents/migrations/0006_agent_instance_prompt_override.sql
ALTER TABLE agent_instance ADD COLUMN prompt_override TEXT;
```

Nullable. `NULL` means "use the template's `system_prompt`". Mirrors the existing `model_override` column pattern. No backfill needed.

## Runtime change

A single resolver helper centralises prompt lookup:

```ts
// apps/agents/src/team/resolve-system-prompt.ts
export function resolveSystemPrompt(
  instance: Pick<AgentInstance, 'promptOverride'>,
  template: Pick<Template, 'systemPrompt'>,
): string {
  return instance.promptOverride ?? template.systemPrompt;
}
```

Every site that currently reads `template.systemPrompt` to build a system message — `CorrespondentAgent`, `WorkerAgent`, `WorkerJobWorkflow` — switches to this helper. Audited via grep against the codebase during implementation; no callers left bypassing it.

When a customer or operator edits `prompt_override`, the change takes effect on the next agent invocation. In-flight workflows are not rewound — the prompt is read once per agent instantiation. This is documented in the editor UI: `Mudanças passam a valer na próxima interação`.

## Backend — new and changed routes

All under `apps/agents/src/routes/me.ts` (customer) and `apps/agents/src/routes/backoffice.ts` (operator). Both routers share Zod schemas + handlers in `apps/agents/src/team/` so logic isn't duplicated.

### Customer routes (CUSTOMER role)

| Method | Path                                            | Body                                                  | Returns                                                                 |
| ------ | ----------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| GET    | `/api/me/team`                                  | —                                                     | `{ members: TeamMemberView[] }`                                         |
| GET    | `/api/me/catalogue`                             | —                                                     | `{ templates: HireableTemplate[] }`                                     |
| POST   | `/api/me/team/hire`                             | `{ templateId: string; displayName?: string }`        | `{ member: TeamMemberView }`                                            |
| PATCH  | `/api/me/team/members/:id`                      | `{ displayName?: string; promptOverride?: string \| null }` | `{ member: TeamMemberView }`                                            |
| POST   | `/api/me/team/members/:id/pause`                | —                                                     | `{ member: TeamMemberView }`                                            |
| POST   | `/api/me/team/members/:id/resume`               | —                                                     | `{ member: TeamMemberView }`                                            |

### Backoffice routes (OWNER/STAFF role)

| Method | Path                                                                  | Body                                                  | Returns                                |
| ------ | --------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------- |
| GET    | `/api/backoffice/teams/:companyId/members`                            | —                                                     | `{ members: TeamMemberView[] }`        |
| GET    | `/api/backoffice/teams/:companyId/members/:id`                        | —                                                     | `{ member: TeamMemberDetailView }`     |
| PATCH  | `/api/backoffice/teams/:companyId/members/:id`                        | `{ displayName?: string; promptOverride?: string \| null }` | `{ member: TeamMemberDetailView }`     |

`TeamMemberView` shape (canonical, lives in `apps/agents/src/team/types.ts`):

```ts
type TeamMemberView = {
  id: string;                    // agent_instance.id
  role: 'correspondent' | 'planner' | 'worker';
  templateId: string | null;
  workerKind: string | null;     // template.worker_kind for workers, null otherwise
  displayName: string;
  status: 'available' | 'working' | 'awaiting_approval' | 'paused';
  hasPromptOverride: boolean;
  currentWork: Array<{
    ticketId: string;
    summary: string;
    status: 'in_progress' | 'awaiting_approval';
  }>;
  lifetimeDone: number;
};

type TeamMemberDetailView = TeamMemberView & {
  templateSystemPrompt: string;
  promptOverride: string | null;
  promptOverrideUpdatedAt: number | null; // unix ms from latest MEMBER_PROMPT_EDITED activity_log row
  capabilities: string;                   // template.description
};
```

`HireableTemplate`:

```ts
type HireableTemplate = {
  id: string;
  displayName: string;
  description: string;
  workerKind: string;
  hiredCount: number;
};
```

The list comes from `listActiveTemplates(db)` filtered to `kind = 'worker'` (planners and correspondents are not user-hireable — exactly one of each is materialised at team confirmation time).

### Multi-hire rules

- `POST /api/me/team/hire` always creates a new `agent_instance` + `team_member` row, even if the same `template_id` is already on the team. The DB enforces no uniqueness on `(team_id, template_id)`.
- Default `display_name` when the customer doesn't provide one: `template.display_name` if no duplicate exists, otherwise `template.display_name #N` where N is the next available integer (`#2`, `#3`, …).
- The Correspondent's `delegateToWorker` skill needs to handle multiple workers of the same `worker_kind`. Today it likely picks the first match; with multi-hire it should: prefer `status='available'`, fall back to round-robin among `active` instances of the requested kind. This widens the design beyond a pure UI feature and is called out in the implementation plan.

### Pause semantics

- `agent_instance.status = 'paused'` means: the Correspondent will refuse to `delegateToWorker` to that instance and surface a chat message explaining it's paused. In-flight workflows on a paused agent continue to completion (we don't interrupt mid-job).
- `correspondent` and `planner` cannot be paused — the API rejects with 400.

## Liveness — no polling-only workarounds

The Correspondent DO already maintains a WebSocket to the customer for chat. We piggyback a side channel for team status.

### Event shape (server → client)

```ts
type TeamEvent =
  | { type: 'team:status'; reason: 'ticket_changed' | 'instance_changed'; companyId: string }
  | { type: 'team:roster'; reason: 'hired' | 'paused' | 'resumed' | 'renamed' | 'prompt_changed'; companyId: string };
```

The frames carry no row data — they are pure "invalidate your cache" pings. The client refetches `/api/me/team` on receipt. This keeps the WS payload tiny and avoids two paths to truth.

### Emission points

- `setTicketStatus(db, ticketId, …)` (in `apps/agents/src/db/tickets.ts` or wherever it lives today) — emit `team:status` on transitions touching `in_progress`, `awaiting_approval`, `done`, `failed`
- Team mutations (hire, pause, resume, rename, prompt edit) — emit `team:roster` after the DB write
- `materializeTeam` (initial team confirm) — emit `team:roster` once at the end

Emission is via a thin helper `emitTeamEvent(env, companyId, event)` that gets a stub to the company's `CorrespondentAgent` DO and calls a new RPC method `broadcastTeamEvent(event)`. The DO writes the frame to all connected WebSocket peers for that company. Failures are logged-and-swallowed — the DB is source of truth, the event is a cache hint.

### Client subscription

- The chat page already opens a socket via `useAgent`. A new hook `useTeamRoster()` plugs into the same socket via a `useAgentChat`-adjacent listener and invalidates the React Query / SWR cache for `['team', companyId]` on `team:*` frames.
- The Company page mounts its own socket purely for the team channel via `useAgent` against the same DO. This means the customer's tab on `/company` and a peer's tab on `/` both stay live — even cross-tab.
- Fallbacks (belt-and-suspenders): `document.visibilityState` flipping to `visible` triggers a single refetch; when the WebSocket is in a closed/reconnecting state, a 30s background poll runs until the socket re-opens. While the socket is open we rely on its `team:*` frames exclusively.

## Client (`apps/client`)

### Files added

| Path                                                    | Purpose                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| `src/app/(client)/company/page.tsx`                     | Company page route                                             |
| `src/components/team-sidebar.tsx`                       | Chat-page right rail (compact cards)                           |
| `src/components/agent-card.tsx`                         | Shared card: `compact` and `detailed` variants                 |
| `src/components/hire-dialog.tsx`                        | Modal triggered from Company page Contratar buttons            |
| `src/components/prompt-editor.tsx`                      | Textarea + Salvar / Restaurar default. Intentionally duplicated in the backoffice (see `apps/backoffice/src/components/prompt-editor.tsx`) — the two apps have different auth wrappers, fetchers, and toast systems, so a shared package would carry more weight than the duplication saves. Revisit if it ever grows beyond ~150 lines. |
| `src/lib/team.ts`                                       | Fetcher types + the `useTeamRoster` hook + status display map |

### Files changed

| Path                                  | Change                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/app/(client)/page.tsx`           | Wrap chat in a 2-column grid on `lg+`; mount `<TeamSidebar />` in the right column                       |
| `src/components/nav.tsx`              | Add `Empresa` entry between `Chat` and `Assets`                                                          |
| `src/app/(client)/layout.tsx`         | No change — column layout lives at the page level so `/company`, `/assets`, `/activity` stay full-width  |

## Backoffice (`apps/backoffice`)

### Files added

| Path                                                                | Purpose                                                                                  |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/app/(dashboard)/teams/page.tsx`                                | List of companies with team summary (count of members, count of paused, count overridden) |
| `src/app/(dashboard)/teams/[companyId]/page.tsx`                    | Per-company team roster — table of members with `Editar prompt` action                    |
| `src/app/(dashboard)/teams/[companyId]/members/[memberId]/page.tsx` | Edit page: prompt editor, rename, view current work + lifetime stats                      |
| `src/components/prompt-editor.tsx`                                  | Same shape as the customer's editor; standalone copy to avoid cross-app component sharing |

### Files changed

| Path                                                | Change                                            |
| --------------------------------------------------- | ------------------------------------------------- |
| `src/app/(dashboard)/layout.tsx` (or nav component) | Add `Times` nav entry                              |

The backoffice does not subscribe to the team WS channel — operators load the page on demand, and approvals/tickets pages already give them the timely view of what's happening.

## `@repo/ui` additions

- `Avatar` — initials + deterministic colour from a string seed; image fallback for future use but no upload UI now
- `Badge` — used for status pills + small inline markers (workerKind, hiredCount, override indicator)
- `Dialog` — shadcn-style modal for hire and rename flows (used by both client and backoffice)

No `Sidebar` primitive — a plain `<aside>` with Tailwind utilities is enough; promoting it later is cheap.

## Activity log

New stable `type` strings (all `MEMBER_*` so the existing backoffice categoriser picks them up unchanged):

- `MEMBER_HIRED` — payload `{ templateId, displayName }`
- `MEMBER_RENAMED` — payload `{ oldName, newName }`
- `MEMBER_PAUSED`, `MEMBER_RESUMED` — payload `{}`
- `MEMBER_PROMPT_EDITED` — payload `{ length, editedBy: 'customer' | 'operator', operatorId?: string }` (no full diff stored — keep the table small)
- `MEMBER_PROMPT_RESET` — same payload sans `length`

`refType = 'agent_instance'`, `refId = agent_instance.id`.

## Testing

### Unit (Vitest)

- `resolveAgentStatus` — covers paused, working, awaiting_approval, mixed (a worker with one in_progress + one awaiting_approval is `working`), no tickets
- `resolveSystemPrompt` — override beats template, null falls back, empty string is treated as override (`'' !== null`) — explicit assertion so we don't accidentally drop the user's intent
- `nextDisplayName` — duplicate-naming helper (returns `Designer`, `Designer #2`, `Designer #3` correctly even when names were renamed manually)

### Workers Pool (Miniflare)

- `GET /api/me/team` — returns roster with derived status; auth gate works
- `POST /api/me/team/hire` — creates instance, creates team_member, allows multi-hire, default-name logic, activity row written
- `PATCH /api/me/team/members/:id` — promptOverride update reflected, `null` clears it, empty string is preserved, rename works, both fields in one request work
- `POST .../pause` — rejected for correspondent/planner, accepted for worker; idempotent
- `POST .../resume` — same shape
- Backoffice equivalents — same body assertions + role gate (CUSTOMER gets 403)
- `delegateToWorker` selects an `available` worker over a `working` one when two of the same kind exist; falls back to round-robin among `active`
- `team:status` event fires when a ticket goes `pending → in_progress`; client invalidation hook receives it (assert at the hook level if practical, otherwise at the DO RPC level)

### E2E smoke (manual, documented in the implementation plan)

Trigger a Designer worker job from chat; assert in the sidebar:

1. Card flips Disponível → Trabalhando the moment the operator-facing action is created
2. Flips → Aguardando aprovação when the action lands in the approvals queue
3. Operator approves in backoffice → flips → Trabalhando → Disponível after execution
4. No manual refresh anywhere

Plus: edit the Designer's prompt to a custom one ("Você é minimalista, monocromático."), trigger another image — the resulting brief reflects the personalisation.

## Open questions resolved during design

- **Avatars** — derived (initials + colour), no schema column, no upload UI
- **Versioning of prompts** — none; `activity_log` is the audit trail
- **Multi-hire of correspondent/planner** — disallowed at the API level (only one of each per company); enforced in the hire handler
- **In-flight prompt changes** — take effect on the next agent invocation; documented in the editor
- **Cross-app shared editor component** — duplicated (small file, different surfaces), no new shared package
- **Backoffice realtime team status** — out of scope; approvals/tickets pages cover the operator's needs

## Implementation order (informs the plan)

1. Migration `0006_agent_instance_prompt_override.sql` + types
2. `resolveSystemPrompt` helper + audit all callsites (no behaviour change yet — verify the runtime is identical)
3. `resolveAgentStatus` helper + `TeamMemberView` shape
4. Customer GET endpoints (`/api/me/team`, `/api/me/catalogue`)
5. Customer mutations (hire, pause, resume, PATCH) + activity logging
6. `delegateToWorker` multi-instance dispatch + tests
7. WebSocket fan-out (`broadcastTeamEvent` RPC + emit sites)
8. `@repo/ui` primitives (Avatar, Badge, Dialog) — small, additive
9. `apps/client` Team Sidebar + Company page + hire dialog + prompt editor
10. Backoffice routes + UI
11. E2E smoke run from the seeded local environment
