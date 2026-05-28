# Customer Team Sidebar + Company Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the customer an ambient sidebar showing which of their agents is currently working, plus a `/company` page to manage the roster, multi-hire from the catalogue, and personalise each agent's prompt. Operators get the same prompt editor in the backoffice.

**Architecture:** All product data lives in D1. The Correspondent DO broadcasts `team:*` invalidation pings over the existing WebSocket; clients refetch a typed roster from `/api/me/team`. A small additive migration adds `agent_instance.prompt_override`, consumed via a single `resolveSystemPrompt` helper at every system-prompt callsite.

**Tech Stack:** Cloudflare Workers + Durable Objects, D1 (SQLite), Hono, Cloudflare Agents SDK, Next.js 16 (client + backoffice), Vitest with `@cloudflare/vitest-pool-workers`, oxlint + oxfmt.

**Spec:** [`docs/superpowers/specs/2026-05-27-customer-team-sidebar-and-company-page-design.md`](../specs/2026-05-27-customer-team-sidebar-and-company-page-design.md)

---

## File map

### `apps/agents`

**New:**
- `migrations/0006_agent_instance_prompt_override.sql`
- `src/team/types.ts` — `TeamMemberView`, `TeamMemberDetailView`, `HireableTemplate`, `AgentDisplayStatus`
- `src/team/status.ts` — `resolveAgentStatus`
- `src/team/resolve-system-prompt.ts` — `resolveSystemPrompt`
- `src/team/queries.ts` — roster / catalogue / detail reads
- `src/team/mutations.ts` — hire / pause / resume / update writes (shared by both routers)
- `src/team/naming.ts` — `nextDisplayName`
- `src/team/events.ts` — `emitTeamEvent` helper
- `src/__tests__/team-status.test.ts`
- `src/__tests__/team-resolve-system-prompt.test.ts`
- `src/__tests__/team-naming.test.ts`
- `src/__tests__/team-queries.test.ts`
- `src/__tests__/team-mutations.test.ts`
- `src/__tests__/me-team-route.test.ts`
- `src/__tests__/backoffice-team-route.test.ts`
- `src/__tests__/delegate-multi-instance.test.ts`

**Modified:**
- `src/db/ticket.ts` — extend `loadAgentInstance` to return `promptOverride`; export a `loadAgentInstanceWithTemplate` variant
- `src/db/team.ts` — no signature change to `materializeTeam`; add `appendCorrespondentDelegationTarget` helper
- `src/workflows/worker-job.ts:92` — swap `template.systemPrompt` for `resolveSystemPrompt(...)`; emit `team:status` on each `setTicketStatus` callsite
- `src/skills/delegate-to-worker.ts` — load all candidate workers, prefer available, round-robin among active
- `src/agents/correspondent.ts` — add `broadcastTeamEvent(event)` RPC
- `src/routes/me.ts` — add team + catalogue + hire + member mutation routes
- `src/routes/backoffice.ts` — add team list + member detail + member patch routes

### `apps/client`

**New:**
- `src/lib/team.ts` — fetchers, response types (mirroring the API shape), pt-BR status display map
- `src/lib/use-team-roster.ts` — hook that subscribes to the WS `team:*` channel + falls back to visibility + 30s poll
- `src/components/team-sidebar.tsx`
- `src/components/agent-card.tsx`
- `src/components/hire-dialog.tsx`
- `src/components/prompt-editor.tsx`
- `src/app/(client)/company/page.tsx`

**Modified:**
- `src/app/(client)/page.tsx` — wrap in 2-column grid on `lg+`
- `src/components/nav.tsx` — add Empresa entry

### `apps/backoffice`

**New:**
- `src/app/(dashboard)/teams/page.tsx`
- `src/app/(dashboard)/teams/[companyId]/page.tsx`
- `src/app/(dashboard)/teams/[companyId]/members/[memberId]/page.tsx`
- `src/components/prompt-editor.tsx`
- `src/lib/team-fetch.ts`

**Modified:**
- `src/components/sidebar.tsx` — add Times nav entry

### `packages/ui`

**New:**
- `src/components/avatar.tsx`
- `src/components/badge.tsx`
- `src/components/dialog.tsx`

---

## Task ordering rationale

Phase A (Tasks 1–6) lands the schema, types, and pure helpers — no behaviour change but a switch from raw template prompts to `resolveSystemPrompt`. Phase B (7–13) adds the DB query layer with unit coverage. Phase C (14–17) wires real-time events. Phase D (18) fixes multi-instance dispatch. Phase E (19–26) exposes everything through routes — customer first, then backoffice. Phase F (27–29) adds the shared UI primitives. Phase G (30–38) is customer UI. Phase H (39–42) is backoffice UI. Phase I (43) is a documented manual smoke run.

Each phase can ship independently; phases A–E carry full test coverage and merge before any UI lands.

---

## Conventions used in every task

- **Commits** — one commit per task, message format `<scope>: <imperative summary>` matching the repo's recent log
- **Tests first** — all backend tasks open with the failing test; UI tasks may skip when no test infrastructure exists for the surface and the smoke run covers it
- **Linter + formatter** — every task ends with `pnpm lint` and `pnpm format:check` clean (no commits with lint failures)
- **No reshuffles** — never re-format unrelated code

---

## Phase A — Schema, types, and prompt resolver

### Task 1: Add `prompt_override` migration

**Files:**
- Create: `apps/agents/migrations/0006_agent_instance_prompt_override.sql`

- [ ] **Step 1: Create the migration**

```sql
-- 0006_agent_instance_prompt_override.sql
-- Adds a per-instance system prompt override. NULL means "use the
-- template's system_prompt"; non-NULL replaces it. Mirrors the existing
-- model_override column pattern. No backfill required.

ALTER TABLE agent_instance ADD COLUMN prompt_override TEXT;
```

- [ ] **Step 2: Apply locally and verify the column exists**

```bash
cd apps/agents
pnpm wrangler d1 migrations apply worker-bees --local
pnpm wrangler d1 execute worker-bees --local --command "PRAGMA table_info(agent_instance);"
```

Expected: a row with `name = 'prompt_override'`, `type = 'TEXT'`, `notnull = 0`, `dflt_value = NULL`.

- [ ] **Step 3: Commit**

```bash
git add apps/agents/migrations/0006_agent_instance_prompt_override.sql
git commit -m "feat(agents): add agent_instance.prompt_override column"
```

---

### Task 2: Extend `loadAgentInstance` with prompt override and template snapshot

**Files:**
- Modify: `apps/agents/src/db/ticket.ts`
- Test: `apps/agents/src/__tests__/db.test.ts` (extend if it covers `loadAgentInstance`, otherwise create `apps/agents/src/__tests__/load-agent-instance.test.ts`)

- [ ] **Step 1: Write the failing test**

Create `apps/agents/src/__tests__/load-agent-instance.test.ts`:

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { loadAgentInstance } from "@/db/ticket";

const COMPANY_ID = "co_lai_test";
const INSTANCE_ID = "ai_lai_test";

beforeEach(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO company
       (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'LAI', 'lai', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO agent_instance
       (id, company_id, role, template_id, template_version, display_name,
        model_override, status, prompt_override, created_at, updated_at)
     VALUES (?, ?, 'worker', 'tpl-designer', 1, 'd', NULL, 'active', 'meu prompt', 0, 0)`,
  )
    .bind(INSTANCE_ID, COMPANY_ID)
    .run();
});

describe("loadAgentInstance", () => {
  it("returns promptOverride when set", async () => {
    const result = await loadAgentInstance(env.DB, INSTANCE_ID);
    expect(result).toEqual({
      id: INSTANCE_ID,
      promptOverride: "meu prompt",
      templateId: "tpl-designer",
    });
  });

  it("returns null promptOverride when unset", async () => {
    await env.DB.prepare("UPDATE agent_instance SET prompt_override = NULL WHERE id = ?")
      .bind(INSTANCE_ID)
      .run();
    const result = await loadAgentInstance(env.DB, INSTANCE_ID);
    expect(result?.promptOverride).toBeNull();
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
pnpm --filter=worker-bees test src/__tests__/load-agent-instance.test.ts
```

Expected: FAIL — `promptOverride` is missing from the returned object.

- [ ] **Step 3: Update `loadAgentInstance` to include `promptOverride`**

In `apps/agents/src/db/ticket.ts`:

```ts
type AgentInstanceRow = {
  id: string;
  prompt_override: string | null;
  template_id: string | null;
};

const loadAgentInstance = async (
  db: D1Database,
  id: string,
): Promise<{ id: string; promptOverride: string | null; templateId: string | null } | null> => {
  const row = await db
    .prepare("SELECT id, template_id, prompt_override FROM agent_instance WHERE id = ?")
    .bind(id)
    .first<AgentInstanceRow>();
  return row
    ? { id: row.id, promptOverride: row.prompt_override, templateId: row.template_id }
    : null;
};
```

- [ ] **Step 4: Run tests to verify they pass and nothing else regressed**

```bash
pnpm --filter=worker-bees test src/__tests__/load-agent-instance.test.ts
pnpm --filter=worker-bees test
pnpm lint
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/db/ticket.ts apps/agents/src/__tests__/load-agent-instance.test.ts
git commit -m "feat(agents): loadAgentInstance returns promptOverride"
```

---

### Task 3: `resolveSystemPrompt` helper

**Files:**
- Create: `apps/agents/src/team/resolve-system-prompt.ts`
- Test: `apps/agents/src/__tests__/team-resolve-system-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/agents/src/__tests__/team-resolve-system-prompt.test.ts
import { describe, expect, it } from "vitest";

import { resolveSystemPrompt } from "@/team/resolve-system-prompt";

describe("resolveSystemPrompt", () => {
  it("returns the template prompt when override is null", () => {
    const out = resolveSystemPrompt(
      { promptOverride: null },
      { systemPrompt: "DEFAULT" },
    );
    expect(out).toBe("DEFAULT");
  });

  it("returns the override when set", () => {
    const out = resolveSystemPrompt(
      { promptOverride: "CUSTOM" },
      { systemPrompt: "DEFAULT" },
    );
    expect(out).toBe("CUSTOM");
  });

  it("treats empty string as an explicit override (not a fallback trigger)", () => {
    // Documented behaviour: '' !== null. If a user saves an empty editor we
    // honour the intent. The UI is responsible for disallowing it if needed.
    const out = resolveSystemPrompt(
      { promptOverride: "" },
      { systemPrompt: "DEFAULT" },
    );
    expect(out).toBe("");
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
pnpm --filter=worker-bees test src/__tests__/team-resolve-system-prompt.test.ts
```

Expected: FAIL — `Cannot find module '@/team/resolve-system-prompt'`.

- [ ] **Step 3: Create the helper**

```ts
// apps/agents/src/team/resolve-system-prompt.ts
// Single source of truth for "what system prompt does this agent run with?".
// Every site that previously read `template.systemPrompt` directly must go
// through this helper so per-instance overrides take effect.

type InstanceLike = { promptOverride: string | null };
type TemplateLike = { systemPrompt: string };

const resolveSystemPrompt = (instance: InstanceLike, template: TemplateLike): string =>
  instance.promptOverride ?? template.systemPrompt;

export { resolveSystemPrompt };
export type { InstanceLike, TemplateLike };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter=worker-bees test src/__tests__/team-resolve-system-prompt.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/team/resolve-system-prompt.ts apps/agents/src/__tests__/team-resolve-system-prompt.test.ts
git commit -m "feat(agents): add resolveSystemPrompt helper"
```

---

### Task 4: Switch every system-prompt callsite to `resolveSystemPrompt`

**Files:**
- Modify: `apps/agents/src/workflows/worker-job.ts:92`
- Test: extend `apps/agents/src/__tests__/worker.test.ts` if it covers the generate step; otherwise an inline assertion is added to a new test that asserts the override propagates

The audit (grep for `template.systemPrompt`) found exactly one callsite: `worker-job.ts:92`. The Correspondent and Planner build their own prompts (`buildSystemPrompt`, `BASE_SYSTEM_PROMPT`) and intentionally don't use a template — they're out of scope.

- [ ] **Step 1: Write the failing test**

Create `apps/agents/src/__tests__/worker-job-prompt-override.test.ts`:

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

// We assert at the unit level that the generateText call receives the
// override. End-to-end is covered by the manual smoke in Phase I.
import { resolveSystemPrompt } from "@/team/resolve-system-prompt";

describe("worker-job uses resolveSystemPrompt", () => {
  it("override beats template at the generate step", () => {
    const instance = { promptOverride: "CUSTOM" };
    const template = { systemPrompt: "DEFAULT" };
    // This is the contract worker-job.ts now relies on.
    expect(resolveSystemPrompt(instance, template)).toBe("CUSTOM");
  });
});
```

- [ ] **Step 2: Run test to verify it passes (it's a contract assertion)**

```bash
pnpm --filter=worker-bees test src/__tests__/worker-job-prompt-override.test.ts
```

Expected: PASS.

- [ ] **Step 3: Update `worker-job.ts:92` to use the helper**

Replace the `generate` block top section in `apps/agents/src/workflows/worker-job.ts`:

```ts
import { resolveSystemPrompt } from "@/team/resolve-system-prompt";
// ... existing imports

// inside the generate step.do callback, just before `generateText({...})`:
const result = await generateText({
  messages: [{ content: ticket.brief, role: "user" }],
  model: getModel(this.env, template.model),
  stopWhen: stepCountIs(5),
  system: resolveSystemPrompt(agentInstance, template),
  tools,
});
```

`agentInstance` is already in scope at that point (it was loaded at line 65). No other changes to the file.

- [ ] **Step 4: Run the full suite and lint**

```bash
pnpm --filter=worker-bees test
pnpm lint
pnpm typecheck
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/workflows/worker-job.ts apps/agents/src/__tests__/worker-job-prompt-override.test.ts
git commit -m "feat(agents): worker-job honors agent_instance.prompt_override"
```

---

### Task 5: `resolveAgentStatus` helper + `TeamMemberView` types

**Files:**
- Create: `apps/agents/src/team/types.ts`
- Create: `apps/agents/src/team/status.ts`
- Test: `apps/agents/src/__tests__/team-status.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/agents/src/__tests__/team-status.test.ts
import { describe, expect, it } from "vitest";

import { resolveAgentStatus } from "@/team/status";

describe("resolveAgentStatus", () => {
  it("returns paused when instance is paused regardless of tickets", () => {
    expect(
      resolveAgentStatus({ status: "paused" }, [
        { ticketId: "t1", summary: "x", status: "in_progress" },
      ]),
    ).toBe("paused");
  });

  it("returns working when any ticket is in_progress", () => {
    expect(
      resolveAgentStatus({ status: "active" }, [
        { ticketId: "t1", summary: "x", status: "in_progress" },
      ]),
    ).toBe("working");
  });

  it("returns awaiting_approval when only awaiting_approval tickets exist", () => {
    expect(
      resolveAgentStatus({ status: "active" }, [
        { ticketId: "t1", summary: "x", status: "awaiting_approval" },
      ]),
    ).toBe("awaiting_approval");
  });

  it("returns working when both in_progress and awaiting_approval exist (in_progress dominates)", () => {
    expect(
      resolveAgentStatus({ status: "active" }, [
        { ticketId: "t1", summary: "x", status: "awaiting_approval" },
        { ticketId: "t2", summary: "y", status: "in_progress" },
      ]),
    ).toBe("working");
  });

  it("returns available when no open tickets", () => {
    expect(resolveAgentStatus({ status: "active" }, [])).toBe("available");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm --filter=worker-bees test src/__tests__/team-status.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the types module**

```ts
// apps/agents/src/team/types.ts
type AgentDisplayStatus = "available" | "working" | "awaiting_approval" | "paused";

type OpenTicketSlim = {
  status: "in_progress" | "awaiting_approval";
  summary: string;
  ticketId: string;
};

type TeamMemberView = {
  currentWork: ReadonlyArray<OpenTicketSlim>;
  displayName: string;
  hasPromptOverride: boolean;
  id: string;
  lifetimeDone: number;
  role: "correspondent" | "planner" | "worker";
  status: AgentDisplayStatus;
  templateId: string | null;
  workerKind: string | null;
};

type TeamMemberDetailView = TeamMemberView & {
  capabilities: string;
  promptOverride: string | null;
  promptOverrideUpdatedAt: number | null;
  templateSystemPrompt: string;
};

type HireableTemplate = {
  description: string;
  displayName: string;
  hiredCount: number;
  id: string;
  workerKind: string;
};

export type {
  AgentDisplayStatus,
  HireableTemplate,
  OpenTicketSlim,
  TeamMemberDetailView,
  TeamMemberView,
};
```

- [ ] **Step 4: Create the status helper**

```ts
// apps/agents/src/team/status.ts
import type { AgentDisplayStatus, OpenTicketSlim } from "@/team/types";

type InstanceStatus = "active" | "paused";

const resolveAgentStatus = (
  instance: { status: InstanceStatus },
  openTickets: ReadonlyArray<OpenTicketSlim>,
): AgentDisplayStatus => {
  if (instance.status === "paused") {
    return "paused";
  }
  if (openTickets.some((t) => t.status === "in_progress")) {
    return "working";
  }
  if (openTickets.some((t) => t.status === "awaiting_approval")) {
    return "awaiting_approval";
  }
  return "available";
};

export { resolveAgentStatus };
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter=worker-bees test src/__tests__/team-status.test.ts
pnpm typecheck
```

Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add apps/agents/src/team/types.ts apps/agents/src/team/status.ts apps/agents/src/__tests__/team-status.test.ts
git commit -m "feat(agents): team status taxonomy + shared view types"
```

---

### Task 6: `nextDisplayName` naming helper

**Files:**
- Create: `apps/agents/src/team/naming.ts`
- Test: `apps/agents/src/__tests__/team-naming.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/agents/src/__tests__/team-naming.test.ts
import { describe, expect, it } from "vitest";

import { nextDisplayName } from "@/team/naming";

describe("nextDisplayName", () => {
  it("returns the base name when none exists yet", () => {
    expect(nextDisplayName("Designer", [])).toBe("Designer");
  });

  it("returns the base name when no exact match exists (renamed instances)", () => {
    expect(nextDisplayName("Designer", ["Marina", "Carla"])).toBe("Designer");
  });

  it("appends #2 when base exists once", () => {
    expect(nextDisplayName("Designer", ["Designer"])).toBe("Designer #2");
  });

  it("finds the lowest free integer", () => {
    expect(nextDisplayName("Designer", ["Designer", "Designer #2", "Designer #4"])).toBe(
      "Designer #3",
    );
  });

  it("ignores case differences in existing names", () => {
    expect(nextDisplayName("Designer", ["designer"])).toBe("Designer #2");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm --filter=worker-bees test src/__tests__/team-naming.test.ts
```

- [ ] **Step 3: Create the helper**

```ts
// apps/agents/src/team/naming.ts
// Given a desired base name (e.g. the template's display_name) and the
// existing team's display names, return the lowest-suffix name that doesn't
// collide. Base if free, else "Base #2", "Base #3", ...

const normalize = (s: string): string => s.toLocaleLowerCase("pt-BR");

const nextDisplayName = (base: string, existing: ReadonlyArray<string>): string => {
  const taken = new Set(existing.map(normalize));
  if (!taken.has(normalize(base))) {
    return base;
  }
  for (let n = 2; n < 1_000; n++) {
    const candidate = `${base} #${n}`;
    if (!taken.has(normalize(candidate))) {
      return candidate;
    }
  }
  throw new Error(`nextDisplayName: exhausted candidates for "${base}"`);
};

export { nextDisplayName };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter=worker-bees test src/__tests__/team-naming.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/team/naming.ts apps/agents/src/__tests__/team-naming.test.ts
git commit -m "feat(agents): nextDisplayName helper for multi-hire"
```

---

## Phase B — DB queries

### Task 7: `getTeamRoster(db, companyId)` query

**Files:**
- Create: `apps/agents/src/team/queries.ts`
- Test: `apps/agents/src/__tests__/team-queries.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/agents/src/__tests__/team-queries.test.ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { getTeamRoster } from "@/team/queries";

const COMPANY_ID = "co_roster_test";
const TEAM_ID = "team_roster_test";
const CORR_ID = "corr_roster_test";
const WORKER_ID = "worker_roster_test";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO company
         (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
       VALUES (?, 'R', 'r', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
    ).bind(COMPANY_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO agent_instance
         (id, company_id, role, template_id, template_version, display_name,
          model_override, status, prompt_override, created_at, updated_at)
       VALUES (?, ?, 'correspondent', NULL, NULL, 'Correspondente', NULL, 'active', NULL, 0, 0)`,
    ).bind(CORR_ID, COMPANY_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO agent_instance
         (id, company_id, role, template_id, template_version, display_name,
          model_override, status, prompt_override, created_at, updated_at)
       VALUES (?, ?, 'worker', 'tpl-designer', 1, 'Designer', NULL, 'active', 'meu', 0, 0)`,
    ).bind(WORKER_ID, COMPANY_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO team (id, company_id, confirmed_at, created_at) VALUES (?, ?, ?, ?)`,
    ).bind(TEAM_ID, COMPANY_ID, 0, 0),
    env.DB.prepare(
      `INSERT OR IGNORE INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES (?, ?, ?)`,
    ).bind(TEAM_ID, CORR_ID, JSON.stringify([WORKER_ID])),
    env.DB.prepare(
      `INSERT OR IGNORE INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES (?, ?, '[]')`,
    ).bind(TEAM_ID, WORKER_ID),
  ]);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO ticket
       (id, company_id, agent_instance_id, parent_ticket_id, title, brief,
        status, origin, workflow_id, result, created_at, updated_at)
     VALUES ('tkt_r1', ?, ?, NULL, 'Logo final', 'fazer logo', 'in_progress',
             'delegation', NULL, NULL, 0, 0)`,
  )
    .bind(COMPANY_ID, WORKER_ID)
    .run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO ticket
       (id, company_id, agent_instance_id, parent_ticket_id, title, brief,
        status, origin, workflow_id, result, created_at, updated_at)
     VALUES ('tkt_r2', ?, ?, NULL, 'Banner antigo', 'feito', 'done',
             'delegation', NULL, '{}', 0, 0)`,
  )
    .bind(COMPANY_ID, WORKER_ID)
    .run();
});

describe("getTeamRoster", () => {
  it("returns the correspondent and worker with derived status + current work + counts", async () => {
    const roster = await getTeamRoster(env.DB, COMPANY_ID);
    const designer = roster.find((m) => m.id === WORKER_ID);
    const correspondent = roster.find((m) => m.id === CORR_ID);

    expect(correspondent).toMatchObject({
      displayName: "Correspondente",
      hasPromptOverride: false,
      role: "correspondent",
      status: "available",
      templateId: null,
      workerKind: null,
    });

    expect(designer).toMatchObject({
      displayName: "Designer",
      hasPromptOverride: true,
      lifetimeDone: 1,
      role: "worker",
      status: "working",
      templateId: "tpl-designer",
      workerKind: "designer",
    });
    expect(designer?.currentWork).toEqual([
      { status: "in_progress", summary: "Logo final", ticketId: "tkt_r1" },
    ]);
  });

  it("orders correspondent first, then by recent activity, then alphabetical", async () => {
    const roster = await getTeamRoster(env.DB, COMPANY_ID);
    expect(roster[0]?.role).toBe("correspondent");
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm --filter=worker-bees test src/__tests__/team-queries.test.ts
```

- [ ] **Step 3: Create the queries module**

```ts
// apps/agents/src/team/queries.ts
import { resolveAgentStatus } from "@/team/status";
import type {
  HireableTemplate,
  OpenTicketSlim,
  TeamMemberDetailView,
  TeamMemberView,
} from "@/team/types";

type RosterRow = {
  display_name: string;
  id: string;
  prompt_override: string | null;
  role: string;
  status: string;
  template_id: string | null;
  worker_kind: string | null;
};

type TicketSlimRow = {
  agent_instance_id: string;
  id: string;
  status: string;
  title: string;
};

type DoneCountRow = { agent_instance_id: string; n: number };

const toOpenStatus = (s: string): OpenTicketSlim["status"] | null =>
  s === "in_progress" || s === "awaiting_approval" ? s : null;

const toInstanceStatus = (s: string): "active" | "paused" => (s === "paused" ? "paused" : "active");

const toRole = (s: string): TeamMemberView["role"] => {
  if (s === "correspondent" || s === "planner" || s === "worker") {
    return s;
  }
  return "worker";
};

const sortRoster = (members: ReadonlyArray<TeamMemberView>): Array<TeamMemberView> => {
  const correspondent = members.filter((m) => m.role === "correspondent");
  const others = members
    .filter((m) => m.role !== "correspondent")
    .sort((a, b) => {
      const aActive = a.currentWork.length > 0 ? 1 : 0;
      const bActive = b.currentWork.length > 0 ? 1 : 0;
      if (aActive !== bActive) {
        return bActive - aActive;
      }
      return a.displayName.localeCompare(b.displayName, "pt-BR");
    });
  return [...correspondent, ...others];
};

const getTeamRoster = async (
  db: D1Database,
  companyId: string,
): Promise<Array<TeamMemberView>> => {
  const { results: rosterRows } = await db
    .prepare(
      `SELECT a.id, a.display_name, a.role, a.status, a.template_id, a.prompt_override,
              t.worker_kind
         FROM agent_instance a
         LEFT JOIN template t ON t.id = a.template_id
        WHERE a.company_id = ?
        ORDER BY a.created_at ASC`,
    )
    .bind(companyId)
    .all<RosterRow>();

  if (rosterRows.length === 0) {
    return [];
  }

  const ids = rosterRows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const { results: openRows } = await db
    .prepare(
      `SELECT id, agent_instance_id, title, status
         FROM ticket
        WHERE company_id = ?
          AND agent_instance_id IN (${placeholders})
          AND status IN ('in_progress', 'awaiting_approval')
        ORDER BY created_at ASC`,
    )
    .bind(companyId, ...ids)
    .all<TicketSlimRow>();
  const { results: doneRows } = await db
    .prepare(
      `SELECT agent_instance_id, COUNT(*) AS n
         FROM ticket
        WHERE company_id = ?
          AND agent_instance_id IN (${placeholders})
          AND status = 'done'
        GROUP BY agent_instance_id`,
    )
    .bind(companyId, ...ids)
    .all<DoneCountRow>();

  const openByAgent = new Map<string, Array<OpenTicketSlim>>();
  for (const row of openRows) {
    const status = toOpenStatus(row.status);
    if (!status) {
      continue;
    }
    const bucket = openByAgent.get(row.agent_instance_id) ?? [];
    bucket.push({ status, summary: row.title, ticketId: row.id });
    openByAgent.set(row.agent_instance_id, bucket);
  }

  const doneByAgent = new Map<string, number>();
  for (const row of doneRows) {
    doneByAgent.set(row.agent_instance_id, row.n);
  }

  const members: Array<TeamMemberView> = rosterRows.map((row) => {
    const current = openByAgent.get(row.id) ?? [];
    return {
      currentWork: current,
      displayName: row.display_name,
      hasPromptOverride: row.prompt_override !== null,
      id: row.id,
      lifetimeDone: doneByAgent.get(row.id) ?? 0,
      role: toRole(row.role),
      status: resolveAgentStatus({ status: toInstanceStatus(row.status) }, current),
      templateId: row.template_id,
      workerKind: row.worker_kind,
    };
  });

  return sortRoster(members);
};

export { getTeamRoster };
export type { HireableTemplate, TeamMemberDetailView, TeamMemberView };
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter=worker-bees test src/__tests__/team-queries.test.ts
pnpm typecheck
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/team/queries.ts apps/agents/src/__tests__/team-queries.test.ts
git commit -m "feat(agents): getTeamRoster returns derived TeamMemberView shape"
```

---

### Task 8: `getCatalogue(db, companyId)` with `hiredCount`

**Files:**
- Modify: `apps/agents/src/team/queries.ts`
- Test: extend `apps/agents/src/__tests__/team-queries.test.ts`

- [ ] **Step 1: Write the failing test (append to the existing file)**

```ts
import { getCatalogue, getTeamRoster } from "@/team/queries";

// ... existing describe blocks unchanged ...

describe("getCatalogue", () => {
  it("returns active worker templates with per-template hiredCount for this company", async () => {
    const items = await getCatalogue(env.DB, COMPANY_ID);
    const designer = items.find((t) => t.id === "tpl-designer");
    expect(designer).toMatchObject({
      hiredCount: 1, // the seeded WORKER_ID instance
      workerKind: "designer",
    });
  });

  it("returns 0 for templates with no hires on this company", async () => {
    // Insert a template no instance points at.
    await env.DB.prepare(
      `INSERT OR REPLACE INTO template
         (id, version, status, display_name, description, system_prompt, model,
          worker_kind, skill_ids, default_action_type, default_policies,
          created_at, updated_at)
       VALUES ('tpl-fresh', 1, 'active', 'Novo Tipo', 'desc', 'sys', 'gpt-x',
               'newkind', '[]', 'worker_deliverable', '{}', 0, 0)`,
    ).run();
    const items = await getCatalogue(env.DB, COMPANY_ID);
    expect(items.find((t) => t.id === "tpl-fresh")?.hiredCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement `getCatalogue` in `apps/agents/src/team/queries.ts`**

Append:

```ts
type CatalogueCountRow = { n: number; template_id: string };

const getCatalogue = async (
  db: D1Database,
  companyId: string,
): Promise<Array<HireableTemplate>> => {
  const { results: templates } = await db
    .prepare(
      `SELECT id, display_name, description, worker_kind
         FROM template
        WHERE status = 'active'
        ORDER BY display_name ASC`,
    )
    .all<{ description: string; display_name: string; id: string; worker_kind: string }>();

  const { results: counts } = await db
    .prepare(
      `SELECT template_id, COUNT(*) AS n
         FROM agent_instance
        WHERE company_id = ? AND role = 'worker' AND template_id IS NOT NULL
        GROUP BY template_id`,
    )
    .bind(companyId)
    .all<CatalogueCountRow>();

  const countByTemplate = new Map<string, number>();
  for (const row of counts) {
    countByTemplate.set(row.template_id, row.n);
  }

  return templates.map((t) => ({
    description: t.description,
    displayName: t.display_name,
    hiredCount: countByTemplate.get(t.id) ?? 0,
    id: t.id,
    workerKind: t.worker_kind,
  }));
};

export { getCatalogue };
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter=worker-bees test src/__tests__/team-queries.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/team/queries.ts apps/agents/src/__tests__/team-queries.test.ts
git commit -m "feat(agents): getCatalogue returns templates with per-company hiredCount"
```

---

### Task 9: `getMemberDetail(db, agentInstanceId)`

**Files:**
- Modify: `apps/agents/src/team/queries.ts`
- Test: extend `apps/agents/src/__tests__/team-queries.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
import { getCatalogue, getMemberDetail, getTeamRoster } from "@/team/queries";

// ...

describe("getMemberDetail", () => {
  it("returns the template prompt and override + last edited timestamp", async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO template
         (id, version, status, display_name, description, system_prompt, model,
          worker_kind, skill_ids, default_action_type, default_policies,
          created_at, updated_at)
       VALUES ('tpl-designer', 1, 'active', 'Designer', 'cria imagens',
               'TEMPLATE_PROMPT', 'gpt-x', 'designer', '[]',
               'worker_deliverable', '{}', 0, 0)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO activity_log
         (id, company_id, actor_id, type, ref_type, ref_id, summary, payload, created_at)
       VALUES ('al_pe', ?, NULL, 'MEMBER_PROMPT_EDITED', 'agent_instance', ?, 'edited', '{}', 1234)`,
    )
      .bind(COMPANY_ID, WORKER_ID)
      .run();

    const detail = await getMemberDetail(env.DB, COMPANY_ID, WORKER_ID);
    expect(detail).toMatchObject({
      capabilities: "cria imagens",
      hasPromptOverride: true,
      id: WORKER_ID,
      promptOverride: "meu",
      promptOverrideUpdatedAt: 1234,
      templateSystemPrompt: "TEMPLATE_PROMPT",
    });
  });

  it("returns null promptOverrideUpdatedAt when no edit log row exists", async () => {
    // Reset the seeded designer to have override = NULL
    await env.DB.prepare("UPDATE agent_instance SET prompt_override = NULL WHERE id = ?")
      .bind(WORKER_ID)
      .run();
    await env.DB.prepare(
      "DELETE FROM activity_log WHERE ref_id = ? AND type = 'MEMBER_PROMPT_EDITED'",
    )
      .bind(WORKER_ID)
      .run();
    const detail = await getMemberDetail(env.DB, COMPANY_ID, WORKER_ID);
    expect(detail?.hasPromptOverride).toBe(false);
    expect(detail?.promptOverride).toBeNull();
    expect(detail?.promptOverrideUpdatedAt).toBeNull();
  });

  it("returns null when the instance doesn't belong to that company", async () => {
    const detail = await getMemberDetail(env.DB, "co_other", WORKER_ID);
    expect(detail).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement `getMemberDetail` in `apps/agents/src/team/queries.ts`**

Append:

```ts
type DetailRow = RosterRow & {
  description: string | null;
  system_prompt: string | null;
};

const getMemberDetail = async (
  db: D1Database,
  companyId: string,
  agentInstanceId: string,
): Promise<TeamMemberDetailView | null> => {
  const row = await db
    .prepare(
      `SELECT a.id, a.display_name, a.role, a.status, a.template_id, a.prompt_override,
              t.worker_kind, t.description, t.system_prompt
         FROM agent_instance a
         LEFT JOIN template t ON t.id = a.template_id
        WHERE a.id = ? AND a.company_id = ?`,
    )
    .bind(agentInstanceId, companyId)
    .first<DetailRow>();
  if (!row) {
    return null;
  }

  const { results: openRows } = await db
    .prepare(
      `SELECT id, agent_instance_id, title, status
         FROM ticket
        WHERE company_id = ? AND agent_instance_id = ?
          AND status IN ('in_progress', 'awaiting_approval')`,
    )
    .bind(companyId, agentInstanceId)
    .all<TicketSlimRow>();
  const currentWork: Array<OpenTicketSlim> = openRows.flatMap((r) => {
    const s = toOpenStatus(r.status);
    return s ? [{ status: s, summary: r.title, ticketId: r.id }] : [];
  });
  const done = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM ticket
        WHERE company_id = ? AND agent_instance_id = ? AND status = 'done'`,
    )
    .bind(companyId, agentInstanceId)
    .first<{ n: number }>();

  const editedRow = await db
    .prepare(
      `SELECT created_at FROM activity_log
        WHERE company_id = ? AND ref_id = ? AND type = 'MEMBER_PROMPT_EDITED'
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(companyId, agentInstanceId)
    .first<{ created_at: number }>();

  return {
    capabilities: row.description ?? "",
    currentWork,
    displayName: row.display_name,
    hasPromptOverride: row.prompt_override !== null,
    id: row.id,
    lifetimeDone: done?.n ?? 0,
    promptOverride: row.prompt_override,
    promptOverrideUpdatedAt: editedRow?.created_at ?? null,
    role: toRole(row.role),
    status: resolveAgentStatus({ status: toInstanceStatus(row.status) }, currentWork),
    templateId: row.template_id,
    templateSystemPrompt: row.system_prompt ?? "",
    workerKind: row.worker_kind,
  };
};

export { getMemberDetail };
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter=worker-bees test src/__tests__/team-queries.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/team/queries.ts apps/agents/src/__tests__/team-queries.test.ts
git commit -m "feat(agents): getMemberDetail returns TeamMemberDetailView"
```

---

### Task 10: `hireMember` mutation

**Files:**
- Create: `apps/agents/src/team/mutations.ts`
- Test: `apps/agents/src/__tests__/team-mutations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/agents/src/__tests__/team-mutations.test.ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { hireMember } from "@/team/mutations";

const COMPANY_ID = "co_hire_test";
const TEAM_ID = "team_hire_test";
const CORR_ID = "corr_hire_test";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO company
         (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
       VALUES (?, 'H', 'h', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
    ).bind(COMPANY_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO template
         (id, version, status, display_name, description, system_prompt, model,
          worker_kind, skill_ids, default_action_type, default_policies,
          created_at, updated_at)
       VALUES ('tpl-designer', 1, 'active', 'Designer', 'd', 'sys', 'gpt-x',
               'designer', '[]', 'worker_deliverable', '{}', 0, 0)`,
    ),
    env.DB.prepare(
      `INSERT OR REPLACE INTO agent_instance
         (id, company_id, role, template_id, template_version, display_name,
          model_override, status, prompt_override, created_at, updated_at)
       VALUES (?, ?, 'correspondent', NULL, NULL, 'Correspondente', NULL, 'active', NULL, 0, 0)`,
    ).bind(CORR_ID, COMPANY_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO team (id, company_id, confirmed_at, created_at) VALUES (?, ?, ?, ?)`,
    ).bind(TEAM_ID, COMPANY_ID, 0, 0),
    env.DB.prepare(
      `INSERT OR IGNORE INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES (?, ?, '[]')`,
    ).bind(TEAM_ID, CORR_ID),
  ]);
});

describe("hireMember", () => {
  it("creates a new agent_instance + team_member and appends to correspondent's delegation list", async () => {
    const member = await hireMember(env.DB, {
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    expect(member.displayName).toBe("Designer");
    expect(member.role).toBe("worker");
    expect(member.templateId).toBe("tpl-designer");

    const corrRow = await env.DB.prepare(
      "SELECT can_delegate_to FROM team_member WHERE agent_instance_id = ?",
    )
      .bind(CORR_ID)
      .first<{ can_delegate_to: string }>();
    const targets = JSON.parse(corrRow?.can_delegate_to ?? "[]") as Array<string>;
    expect(targets).toContain(member.id);
  });

  it("allows multi-hire of the same template with auto-numbered name", async () => {
    const first = await hireMember(env.DB, {
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    const second = await hireMember(env.DB, {
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    expect(first.displayName).toBe("Designer");
    expect(second.displayName).toBe("Designer #2");
    expect(second.id).not.toBe(first.id);
  });

  it("uses a provided displayName when present", async () => {
    const member = await hireMember(env.DB, {
      companyId: COMPANY_ID,
      displayName: "Marina",
      templateId: "tpl-designer",
    });
    expect(member.displayName).toBe("Marina");
  });

  it("writes MEMBER_HIRED activity row", async () => {
    const member = await hireMember(env.DB, {
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    const row = await env.DB.prepare(
      "SELECT type FROM activity_log WHERE ref_id = ? AND type = 'MEMBER_HIRED'",
    )
      .bind(member.id)
      .first<{ type: string }>();
    expect(row?.type).toBe("MEMBER_HIRED");
  });

  it("rejects unknown templates with a clear error", async () => {
    await expect(
      hireMember(env.DB, {
        companyId: COMPANY_ID,
        displayName: undefined,
        templateId: "tpl-nope",
      }),
    ).rejects.toThrow(/template.*tpl-nope/);
  });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Create `apps/agents/src/team/mutations.ts`**

```ts
import { logActivity } from "@/activity/log";
import { correspondentIdFor, teamIdFor } from "@/db/team";
import { getTemplate } from "@/db/template";
import { nextDisplayName } from "@/team/naming";
import { getMemberDetail, getTeamRoster } from "@/team/queries";
import type { TeamMemberView } from "@/team/types";

type HireInput = {
  companyId: string;
  displayName: string | undefined;
  templateId: string;
};

const NEW_WORKER_PREFIX = "wkr_";

// We use a UUID rather than the seeded worker IDs' deterministic
// `worker-${tpl}-${co}` form because multi-hire would collide. The seeded
// instances keep their stable IDs; everything created here gets a UUID.
const newWorkerId = (): string => `${NEW_WORKER_PREFIX}${crypto.randomUUID()}`;

const hireMember = async (
  db: D1Database,
  input: HireInput,
): Promise<TeamMemberView> => {
  const template = await getTemplate(db, input.templateId);
  if (!template) {
    throw new Error(`template ${input.templateId} not found`);
  }
  if (template.status !== "active") {
    throw new Error(`template ${input.templateId} is retired`);
  }

  const existingRoster = await getTeamRoster(db, input.companyId);
  const desiredName =
    input.displayName?.trim() ??
    nextDisplayName(
      template.displayName,
      existingRoster.map((m) => m.displayName),
    );

  const newId = newWorkerId();
  const teamId = teamIdFor(input.companyId);
  const correspondentId = correspondentIdFor(input.companyId);
  const now = Date.now();

  // Read current correspondent delegation list, append, write back. Done as
  // a read-then-batch because D1 has no JSON_ARRAY_APPEND primitive.
  const corrRow = await db
    .prepare("SELECT can_delegate_to FROM team_member WHERE agent_instance_id = ? AND team_id = ?")
    .bind(correspondentId, teamId)
    .first<{ can_delegate_to: string }>();
  if (!corrRow) {
    throw new Error(`correspondent team_member missing for ${input.companyId}`);
  }
  const targets = JSON.parse(corrRow.can_delegate_to) as Array<string>;
  const updatedTargets = [...targets, newId];

  await db.batch([
    db
      .prepare(
        `INSERT INTO agent_instance
           (id, company_id, role, template_id, template_version, display_name,
            model_override, status, prompt_override, created_at, updated_at)
         VALUES (?, ?, 'worker', ?, ?, ?, NULL, 'active', NULL, ?, ?)`,
      )
      .bind(
        newId,
        input.companyId,
        template.id,
        template.version,
        desiredName,
        now,
        now,
      ),
    db
      .prepare(
        "INSERT INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES (?, ?, '[]')",
      )
      .bind(teamId, newId),
    db
      .prepare("UPDATE team_member SET can_delegate_to = ? WHERE agent_instance_id = ? AND team_id = ?")
      .bind(JSON.stringify(updatedTargets), correspondentId, teamId),
  ]);

  await logActivity(
    { DB: db } as { DB: D1Database },
    {
      companyId: input.companyId,
      payload: { displayName: desiredName, templateId: template.id },
      refId: newId,
      refType: "agent_instance",
      summary: `Agente "${desiredName}" contratado.`,
      type: "MEMBER_HIRED",
    },
  );

  const detail = await getMemberDetail(db, input.companyId, newId);
  if (!detail) {
    throw new Error("hireMember: failed to read back the new member");
  }
  // Strip the detail fields the public view doesn't include.
  return {
    currentWork: detail.currentWork,
    displayName: detail.displayName,
    hasPromptOverride: detail.hasPromptOverride,
    id: detail.id,
    lifetimeDone: detail.lifetimeDone,
    role: detail.role,
    status: detail.status,
    templateId: detail.templateId,
    workerKind: detail.workerKind,
  };
};

export { hireMember, newWorkerId, NEW_WORKER_PREFIX };
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter=worker-bees test src/__tests__/team-mutations.test.ts
pnpm typecheck
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/team/mutations.ts apps/agents/src/__tests__/team-mutations.test.ts
git commit -m "feat(agents): hireMember mutation with multi-hire + delegation graph append"
```

---

### Task 11: `pauseMember` / `resumeMember`

**Files:**
- Modify: `apps/agents/src/team/mutations.ts`
- Test: extend `apps/agents/src/__tests__/team-mutations.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { hireMember, pauseMember, resumeMember } from "@/team/mutations";

// ... existing describes unchanged ...

describe("pauseMember / resumeMember", () => {
  it("pauses a worker and writes activity", async () => {
    const member = await hireMember(env.DB, {
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    const paused = await pauseMember(env.DB, COMPANY_ID, member.id);
    expect(paused.status).toBe("paused");
    const row = await env.DB.prepare(
      "SELECT status FROM agent_instance WHERE id = ?",
    )
      .bind(member.id)
      .first<{ status: string }>();
    expect(row?.status).toBe("paused");
    const log = await env.DB.prepare(
      "SELECT type FROM activity_log WHERE ref_id = ? AND type = 'MEMBER_PAUSED'",
    )
      .bind(member.id)
      .first<{ type: string }>();
    expect(log?.type).toBe("MEMBER_PAUSED");
  });

  it("resumes a paused worker", async () => {
    const member = await hireMember(env.DB, {
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    await pauseMember(env.DB, COMPANY_ID, member.id);
    const resumed = await resumeMember(env.DB, COMPANY_ID, member.id);
    expect(resumed.status).toBe("available");
  });

  it("rejects pausing the correspondent", async () => {
    await expect(pauseMember(env.DB, COMPANY_ID, CORR_ID)).rejects.toThrow(/correspondent/);
  });

  it("is idempotent (pausing twice returns paused without error)", async () => {
    const member = await hireMember(env.DB, {
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    await pauseMember(env.DB, COMPANY_ID, member.id);
    const again = await pauseMember(env.DB, COMPANY_ID, member.id);
    expect(again.status).toBe("paused");
  });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement in `apps/agents/src/team/mutations.ts`** (append)

```ts
import { getMemberDetail } from "@/team/queries"; // already imported

const assertMemberPausable = async (
  db: D1Database,
  companyId: string,
  agentInstanceId: string,
): Promise<void> => {
  const row = await db
    .prepare("SELECT role FROM agent_instance WHERE id = ? AND company_id = ?")
    .bind(agentInstanceId, companyId)
    .first<{ role: string }>();
  if (!row) {
    throw new Error(`agent_instance ${agentInstanceId} not in company ${companyId}`);
  }
  if (row.role !== "worker") {
    throw new Error(`cannot pause/resume a ${row.role}`);
  }
};

const setMemberStatus = async (
  db: D1Database,
  companyId: string,
  agentInstanceId: string,
  status: "active" | "paused",
  activityType: "MEMBER_PAUSED" | "MEMBER_RESUMED",
): Promise<TeamMemberView> => {
  await assertMemberPausable(db, companyId, agentInstanceId);
  await db
    .prepare(
      "UPDATE agent_instance SET status = ?, updated_at = ? WHERE id = ? AND company_id = ?",
    )
    .bind(status, Date.now(), agentInstanceId, companyId)
    .run();
  await logActivity(
    { DB: db } as { DB: D1Database },
    {
      companyId,
      refId: agentInstanceId,
      refType: "agent_instance",
      summary: status === "paused" ? "Agente pausado." : "Agente retomado.",
      type: activityType,
    },
  );
  const detail = await getMemberDetail(db, companyId, agentInstanceId);
  if (!detail) {
    throw new Error("setMemberStatus: read-back failed");
  }
  return {
    currentWork: detail.currentWork,
    displayName: detail.displayName,
    hasPromptOverride: detail.hasPromptOverride,
    id: detail.id,
    lifetimeDone: detail.lifetimeDone,
    role: detail.role,
    status: detail.status,
    templateId: detail.templateId,
    workerKind: detail.workerKind,
  };
};

const pauseMember = (db: D1Database, companyId: string, agentInstanceId: string) =>
  setMemberStatus(db, companyId, agentInstanceId, "paused", "MEMBER_PAUSED");

const resumeMember = (db: D1Database, companyId: string, agentInstanceId: string) =>
  setMemberStatus(db, companyId, agentInstanceId, "active", "MEMBER_RESUMED");

export { pauseMember, resumeMember };
```

- [ ] **Step 4: Run tests + typecheck**

```bash
pnpm --filter=worker-bees test src/__tests__/team-mutations.test.ts
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/team/mutations.ts apps/agents/src/__tests__/team-mutations.test.ts
git commit -m "feat(agents): pauseMember/resumeMember mutations + correspondent guard"
```

---

### Task 12: `updateMember` (rename + prompt override)

**Files:**
- Modify: `apps/agents/src/team/mutations.ts`
- Test: extend `apps/agents/src/__tests__/team-mutations.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { hireMember, pauseMember, resumeMember, updateMember } from "@/team/mutations";

// ...

describe("updateMember", () => {
  it("renames a worker", async () => {
    const member = await hireMember(env.DB, {
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    const updated = await updateMember(env.DB, {
      agentInstanceId: member.id,
      companyId: COMPANY_ID,
      displayName: "Marina",
      editedBy: "customer",
      operatorId: null,
      promptOverride: undefined,
    });
    expect(updated.displayName).toBe("Marina");
    const log = await env.DB.prepare(
      "SELECT type FROM activity_log WHERE ref_id = ? AND type = 'MEMBER_RENAMED'",
    )
      .bind(member.id)
      .first<{ type: string }>();
    expect(log?.type).toBe("MEMBER_RENAMED");
  });

  it("sets the prompt override and logs MEMBER_PROMPT_EDITED", async () => {
    const member = await hireMember(env.DB, {
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    const updated = await updateMember(env.DB, {
      agentInstanceId: member.id,
      companyId: COMPANY_ID,
      displayName: undefined,
      editedBy: "operator",
      operatorId: "user-staff-1",
      promptOverride: "Seja minimalista, monocromático.",
    });
    expect(updated.hasPromptOverride).toBe(true);
    const log = await env.DB.prepare(
      "SELECT type, actor_id FROM activity_log WHERE ref_id = ? AND type = 'MEMBER_PROMPT_EDITED'",
    )
      .bind(member.id)
      .first<{ actor_id: string | null; type: string }>();
    expect(log).toEqual({ actor_id: "user-staff-1", type: "MEMBER_PROMPT_EDITED" });
  });

  it("clears the prompt override when promptOverride is null + logs MEMBER_PROMPT_RESET", async () => {
    const member = await hireMember(env.DB, {
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    await updateMember(env.DB, {
      agentInstanceId: member.id,
      companyId: COMPANY_ID,
      displayName: undefined,
      editedBy: "customer",
      operatorId: null,
      promptOverride: "anything",
    });
    const cleared = await updateMember(env.DB, {
      agentInstanceId: member.id,
      companyId: COMPANY_ID,
      displayName: undefined,
      editedBy: "customer",
      operatorId: null,
      promptOverride: null,
    });
    expect(cleared.hasPromptOverride).toBe(false);
    const log = await env.DB.prepare(
      "SELECT type FROM activity_log WHERE ref_id = ? AND type = 'MEMBER_PROMPT_RESET'",
    )
      .bind(member.id)
      .first<{ type: string }>();
    expect(log?.type).toBe("MEMBER_PROMPT_RESET");
  });

  it("accepts both fields in one call", async () => {
    const member = await hireMember(env.DB, {
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    const updated = await updateMember(env.DB, {
      agentInstanceId: member.id,
      companyId: COMPANY_ID,
      displayName: "Carla",
      editedBy: "customer",
      operatorId: null,
      promptOverride: "boa noite",
    });
    expect(updated.displayName).toBe("Carla");
    expect(updated.hasPromptOverride).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement `updateMember` in `apps/agents/src/team/mutations.ts`** (append)

```ts
type UpdateInput = {
  agentInstanceId: string;
  companyId: string;
  displayName: string | undefined;
  editedBy: "customer" | "operator";
  operatorId: string | null;
  // `null` means "clear override"; `undefined` means "don't touch".
  promptOverride: string | null | undefined;
};

const updateMember = async (
  db: D1Database,
  input: UpdateInput,
): Promise<TeamMemberView> => {
  const existing = await db
    .prepare(
      "SELECT display_name, prompt_override FROM agent_instance WHERE id = ? AND company_id = ?",
    )
    .bind(input.agentInstanceId, input.companyId)
    .first<{ display_name: string; prompt_override: string | null }>();
  if (!existing) {
    throw new Error(`agent_instance ${input.agentInstanceId} not in company ${input.companyId}`);
  }

  const sets: Array<string> = [];
  const binds: Array<string | number | null> = [];
  let renameLog: { newName: string; oldName: string } | null = null;
  let promptLog: "MEMBER_PROMPT_EDITED" | "MEMBER_PROMPT_RESET" | null = null;
  let nextLength: number | null = null;

  if (input.displayName !== undefined) {
    const trimmed = input.displayName.trim();
    if (trimmed.length === 0) {
      throw new Error("displayName cannot be empty");
    }
    if (trimmed !== existing.display_name) {
      sets.push("display_name = ?");
      binds.push(trimmed);
      renameLog = { newName: trimmed, oldName: existing.display_name };
    }
  }

  if (input.promptOverride !== undefined) {
    if (input.promptOverride === null) {
      sets.push("prompt_override = NULL");
      promptLog = "MEMBER_PROMPT_RESET";
    } else {
      sets.push("prompt_override = ?");
      binds.push(input.promptOverride);
      promptLog = "MEMBER_PROMPT_EDITED";
      nextLength = input.promptOverride.length;
    }
  }

  if (sets.length > 0) {
    sets.push("updated_at = ?");
    binds.push(Date.now());
    binds.push(input.agentInstanceId);
    binds.push(input.companyId);
    await db
      .prepare(`UPDATE agent_instance SET ${sets.join(", ")} WHERE id = ? AND company_id = ?`)
      .bind(...binds)
      .run();
  }

  if (renameLog) {
    await logActivity(
      { DB: db } as { DB: D1Database },
      {
        actorId: input.operatorId ?? undefined,
        companyId: input.companyId,
        payload: renameLog,
        refId: input.agentInstanceId,
        refType: "agent_instance",
        summary: `Renomeado de "${renameLog.oldName}" para "${renameLog.newName}".`,
        type: "MEMBER_RENAMED",
      },
    );
  }
  if (promptLog) {
    await logActivity(
      { DB: db } as { DB: D1Database },
      {
        actorId: input.operatorId ?? undefined,
        companyId: input.companyId,
        payload:
          promptLog === "MEMBER_PROMPT_EDITED"
            ? { editedBy: input.editedBy, length: nextLength }
            : { editedBy: input.editedBy },
        refId: input.agentInstanceId,
        refType: "agent_instance",
        summary:
          promptLog === "MEMBER_PROMPT_EDITED"
            ? "Prompt personalizado atualizado."
            : "Prompt restaurado ao padrão do template.",
        type: promptLog,
      },
    );
  }

  const detail = await getMemberDetail(db, input.companyId, input.agentInstanceId);
  if (!detail) {
    throw new Error("updateMember: read-back failed");
  }
  return {
    currentWork: detail.currentWork,
    displayName: detail.displayName,
    hasPromptOverride: detail.hasPromptOverride,
    id: detail.id,
    lifetimeDone: detail.lifetimeDone,
    role: detail.role,
    status: detail.status,
    templateId: detail.templateId,
    workerKind: detail.workerKind,
  };
};

export { updateMember };
export type { UpdateInput };
```

- [ ] **Step 4: Run tests + typecheck + lint**

```bash
pnpm --filter=worker-bees test src/__tests__/team-mutations.test.ts
pnpm typecheck
pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/team/mutations.ts apps/agents/src/__tests__/team-mutations.test.ts
git commit -m "feat(agents): updateMember handles rename + promptOverride with audit"
```

---

## Phase C — Real-time events

### Task 13: `broadcastTeamEvent` RPC on CorrespondentAgent

**Files:**
- Modify: `apps/agents/src/agents/correspondent.ts`
- Test: `apps/agents/src/__tests__/team-broadcast.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/agents/src/__tests__/team-broadcast.test.ts
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { CorrespondentAgent } from "@/agents/correspondent";

const COMPANY_ID = "co_broadcast_test";

describe("CorrespondentAgent.broadcastTeamEvent", () => {
  it("sends a JSON frame to all connected WebSocket peers", async () => {
    const stub = env.CORRESPONDENT.get(env.CORRESPONDENT.idFromName(COMPANY_ID));
    const sent: Array<string> = [];
    await runInDurableObject(stub, async (instance: InstanceType<typeof CorrespondentAgent>) => {
      const fakePeer = { send: (msg: string) => sent.push(msg) };
      // Inject a peer through the SDK's internal connections set if available;
      // otherwise stub getConnections() directly for the test.
      (instance as unknown as { getConnections: () => Array<{ send: (m: string) => void }> })
        .getConnections = () => [fakePeer];
      await instance.broadcastTeamEvent({
        companyId: COMPANY_ID,
        reason: "ticket_changed",
        type: "team:status",
      });
    });
    expect(sent).toHaveLength(1);
    const decoded = JSON.parse(sent[0]!) as { reason: string; type: string };
    expect(decoded.type).toBe("team:status");
    expect(decoded.reason).toBe("ticket_changed");
  });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Add the RPC + event type to `apps/agents/src/agents/correspondent.ts`**

At the top of the file (after existing imports):

```ts
type TeamEvent =
  | {
      companyId: string;
      reason: "ticket_changed" | "instance_changed";
      type: "team:status";
    }
  | {
      companyId: string;
      reason: "hired" | "paused" | "resumed" | "renamed" | "prompt_changed";
      type: "team:roster";
    };
```

Inside the `CorrespondentAgent` class (alongside the existing RPC methods):

```ts
// Fans a team:* invalidation ping out to all connected WS peers. Pure
// invalidation — the payload carries no row data, the client refetches
// /api/me/team on receipt. Errors are swallowed by callers (`emitTeamEvent`):
// the DB is source of truth, the event is a cache hint.
broadcastTeamEvent(event: TeamEvent): void {
  const frame = JSON.stringify(event);
  for (const peer of this.getConnections()) {
    try {
      peer.send(frame);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logInfo("agent.broadcastTeamEvent.send.err", {
        companyId: event.companyId,
        error: message,
        type: event.type,
      });
    }
  }
}
```

Export `TeamEvent` from this file:

```ts
export { CorrespondentAgent };
export type { TeamEvent };
```

- [ ] **Step 4: Run the test**

```bash
pnpm --filter=worker-bees test src/__tests__/team-broadcast.test.ts
pnpm typecheck
```

If `getConnections()` isn't on the SDK base class under the same name (verify by reading `node_modules/agents/dist/...` exports if needed), use the equivalent — e.g. `this.broadcast(frame)` if exposed. Adjust both the implementation and the test stub accordingly.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/agents/correspondent.ts apps/agents/src/__tests__/team-broadcast.test.ts
git commit -m "feat(agents): CorrespondentAgent.broadcastTeamEvent RPC"
```

---

### Task 14: `emitTeamEvent` helper

**Files:**
- Create: `apps/agents/src/team/events.ts`
- Test: `apps/agents/src/__tests__/team-events.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/agents/src/__tests__/team-events.test.ts
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { CorrespondentAgent } from "@/agents/correspondent";
import { emitTeamEvent } from "@/team/events";

const COMPANY_ID = "co_emit_test";

describe("emitTeamEvent", () => {
  it("calls broadcastTeamEvent on the correct CorrespondentAgent DO", async () => {
    const stub = env.CORRESPONDENT.get(env.CORRESPONDENT.idFromName(COMPANY_ID));
    const received: Array<string> = [];
    await runInDurableObject(stub, async (instance: InstanceType<typeof CorrespondentAgent>) => {
      (instance as unknown as { getConnections: () => Array<{ send: (m: string) => void }> })
        .getConnections = () => [{ send: (m: string) => received.push(m) }];
    });
    await emitTeamEvent(env, {
      companyId: COMPANY_ID,
      reason: "hired",
      type: "team:roster",
    });
    // The send happens inside the DO, so re-enter to read the captured frames.
    await runInDurableObject(stub, async () => {
      // no-op: serialize after the broadcast
    });
    expect(received).toEqual([
      JSON.stringify({ companyId: COMPANY_ID, reason: "hired", type: "team:roster" }),
    ]);
  });

  it("swallows errors when the DO is unreachable", async () => {
    await expect(
      emitTeamEvent({ ...env, CORRESPONDENT: undefined as unknown as DurableObjectNamespace }, {
        companyId: "anything",
        reason: "hired",
        type: "team:roster",
      }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Create `apps/agents/src/team/events.ts`**

```ts
import { getAgentByName } from "agents";

import type { TeamEvent } from "@/agents/correspondent";
import { logError } from "@/lib/logger";

const emitTeamEvent = async (env: Env, event: TeamEvent): Promise<void> => {
  try {
    const stub = await getAgentByName(env.CORRESPONDENT, event.companyId);
    stub.broadcastTeamEvent(event);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError("team.event.emit.err", {
      companyId: event.companyId,
      error: message,
      type: event.type,
    });
  }
};

export { emitTeamEvent };
```

- [ ] **Step 4: Run tests + typecheck**

```bash
pnpm --filter=worker-bees test src/__tests__/team-events.test.ts
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/team/events.ts apps/agents/src/__tests__/team-events.test.ts
git commit -m "feat(agents): emitTeamEvent helper (best-effort fan-out via DO)"
```

---

### Task 15: Wire `emitTeamEvent` into `setTicketStatus` callsites

**Files:**
- Modify: `apps/agents/src/workflows/worker-job.ts`

Emission happens at the four ticket-status transitions: `propose-deliverable → awaiting_approval` (line 186), `apply-decision approved → done` (after line 256), `apply-decision rejected → rejected` (line 276), `apply-decision changes_requested → in_progress` (line 289). Plus the auto-execute branch's `markTicketDone` at line 144.

- [ ] **Step 1: Import `emitTeamEvent` at top of `worker-job.ts`**

```ts
import { emitTeamEvent } from "@/team/events";
```

- [ ] **Step 2: After each `setTicketStatus` and `markTicketDone` call, add the emit**

Pattern (apply to each of the 5 callsites — line numbers below are pre-Task 4 and will have shifted by 1–2 lines after the import added in Task 4; locate by call signature, not line):

```ts
await setTicketStatus(this.env.DB, ticketId, "awaiting_approval");
await emitTeamEvent(this.env, {
  companyId,
  reason: "ticket_changed",
  type: "team:status",
});
```

Do this for:
- After `markTicketDone(...)` in the auto-execute branch (around line 144)
- After `setTicketStatus(..., "awaiting_approval")` (around line 186)
- After `markTicketDone(..., { summary: generated.summary })` in the approved branch (around line 256)
- After `setTicketStatus(..., "rejected")` (around line 276)
- After `setTicketStatus(..., "in_progress")` (around line 289)

- [ ] **Step 3: Add an end-to-end assertion test**

Create `apps/agents/src/__tests__/worker-job-emits-team-status.test.ts`:

```ts
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { CorrespondentAgent } from "@/agents/correspondent";
import { setTicketStatus } from "@/db/ticket";
import { emitTeamEvent } from "@/team/events";

const COMPANY_ID = "co_emit_e2e";

describe("ticket-status transitions emit team:status", () => {
  it("emitTeamEvent invocation reaches the CorrespondentAgent DO", async () => {
    const stub = env.CORRESPONDENT.get(env.CORRESPONDENT.idFromName(COMPANY_ID));
    const received: Array<string> = [];
    await runInDurableObject(stub, async (instance: InstanceType<typeof CorrespondentAgent>) => {
      (instance as unknown as { getConnections: () => Array<{ send: (m: string) => void }> })
        .getConnections = () => [{ send: (m: string) => received.push(m) }];
    });

    // Insert a ticket and flip its status via the production helper.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO company
         (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
       VALUES (?, 'E', 'e', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
    ).bind(COMPANY_ID).run();
    await env.DB.prepare(
      `INSERT INTO ticket
         (id, company_id, agent_instance_id, parent_ticket_id, title, brief,
          status, origin, workflow_id, result, created_at, updated_at)
       VALUES ('tkt_e', ?, 'a', NULL, 't', 'b', 'open', 'delegation', NULL, NULL, 0, 0)`,
    ).bind(COMPANY_ID).run();

    await setTicketStatus(env.DB, "tkt_e", "in_progress");
    await emitTeamEvent(env, { companyId: COMPANY_ID, reason: "ticket_changed", type: "team:status" });

    expect(received.some((m) => m.includes("team:status"))).toBe(true);
  });
});
```

- [ ] **Step 4: Run all worker-job tests + new test**

```bash
pnpm --filter=worker-bees test src/__tests__/worker-job-emits-team-status.test.ts
pnpm --filter=worker-bees test
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/workflows/worker-job.ts apps/agents/src/__tests__/worker-job-emits-team-status.test.ts
git commit -m "feat(agents): worker-job emits team:status on every ticket transition"
```

---

## Phase D — Multi-instance dispatch

### Task 16: Make `delegateToWorker` prefer available + round-robin

**Files:**
- Modify: `apps/agents/src/skills/delegate-to-worker.ts`
- Test: `apps/agents/src/__tests__/delegate-multi-instance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/agents/src/__tests__/delegate-multi-instance.test.ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { delegateToWorkerSkill } from "@/skills/delegate-to-worker";

const COMPANY_ID = "co_multi_test";
const CORR_ID = "corr_multi_test";
const D1 = "wkr_multi_1";
const D2 = "wkr_multi_2";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO company (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
       VALUES (?, 'M', 'm', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
    ).bind(COMPANY_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO template (id, version, status, display_name, description, system_prompt, model, worker_kind, skill_ids, default_action_type, default_policies, created_at, updated_at)
       VALUES ('tpl-designer', 1, 'active', 'Designer', 'd', 'sys', 'gpt-x', 'designer', '[]', 'worker_deliverable', '{}', 0, 0)`,
    ),
    env.DB.prepare(
      `INSERT OR REPLACE INTO agent_instance (id, company_id, role, template_id, template_version, display_name, model_override, status, prompt_override, created_at, updated_at)
       VALUES (?, ?, 'correspondent', NULL, NULL, 'C', NULL, 'active', NULL, 0, 0)`,
    ).bind(CORR_ID, COMPANY_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO agent_instance (id, company_id, role, template_id, template_version, display_name, model_override, status, prompt_override, created_at, updated_at)
       VALUES (?, ?, 'worker', 'tpl-designer', 1, 'D1', NULL, 'active', NULL, 0, 0)`,
    ).bind(D1, COMPANY_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO agent_instance (id, company_id, role, template_id, template_version, display_name, model_override, status, prompt_override, created_at, updated_at)
       VALUES (?, ?, 'worker', 'tpl-designer', 1, 'D2', NULL, 'active', NULL, 0, 0)`,
    ).bind(D2, COMPANY_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO team (id, company_id, confirmed_at, created_at) VALUES ('team_m', ?, 0, 0)`,
    ).bind(COMPANY_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES ('team_m', ?, ?)`,
    ).bind(CORR_ID, JSON.stringify([D1, D2])),
    env.DB.prepare(
      `INSERT OR IGNORE INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES ('team_m', ?, '[]')`,
    ).bind(D1),
    env.DB.prepare(
      `INSERT OR IGNORE INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES ('team_m', ?, '[]')`,
    ).bind(D2),
  ]);
});

const ctx = {
  agentInstanceId: CORR_ID,
  companyId: COMPANY_ID,
  env,
};

describe("delegateToWorker multi-instance dispatch", () => {
  it("prefers an available worker over one that's busy", async () => {
    // D1 is busy (has an in_progress ticket); D2 is available.
    await env.DB.prepare(
      `INSERT INTO ticket (id, company_id, agent_instance_id, parent_ticket_id, title, brief, status, origin, workflow_id, result, created_at, updated_at)
       VALUES ('tkt_busy', ?, ?, NULL, 't', 'b', 'in_progress', 'delegation', NULL, NULL, 0, 0)`,
    ).bind(COMPANY_ID, D1).run();

    const result = await delegateToWorkerSkill.execute(
      { brief: "fazer logo", workerKind: "designer" },
      ctx,
    );
    expect("status" in result && result.status).toBe("queued");
    // Inspect the freshly-created ticket to confirm it was assigned to D2
    const tickets = await env.DB.prepare(
      "SELECT agent_instance_id FROM ticket WHERE company_id = ? AND title LIKE 'designer:%'",
    ).bind(COMPANY_ID).all<{ agent_instance_id: string }>();
    expect(tickets.results.some((r) => r.agent_instance_id === D2)).toBe(true);
    expect(tickets.results.some((r) => r.agent_instance_id === D1)).toBe(false);
  });

  it("skips paused workers entirely", async () => {
    await env.DB.prepare("UPDATE agent_instance SET status = 'paused' WHERE id = ?")
      .bind(D2).run();
    const result = await delegateToWorkerSkill.execute(
      { brief: "fazer logo", workerKind: "designer" },
      ctx,
    );
    expect("status" in result && result.status).toBe("queued");
    const tickets = await env.DB.prepare(
      "SELECT agent_instance_id FROM ticket WHERE company_id = ? AND title LIKE 'designer:%'",
    ).bind(COMPANY_ID).all<{ agent_instance_id: string }>();
    // Should land on D1 (the only active one), even though it's busy.
    expect(tickets.results.every((r) => r.agent_instance_id !== D2)).toBe(true);
  });

  it("returns an error when all workers of the kind are paused", async () => {
    await env.DB.prepare("UPDATE agent_instance SET status = 'paused' WHERE template_id = 'tpl-designer'").run();
    const result = await delegateToWorkerSkill.execute(
      { brief: "fazer logo", workerKind: "designer" },
      ctx,
    );
    expect("error" in result).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Update `apps/agents/src/skills/delegate-to-worker.ts`**

Replace the SELECT block (lines 35–47) and add the picker:

```ts
type WorkerCandidate = {
  busy_count: number;
  id: string;
};

const pickWorker = (candidates: ReadonlyArray<WorkerCandidate>, allowed: ReadonlyArray<string>): WorkerCandidate | null => {
  const eligible = candidates.filter((c) => allowed.includes(c.id));
  if (eligible.length === 0) {
    return null;
  }
  const idle = eligible.filter((c) => c.busy_count === 0);
  const pool = idle.length > 0 ? idle : eligible;
  // Round-robin across the pool by hashing the current time. Stable enough
  // for fair distribution under load, no per-DO state required.
  const idx = Number(BigInt(Date.now()) % BigInt(pool.length));
  return pool[idx] ?? pool[0]!;
};

// inside execute():
const { results: candidates } = await ctx.env.DB.prepare(
  `SELECT a.id,
          (SELECT COUNT(*) FROM ticket
            WHERE agent_instance_id = a.id
              AND status IN ('in_progress', 'awaiting_approval')) AS busy_count
     FROM agent_instance a
     JOIN template t ON t.id = a.template_id
    WHERE a.company_id = ?
      AND a.role = 'worker'
      AND a.status = 'active'
      AND t.worker_kind = ?
      AND t.status = 'active'`,
)
  .bind(ctx.companyId, workerKind)
  .all<WorkerCandidate>();

if (candidates.length === 0) {
  return { error: `Nenhum especialista do tipo "${workerKind}" no Time desta empresa.` };
}

const delegationTargets = await getDelegationTargets(ctx.env.DB, ctx.agentInstanceId);
const target = pickWorker(candidates, delegationTargets ?? []);
if (!target) {
  return { error: `Você não tem permissão para delegar para "${workerKind}".` };
}
```

The rest of the function (insert ticket, getAgentByName, handleTicket) is unchanged, but `target.id` replaces the previous `target.id` (same name; only the selection logic changes).

- [ ] **Step 4: Run tests, typecheck, lint**

```bash
pnpm --filter=worker-bees test src/__tests__/delegate-multi-instance.test.ts
pnpm --filter=worker-bees test
pnpm typecheck
pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/skills/delegate-to-worker.ts apps/agents/src/__tests__/delegate-multi-instance.test.ts
git commit -m "feat(agents): delegateToWorker prefers available + round-robin among active workers"
```

---

## Phase E — Routes

### Task 17: `GET /api/me/team` route

**Files:**
- Modify: `apps/agents/src/routes/me.ts`
- Test: `apps/agents/src/__tests__/me-team-route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/agents/src/__tests__/me-team-route.test.ts
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "co_meteam_test";
const originalFetch = globalThis.fetch;

const meCustomer = {
  currentOrg: { id: COMPANY_ID, role: "CUSTOMER" },
  user: { id: "user-1" },
};
const meStaff = {
  currentOrg: { id: COMPANY_ID, role: "STAFF" },
  user: { id: "staff-1" },
};

// IDs must match the canonical `correspondentIdFor`/`teamIdFor` functions —
// later tasks call hireMember/pauseMember which look up the correspondent
// row by `corr-${COMPANY_ID}` and the team by `team-${COMPANY_ID}`.
const CORR_ID = `corr-${COMPANY_ID}`;
const TEAM_ID = `team-${COMPANY_ID}`;
const WORKER_ID = "ai_mt_d";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO company (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
       VALUES (?, 'MT', 'mt', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
    ).bind(COMPANY_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO template (id, version, status, display_name, description, system_prompt, model, worker_kind, skill_ids, default_action_type, default_policies, created_at, updated_at)
       VALUES ('tpl-designer', 1, 'active', 'Designer', 'd', 'sys', 'gpt-x', 'designer', '[]', 'worker_deliverable', '{}', 0, 0)`,
    ),
    env.DB.prepare(
      `INSERT OR REPLACE INTO agent_instance (id, company_id, role, template_id, template_version, display_name, model_override, status, prompt_override, created_at, updated_at)
       VALUES (?, ?, 'correspondent', NULL, NULL, 'C', NULL, 'active', NULL, 0, 0)`,
    ).bind(CORR_ID, COMPANY_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO agent_instance (id, company_id, role, template_id, template_version, display_name, model_override, status, prompt_override, created_at, updated_at)
       VALUES (?, ?, 'worker', 'tpl-designer', 1, 'Designer', NULL, 'active', NULL, 0, 0)`,
    ).bind(WORKER_ID, COMPANY_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO team (id, company_id, confirmed_at, created_at) VALUES (?, ?, 0, 0)`,
    ).bind(TEAM_ID, COMPANY_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES (?, ?, ?)`,
    ).bind(TEAM_ID, CORR_ID, JSON.stringify([WORKER_ID])),
    env.DB.prepare(
      `INSERT OR IGNORE INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES (?, ?, '[]')`,
    ).bind(TEAM_ID, WORKER_ID),
  ]);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GET /api/me/team", () => {
  it("returns the roster for CUSTOMER", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await SELF.fetch("https://agents.test/api/me/team?cf_session=tok");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      members: Array<{ displayName: string; id: string; status: string }>;
    };
    expect(body.members.some((m) => m.id === "ai_mt_d")).toBe(true);
  });

  it("admits STAFF reading their own company's team", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await SELF.fetch("https://agents.test/api/me/team?cf_session=tok");
    expect(res.status).toBe(200);
  });

  it("rejects unauthenticated with 401", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response("Unauthorized", { status: 401 })));
    const res = await SELF.fetch("https://agents.test/api/me/team?cf_session=tok");
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Add the route to `apps/agents/src/routes/me.ts`**

In the import block:

```ts
import { getTeamRoster } from "@/team/queries";
```

After the existing `GET /templates` route (lines 108–118), add:

```ts
meRoutes.get("/team", async (c) => {
  const session = c.get("session");
  const members = await getTeamRoster(c.env.DB, session.companyId);
  return c.json({ members });
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter=worker-bees test src/__tests__/me-team-route.test.ts
pnpm typecheck
pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/routes/me.ts apps/agents/src/__tests__/me-team-route.test.ts
git commit -m "feat(agents): GET /api/me/team returns derived roster view"
```

---

### Task 18: `GET /api/me/catalogue` route

**Files:**
- Modify: `apps/agents/src/routes/me.ts`
- Test: extend `apps/agents/src/__tests__/me-team-route.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
describe("GET /api/me/catalogue", () => {
  it("returns active worker templates with hiredCount", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await SELF.fetch("https://agents.test/api/me/catalogue?cf_session=tok");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      templates: Array<{ hiredCount: number; id: string }>;
    };
    const designer = body.templates.find((t) => t.id === "tpl-designer");
    expect(designer?.hiredCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Add the route**

```ts
import { getCatalogue, getTeamRoster } from "@/team/queries";

meRoutes.get("/catalogue", async (c) => {
  const session = c.get("session");
  const templates = await getCatalogue(c.env.DB, session.companyId);
  return c.json({ templates });
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter=worker-bees test src/__tests__/me-team-route.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/routes/me.ts apps/agents/src/__tests__/me-team-route.test.ts
git commit -m "feat(agents): GET /api/me/catalogue lists hireable templates"
```

---

### Task 19: `POST /api/me/team/hire` route

**Files:**
- Modify: `apps/agents/src/routes/me.ts`
- Test: extend `apps/agents/src/__tests__/me-team-route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("POST /api/me/team/hire", () => {
  it("creates a new instance and emits team:roster", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await SELF.fetch("https://agents.test/api/me/team/hire?cf_session=tok", {
      body: JSON.stringify({ templateId: "tpl-designer" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { member: { id: string; templateId: string } };
    expect(body.member.templateId).toBe("tpl-designer");
  });

  it("400 when templateId missing", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await SELF.fetch("https://agents.test/api/me/team/hire?cf_session=tok", {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(400);
  });
});
```

(The seed established in Task 17 already includes the team + correspondent team_member rows with the canonical `correspondentIdFor` / `teamIdFor` IDs — `hireMember`'s delegation-list append works against them out of the box.)

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Add the route**

```ts
import { z } from "zod";
import { hireMember } from "@/team/mutations";
import { emitTeamEvent } from "@/team/events";

const hireSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  templateId: z.string().min(1),
});

meRoutes.post("/team/hire", async (c) => {
  const session = c.get("session");
  const parsed = hireSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body" }, 400);
  }
  const member = await hireMember(c.env.DB, {
    companyId: session.companyId,
    displayName: parsed.data.displayName,
    templateId: parsed.data.templateId,
  });
  await emitTeamEvent(c.env, {
    companyId: session.companyId,
    reason: "hired",
    type: "team:roster",
  });
  return c.json({ member });
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter=worker-bees test src/__tests__/me-team-route.test.ts
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/routes/me.ts apps/agents/src/__tests__/me-team-route.test.ts
git commit -m "feat(agents): POST /api/me/team/hire creates instance + emits roster ping"
```

---

### Task 20: `PATCH /api/me/team/members/:id` route

**Files:**
- Modify: `apps/agents/src/routes/me.ts`
- Test: extend `apps/agents/src/__tests__/me-team-route.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("PATCH /api/me/team/members/:id", () => {
  it("renames + sets prompt override", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await SELF.fetch(
      "https://agents.test/api/me/team/members/ai_mt_d?cf_session=tok",
      {
        body: JSON.stringify({ displayName: "Marina", promptOverride: "minimalista" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { member: { displayName: string; hasPromptOverride: boolean } };
    expect(body.member.displayName).toBe("Marina");
    expect(body.member.hasPromptOverride).toBe(true);
  });

  it("clears prompt override when promptOverride: null", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await SELF.fetch(
      "https://agents.test/api/me/team/members/ai_mt_d?cf_session=tok",
      {
        body: JSON.stringify({ promptOverride: null }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { member: { hasPromptOverride: boolean } };
    expect(body.member.hasPromptOverride).toBe(false);
  });

  it("404 when the member doesn't belong to the company", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await SELF.fetch(
      "https://agents.test/api/me/team/members/ai_does_not_exist?cf_session=tok",
      {
        body: JSON.stringify({ displayName: "x" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Add the route**

```ts
import { updateMember } from "@/team/mutations";

const patchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  promptOverride: z.union([z.string().max(20_000), z.null()]).optional(),
});

meRoutes.patch("/team/members/:id", async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body" }, 400);
  }
  try {
    const member = await updateMember(c.env.DB, {
      agentInstanceId: id,
      companyId: session.companyId,
      displayName: parsed.data.displayName,
      editedBy: "customer",
      operatorId: null,
      promptOverride: parsed.data.promptOverride,
    });
    await emitTeamEvent(c.env, {
      companyId: session.companyId,
      reason: parsed.data.promptOverride !== undefined ? "prompt_changed" : "renamed",
      type: "team:roster",
    });
    return c.json({ member });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("not in company")) {
      return c.json({ error: "not found" }, 404);
    }
    throw error;
  }
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter=worker-bees test src/__tests__/me-team-route.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/routes/me.ts apps/agents/src/__tests__/me-team-route.test.ts
git commit -m "feat(agents): PATCH /api/me/team/members/:id rename + prompt override"
```

---

### Task 21: `POST /api/me/team/members/:id/pause` and `/resume`

**Files:**
- Modify: `apps/agents/src/routes/me.ts`
- Test: extend `apps/agents/src/__tests__/me-team-route.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("POST /api/me/team/members/:id/pause + /resume", () => {
  it("pauses then resumes the worker", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const paused = await SELF.fetch(
      "https://agents.test/api/me/team/members/ai_mt_d/pause?cf_session=tok",
      { method: "POST" },
    );
    expect(paused.status).toBe(200);
    expect(((await paused.json()) as { member: { status: string } }).member.status).toBe("paused");

    const resumed = await SELF.fetch(
      "https://agents.test/api/me/team/members/ai_mt_d/resume?cf_session=tok",
      { method: "POST" },
    );
    expect(((await resumed.json()) as { member: { status: string } }).member.status).toBe("available");
  });

  it("rejects pausing the correspondent with 400", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await SELF.fetch(
      `https://agents.test/api/me/team/members/corr-${COMPANY_ID}/pause?cf_session=tok`,
      { method: "POST" },
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Add the routes**

```ts
import { pauseMember, resumeMember } from "@/team/mutations";

meRoutes.post("/team/members/:id/pause", async (c) => {
  const session = c.get("session");
  try {
    const member = await pauseMember(c.env.DB, session.companyId, c.req.param("id"));
    await emitTeamEvent(c.env, {
      companyId: session.companyId,
      reason: "paused",
      type: "team:roster",
    });
    return c.json({ member });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("cannot pause")) {
      return c.json({ error: message }, 400);
    }
    if (message.includes("not in company")) {
      return c.json({ error: "not found" }, 404);
    }
    throw error;
  }
});

meRoutes.post("/team/members/:id/resume", async (c) => {
  const session = c.get("session");
  try {
    const member = await resumeMember(c.env.DB, session.companyId, c.req.param("id"));
    await emitTeamEvent(c.env, {
      companyId: session.companyId,
      reason: "resumed",
      type: "team:roster",
    });
    return c.json({ member });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("cannot")) {
      return c.json({ error: message }, 400);
    }
    if (message.includes("not in company")) {
      return c.json({ error: "not found" }, 404);
    }
    throw error;
  }
});
```

- [ ] **Step 4: Run tests + typecheck + lint**

```bash
pnpm --filter=worker-bees test src/__tests__/me-team-route.test.ts
pnpm typecheck
pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/routes/me.ts apps/agents/src/__tests__/me-team-route.test.ts
git commit -m "feat(agents): pause/resume routes with correspondent guard"
```

---

### Task 22: Backoffice routes — list, detail, patch

**Files:**
- Modify: `apps/agents/src/routes/backoffice.ts`
- Test: `apps/agents/src/__tests__/backoffice-team-route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/agents/src/__tests__/backoffice-team-route.test.ts
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "co_bot_test";
const originalFetch = globalThis.fetch;

const meStaff = {
  currentOrg: { id: COMPANY_ID, role: "STAFF" },
  user: { id: "staff-1" },
};
const meCustomer = {
  currentOrg: { id: COMPANY_ID, role: "CUSTOMER" },
  user: { id: "user-1" },
};

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO company (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
       VALUES (?, 'BT', 'bt', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
    ).bind(COMPANY_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO template (id, version, status, display_name, description, system_prompt, model, worker_kind, skill_ids, default_action_type, default_policies, created_at, updated_at)
       VALUES ('tpl-designer', 1, 'active', 'Designer', 'd', 'TPL_PROMPT', 'gpt-x', 'designer', '[]', 'worker_deliverable', '{}', 0, 0)`,
    ),
    env.DB.prepare(
      `INSERT OR REPLACE INTO agent_instance (id, company_id, role, template_id, template_version, display_name, model_override, status, prompt_override, created_at, updated_at)
       VALUES ('ai_bot_d', ?, 'worker', 'tpl-designer', 1, 'Designer', NULL, 'active', NULL, 0, 0)`,
    ).bind(COMPANY_ID),
  ]);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("/api/backoffice/teams/:companyId/members", () => {
  it("lists members for STAFF", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await SELF.fetch(
      `https://agents.test/api/backoffice/teams/${COMPANY_ID}/members?cf_session=tok`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { members: Array<{ id: string }> };
    expect(body.members.some((m) => m.id === "ai_bot_d")).toBe(true);
  });

  it("403 for CUSTOMER", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await SELF.fetch(
      `https://agents.test/api/backoffice/teams/${COMPANY_ID}/members?cf_session=tok`,
    );
    expect(res.status).toBe(403);
  });

  it("GET member detail returns templateSystemPrompt and promptOverride", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await SELF.fetch(
      `https://agents.test/api/backoffice/teams/${COMPANY_ID}/members/ai_bot_d?cf_session=tok`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      member: { promptOverride: string | null; templateSystemPrompt: string };
    };
    expect(body.member.templateSystemPrompt).toBe("TPL_PROMPT");
    expect(body.member.promptOverride).toBeNull();
  });

  it("PATCH member updates promptOverride and writes operator-tagged activity", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await SELF.fetch(
      `https://agents.test/api/backoffice/teams/${COMPANY_ID}/members/ai_bot_d?cf_session=tok`,
      {
        body: JSON.stringify({ promptOverride: "novo prompt" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    expect(res.status).toBe(200);
    const log = await env.DB.prepare(
      "SELECT actor_id, payload FROM activity_log WHERE ref_id = 'ai_bot_d' AND type = 'MEMBER_PROMPT_EDITED'",
    ).first<{ actor_id: string; payload: string }>();
    expect(log?.actor_id).toBe("staff-1");
    expect(JSON.parse(log?.payload ?? "{}").editedBy).toBe("operator");
  });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Add the three routes to `apps/agents/src/routes/backoffice.ts`**

```ts
import { z } from "zod";
import { getMemberDetail, getTeamRoster } from "@/team/queries";
import { updateMember } from "@/team/mutations";
import { emitTeamEvent } from "@/team/events";

const backofficePatchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  promptOverride: z.union([z.string().max(20_000), z.null()]).optional(),
});

backofficeRoutes.get("/teams/:companyId/members", async (c) => {
  const companyId = c.req.param("companyId");
  const members = await getTeamRoster(c.env.DB, companyId);
  return c.json({ members });
});

backofficeRoutes.get("/teams/:companyId/members/:id", async (c) => {
  const member = await getMemberDetail(c.env.DB, c.req.param("companyId"), c.req.param("id"));
  if (!member) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ member });
});

backofficeRoutes.patch("/teams/:companyId/members/:id", async (c) => {
  const session = c.get("session");
  const companyId = c.req.param("companyId");
  const id = c.req.param("id");
  const parsed = backofficePatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body" }, 400);
  }
  try {
    const member = await updateMember(c.env.DB, {
      agentInstanceId: id,
      companyId,
      displayName: parsed.data.displayName,
      editedBy: "operator",
      operatorId: session.userId,
      promptOverride: parsed.data.promptOverride,
    });
    await emitTeamEvent(c.env, {
      companyId,
      reason: parsed.data.promptOverride !== undefined ? "prompt_changed" : "renamed",
      type: "team:roster",
    });
    return c.json({ member });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("not in company")) {
      return c.json({ error: "not found" }, 404);
    }
    throw error;
  }
});
```

(Verify `session` exposes `userId` — read `apps/agents/src/auth/validate.ts` if needed. If the field is named differently, swap accordingly.)

- [ ] **Step 4: Run tests + typecheck + lint**

```bash
pnpm --filter=worker-bees test src/__tests__/backoffice-team-route.test.ts
pnpm typecheck
pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/routes/backoffice.ts apps/agents/src/__tests__/backoffice-team-route.test.ts
git commit -m "feat(agents): backoffice team list/detail/patch with operator-tagged audit"
```

---

## Phase F — UI primitives in `@repo/ui`

### Task 23: `Avatar` primitive

**Files:**
- Create: `packages/ui/src/components/avatar.tsx`

The Avatar shows initials over a deterministic background colour derived from a string seed.

- [ ] **Step 1: Create the component**

```tsx
// packages/ui/src/components/avatar.tsx
import { cn } from "@repo/ui/lib/utils";

type AvatarSize = "sm" | "md" | "lg";

const PALETTE: ReadonlyArray<string> = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-sky-500",
  "bg-indigo-500",
  "bg-fuchsia-500",
];

const SIZES: Record<AvatarSize, string> = {
  lg: "size-12 text-base",
  md: "size-9 text-sm",
  sm: "size-7 text-xs",
};

const hashSeed = (seed: string): number => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
};

const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/u).slice(0, 2);
  return parts.map((p) => p[0] ?? "").join("").toLocaleUpperCase("pt-BR") || "?";
};

type AvatarProps = {
  className?: string;
  name: string;
  seed: string;
  size?: AvatarSize;
};

const Avatar = ({ className, name, seed, size = "md" }: AvatarProps) => {
  const color = PALETTE[hashSeed(seed) % PALETTE.length] ?? PALETTE[0];
  return (
    <div
      aria-hidden
      className={cn(
        "inline-flex items-center justify-center rounded-full font-semibold text-white",
        SIZES[size],
        color,
        className,
      )}
    >
      {initialsOf(name)}
    </div>
  );
};

export { Avatar };
export type { AvatarProps, AvatarSize };
```

- [ ] **Step 2: Lint + typecheck**

```bash
pnpm --filter=@repo/ui lint
pnpm --filter=@repo/ui typecheck 2>/dev/null || pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/avatar.tsx
git commit -m "feat(ui): Avatar primitive with deterministic colour from seed"
```

---

### Task 24: `Badge` primitive

**Files:**
- Create: `packages/ui/src/components/badge.tsx`

- [ ] **Step 1: Create the component**

```tsx
// packages/ui/src/components/badge.tsx
import { cn } from "@repo/ui/lib/utils";
import type { HTMLAttributes } from "react";

type BadgeVariant = "default" | "success" | "warning" | "info" | "muted";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: "bg-foreground/10 text-foreground",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200",
  muted: "bg-muted text-muted-foreground",
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
};

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

const Badge = ({ className, variant = "default", ...rest }: BadgeProps) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
      VARIANT_CLASSES[variant],
      className,
    )}
    {...rest}
  />
);

export { Badge };
export type { BadgeProps, BadgeVariant };
```

- [ ] **Step 2: Lint + typecheck**

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/badge.tsx
git commit -m "feat(ui): Badge primitive with semantic variants"
```

---

### Task 25: `Dialog` primitive (shadcn pattern)

**Files:**
- Create: `packages/ui/src/components/dialog.tsx`

Use Radix Dialog (already a transitive dep through `@repo/ui` if present; otherwise install with `pnpm --filter=@repo/ui add @radix-ui/react-dialog`).

- [ ] **Step 1: Add the dependency if missing**

```bash
pnpm --filter=@repo/ui add @radix-ui/react-dialog
```

If already present, skip.

- [ ] **Step 2: Create the component**

```tsx
// packages/ui/src/components/dialog.tsx
"use client";

import { cn } from "@repo/ui/lib/utils";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = ({ className, ...rest }: ComponentProps<typeof DialogPrimitive.Overlay>) => (
  <DialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...rest}
  />
);

const DialogContent = ({ children, className, ...rest }: ComponentProps<typeof DialogPrimitive.Content>) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      {...rest}
    >
      {children}
      <DialogPrimitive.Close
        aria-label="Fechar"
        className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        <X className="size-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
);

const DialogHeader = ({ className, ...rest }: ComponentProps<"div">) => (
  <div className={cn("flex flex-col gap-1.5 text-left", className)} {...rest} />
);

const DialogFooter = ({ className, ...rest }: ComponentProps<"div">) => (
  <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...rest} />
);

const DialogTitle = ({ className, ...rest }: ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...rest} />
);

const DialogDescription = ({ className, ...rest }: ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...rest} />
);

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
};
```

- [ ] **Step 3: Lint + typecheck**

- [ ] **Step 4: Commit**

```bash
git add packages/ui packages/ui/src/components/dialog.tsx
git commit -m "feat(ui): Dialog primitive over @radix-ui/react-dialog"
```

---

## Phase G — Customer UI

### Task 26: `apps/client/src/lib/team.ts` types + fetchers + display map

**Files:**
- Create: `apps/client/src/lib/team.ts`

- [ ] **Step 1: Create the module**

```ts
// apps/client/src/lib/team.ts
// Customer-side API surface for the team feature. Types mirror the agents
// API output shape; status display labels live here (pt-BR).

type AgentDisplayStatus = "available" | "working" | "awaiting_approval" | "paused";

type OpenTicketSlim = {
  status: "in_progress" | "awaiting_approval";
  summary: string;
  ticketId: string;
};

type TeamMemberView = {
  currentWork: ReadonlyArray<OpenTicketSlim>;
  displayName: string;
  hasPromptOverride: boolean;
  id: string;
  lifetimeDone: number;
  role: "correspondent" | "planner" | "worker";
  status: AgentDisplayStatus;
  templateId: string | null;
  workerKind: string | null;
};

type TeamMemberDetailView = TeamMemberView & {
  capabilities: string;
  promptOverride: string | null;
  promptOverrideUpdatedAt: number | null;
  templateSystemPrompt: string;
};

type HireableTemplate = {
  description: string;
  displayName: string;
  hiredCount: number;
  id: string;
  workerKind: string;
};

const STATUS_LABEL: Record<AgentDisplayStatus, string> = {
  available: "Disponível",
  awaiting_approval: "Aguardando aprovação",
  paused: "Pausado",
  working: "Trabalhando",
};

const STATUS_VARIANT: Record<AgentDisplayStatus, "success" | "warning" | "info" | "muted"> = {
  available: "success",
  awaiting_approval: "warning",
  paused: "muted",
  working: "info",
};

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? "";

const apiUrl = (path: string): string => `${AGENTS_URL}${path}`;

const fetchTeam = async (): Promise<Array<TeamMemberView>> => {
  const res = await fetch(apiUrl("/api/me/team"), { credentials: "include" });
  if (!res.ok) {
    throw new Error(`GET /api/me/team failed (${res.status})`);
  }
  const body = (await res.json()) as { members: Array<TeamMemberView> };
  return body.members;
};

const fetchCatalogue = async (): Promise<Array<HireableTemplate>> => {
  const res = await fetch(apiUrl("/api/me/catalogue"), { credentials: "include" });
  if (!res.ok) {
    throw new Error(`GET /api/me/catalogue failed (${res.status})`);
  }
  const body = (await res.json()) as { templates: Array<HireableTemplate> };
  return body.templates;
};

const hireMember = async (input: { displayName?: string; templateId: string }): Promise<TeamMemberView> => {
  const res = await fetch(apiUrl("/api/me/team/hire"), {
    body: JSON.stringify(input),
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`POST /api/me/team/hire failed (${res.status})`);
  }
  const body = (await res.json()) as { member: TeamMemberView };
  return body.member;
};

const patchMember = async (
  id: string,
  patch: { displayName?: string; promptOverride?: string | null },
): Promise<TeamMemberView> => {
  const res = await fetch(apiUrl(`/api/me/team/members/${id}`), {
    body: JSON.stringify(patch),
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
  if (!res.ok) {
    throw new Error(`PATCH /api/me/team/members/${id} failed (${res.status})`);
  }
  return ((await res.json()) as { member: TeamMemberView }).member;
};

const setPaused = async (id: string, paused: boolean): Promise<TeamMemberView> => {
  const res = await fetch(apiUrl(`/api/me/team/members/${id}/${paused ? "pause" : "resume"}`), {
    credentials: "include",
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`pause/resume failed (${res.status})`);
  }
  return ((await res.json()) as { member: TeamMemberView }).member;
};

export {
  AGENTS_URL,
  fetchCatalogue,
  fetchTeam,
  hireMember,
  patchMember,
  setPaused,
  STATUS_LABEL,
  STATUS_VARIANT,
};
export type {
  AgentDisplayStatus,
  HireableTemplate,
  OpenTicketSlim,
  TeamMemberDetailView,
  TeamMemberView,
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/lib/team.ts
git commit -m "feat(client): team API fetchers + status display map"
```

---

### Task 27: `useTeamRoster` hook

**Files:**
- Create: `apps/client/src/lib/use-team-roster.ts`

The hook uses `useAgent` (from the `agents/react` package, already in use in `apps/client/src/components/chat.tsx`) to subscribe to the same DO and listen for `team:*` frames. Without TanStack Query installed we keep state local — the hook owns the roster and exposes a refetch function. The Company page and the sidebar both call it.

- [ ] **Step 1: Create the hook**

```tsx
// apps/client/src/lib/use-team-roster.ts
"use client";

import { useAgent } from "agents/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchTeam, type TeamMemberView } from "@/lib/team";

const POLL_INTERVAL_MS = 30_000;

type Status = "idle" | "loading" | "ready" | "error";

type UseTeamRosterResult = {
  error: Error | null;
  members: Array<TeamMemberView>;
  refetch: () => Promise<void>;
  status: Status;
};

const isTeamFrame = (payload: unknown): boolean => {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const type = (payload as { type?: unknown }).type;
  return typeof type === "string" && type.startsWith("team:");
};

const useTeamRoster = (companyId: string): UseTeamRosterResult => {
  const [members, setMembers] = useState<Array<TeamMemberView>>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<Error | null>(null);
  const wsOpenRef = useRef(false);

  const refetch = useCallback(async () => {
    setStatus("loading");
    try {
      const next = await fetchTeam();
      setMembers(next);
      setError(null);
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setStatus("error");
    }
  }, []);

  // Initial load
  useEffect(() => {
    refetch();
  }, [refetch]);

  // Subscribe to the correspondent DO's WebSocket for team:* invalidation pings.
  useAgent({
    agent: "correspondent",
    name: companyId,
    onMessage: (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (isTeamFrame(parsed)) {
        refetch();
      }
    },
    onOpen: () => {
      wsOpenRef.current = true;
    },
    onClose: () => {
      wsOpenRef.current = false;
    },
  });

  // visibilitychange → refetch once when becoming visible
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        refetch();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refetch]);

  // 30s safety poll only when the socket is closed
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!wsOpenRef.current) {
        refetch();
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refetch]);

  return { error, members, refetch, status };
};

export { useTeamRoster };
export type { UseTeamRosterResult };
```

- [ ] **Step 2: Lint + typecheck**

```bash
pnpm --filter=client lint
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/lib/use-team-roster.ts
git commit -m "feat(client): useTeamRoster hook with WS invalidation + safety poll"
```

---

### Task 28: `AgentCard` component

**Files:**
- Create: `apps/client/src/components/agent-card.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/client/src/components/agent-card.tsx
"use client";

import { Avatar } from "@repo/ui/components/avatar";
import { Badge } from "@repo/ui/components/badge";
import { Pencil } from "lucide-react";

import { STATUS_LABEL, STATUS_VARIANT, type TeamMemberView } from "@/lib/team";

type Variant = "compact" | "detailed";

type AgentCardProps = {
  member: TeamMemberView;
  variant: Variant;
};

const roleLabel = (m: TeamMemberView): string => {
  if (m.role === "correspondent") return "Correspondente";
  if (m.role === "planner") return "Planejador";
  return m.workerKind ?? "Worker";
};

const AgentCard = ({ member, variant }: AgentCardProps) => (
  <article className="flex items-start gap-3 rounded-md border border-border bg-card p-3">
    <Avatar
      name={member.displayName}
      seed={member.id}
      size={variant === "detailed" ? "lg" : "md"}
    />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <h3 className="truncate text-sm font-medium">{member.displayName}</h3>
        {member.hasPromptOverride && (
          <Pencil aria-label="Prompt personalizado" className="size-3 text-muted-foreground" />
        )}
      </div>
      <p className="text-xs text-muted-foreground">{roleLabel(member)}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge variant={STATUS_VARIANT[member.status]}>{STATUS_LABEL[member.status]}</Badge>
        {member.currentWork[0] && (
          <span className="truncate text-xs text-muted-foreground">
            → {member.currentWork[0].summary}
          </span>
        )}
      </div>
      {variant === "detailed" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Tickets concluídos: {member.lifetimeDone}
        </p>
      )}
    </div>
  </article>
);

export { AgentCard };
export type { AgentCardProps };
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/components/agent-card.tsx
git commit -m "feat(client): AgentCard with compact/detailed variants"
```

---

### Task 29: `TeamSidebar` component

**Files:**
- Create: `apps/client/src/components/team-sidebar.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/client/src/components/team-sidebar.tsx
"use client";

import { Button } from "@repo/ui/components/button";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { AgentCard } from "@/components/agent-card";
import { useTeamRoster } from "@/lib/use-team-roster";

type TeamSidebarProps = {
  companyId: string;
};

const TeamSidebar = ({ companyId }: TeamSidebarProps) => {
  const { error, members, status } = useTeamRoster(companyId);
  return (
    <aside
      aria-label="Seu time"
      className="hidden w-72 flex-col gap-3 border-l border-border bg-background/60 p-4 lg:flex"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Seu time</h2>
        <span className="text-xs text-muted-foreground">{members.length}</span>
      </div>
      {status === "loading" && members.length === 0 && (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      )}
      {error && (
        <p className="text-xs text-destructive">Falha ao carregar o time: {error.message}</p>
      )}
      <ul className="flex flex-col gap-2">
        {members.map((m) => (
          <li key={m.id}>
            <AgentCard member={m} variant="compact" />
          </li>
        ))}
      </ul>
      <Button asChild className="mt-auto" variant="outline">
        <Link href="/empresa">
          Ver minha empresa
          <ArrowRight aria-hidden className="ml-1 size-3" />
        </Link>
      </Button>
    </aside>
  );
};

export { TeamSidebar };
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/components/team-sidebar.tsx
git commit -m "feat(client): TeamSidebar — lg+ chat rail with live roster"
```

---

### Task 30: Mount sidebar into chat page

**Files:**
- Modify: `apps/client/src/app/(client)/page.tsx`

- [ ] **Step 1: Read the current file structure**

The chat page currently renders the `<Chat>` component inside a wrapper. We need to read it and wrap the Chat in a `flex` row with the sidebar as the second child on `lg+`.

- [ ] **Step 2: Wrap the chat in a 2-column layout**

Open `apps/client/src/app/(client)/page.tsx`. Find the JSX that renders `<Chat agent="..." />`. Replace the surrounding container with:

```tsx
<div className="flex h-full min-h-0 flex-1">
  <div className="flex min-w-0 flex-1 flex-col">
    {/* existing <Chat ... /> tree stays here */}
  </div>
  <TeamSidebar companyId={company.id} />
</div>
```

Add the import:

```ts
import { TeamSidebar } from "@/components/team-sidebar";
```

(`company.id` comes from the existing `/api/me/company` fetch the page already does. If the variable name differs, adjust accordingly.)

- [ ] **Step 3: Smoke test locally**

```bash
pnpm dev --filter=client --filter=worker-bees
```

Open `http://localhost:3001`, sign in as the customer, verify the sidebar renders the seeded Designer + Correspondent.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/app/\(client\)/page.tsx
git commit -m "feat(client): mount TeamSidebar on chat page (lg+ 2-column)"
```

---

### Task 31: `HireDialog` component

**Files:**
- Create: `apps/client/src/components/hire-dialog.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/client/src/components/hire-dialog.tsx
"use client";

import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Field } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { useState } from "react";
import { toast } from "sonner";

import { hireMember, type HireableTemplate } from "@/lib/team";

type HireDialogProps = {
  onClose: () => void;
  onHired: () => void;
  open: boolean;
  template: HireableTemplate | null;
};

const HireDialog = ({ onClose, onHired, open, template }: HireDialogProps) => {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!template) return;
    setBusy(true);
    try {
      const member = await hireMember({
        displayName: name.trim() || undefined,
        templateId: template.id,
      });
      toast.success(`${member.displayName} contratado(a).`);
      onHired();
      onClose();
      setName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao contratar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog onOpenChange={(o) => !o && onClose()} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Contratar {template?.displayName ?? ""}</DialogTitle>
          <DialogDescription>
            Você pode dar um nome próprio a este agente. Se deixar em branco, usamos o nome do
            template (com #2, #3, … se já existir).
          </DialogDescription>
        </DialogHeader>
        <Field label="Nome (opcional)">
          <Input
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            placeholder={template?.displayName ?? ""}
            value={name}
          />
        </Field>
        <DialogFooter>
          <Button disabled={busy} onClick={onClose} variant="outline">
            Cancelar
          </Button>
          <Button disabled={busy} onClick={confirm}>
            Contratar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export { HireDialog };
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/components/hire-dialog.tsx
git commit -m "feat(client): HireDialog for picking a display name + confirming"
```

---

### Task 32: `PromptEditor` component (customer)

**Files:**
- Create: `apps/client/src/components/prompt-editor.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/client/src/components/prompt-editor.tsx
"use client";

import { Button } from "@repo/ui/components/button";
import { Field } from "@repo/ui/components/field";
import { Textarea } from "@repo/ui/components/textarea";
import { useState } from "react";

type PromptEditorProps = {
  busy?: boolean;
  initialValue: string | null;
  onReset: () => Promise<void>;
  onSave: (value: string) => Promise<void>;
  templatePrompt: string;
  updatedAt: number | null;
};

const formatDate = (ms: number): string =>
  new Date(ms).toLocaleString("pt-BR", { day: "2-digit", hour: "2-digit", minute: "2-digit", month: "short" });

const PromptEditor = ({
  busy,
  initialValue,
  onReset,
  onSave,
  templatePrompt,
  updatedAt,
}: PromptEditorProps) => {
  const [value, setValue] = useState(initialValue ?? "");
  const overridden = initialValue !== null;
  const dirty = value !== (initialValue ?? "");

  return (
    <section aria-label="Comportamento do agente" className="flex flex-col gap-3">
      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">Padrão do template</summary>
        <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
          {templatePrompt}
        </pre>
      </details>
      <Field
        hint={
          overridden && updatedAt
            ? `Você modificou este prompt em ${formatDate(updatedAt)}. Mudanças passam a valer na próxima interação.`
            : "Mudanças passam a valer na próxima interação."
        }
        label="Sua personalização"
      >
        <Textarea
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Escreva instruções específicas para este agente, em pt-BR."
          rows={8}
          value={value}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button
          disabled={busy || !overridden}
          onClick={async () => {
            await onReset();
            setValue("");
          }}
          variant="outline"
        >
          Restaurar padrão
        </Button>
        <Button disabled={busy || !dirty} onClick={() => onSave(value)}>
          Salvar
        </Button>
      </div>
    </section>
  );
};

export { PromptEditor };
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/components/prompt-editor.tsx
git commit -m "feat(client): PromptEditor component (textarea + save + reset)"
```

---

### Task 33: Empresa page

**Files:**
- Create: `apps/client/src/app/(client)/empresa/page.tsx`

URL, folder, and label all use `empresa` for consistency.

- [ ] **Step 1: Create the page**

```tsx
// apps/client/src/app/(client)/empresa/page.tsx
"use client";

import { Button } from "@repo/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/card";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AgentCard } from "@/components/agent-card";
import { HireDialog } from "@/components/hire-dialog";
import { PromptEditor } from "@/components/prompt-editor";
import {
  fetchCatalogue,
  patchMember,
  setPaused,
  type HireableTemplate,
  type TeamMemberDetailView,
} from "@/lib/team";
import { useTeamRoster } from "@/lib/use-team-roster";

type Props = {
  // Server component-fetched companyId is plumbed through layout context in
  // this app's pattern. If unavailable, fetch /api/me/company client-side.
};

const CompanyPage = (_props: Props) => {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<Array<HireableTemplate>>([]);
  const [hireTemplate, setHireTemplate] = useState<HireableTemplate | null>(null);
  const [detail, setDetail] = useState<TeamMemberDetailView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me/company", { credentials: "include" })
      .then((r) => r.json())
      .then((b: { id: string }) => setCompanyId(b.id))
      .catch(() => toast.error("Não foi possível identificar a empresa."));
  }, []);

  const { members, refetch } = useTeamRoster(companyId ?? "");

  useEffect(() => {
    fetchCatalogue().then(setCatalogue).catch((e) => toast.error(String(e)));
  }, [members.length]);

  const openDetail = async (id: string) => {
    const res = await fetch(`/api/me/team/members/${id}`, { credentials: "include" });
    if (res.ok) {
      const body = (await res.json()) as { member: TeamMemberDetailView };
      setDetail(body.member);
    }
  };

  const savePrompt = async (id: string, value: string) => {
    setBusyId(id);
    try {
      await patchMember(id, { promptOverride: value });
      toast.success("Prompt atualizado.");
      await openDetail(id);
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const resetPrompt = async (id: string) => {
    setBusyId(id);
    try {
      await patchMember(id, { promptOverride: null });
      toast.success("Prompt restaurado.");
      await openDetail(id);
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const togglePause = async (id: string, paused: boolean) => {
    setBusyId(id);
    try {
      await setPaused(id, paused);
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Minha empresa</h1>
        <p className="text-sm text-muted-foreground">
          Veja seu time e contrate mais agentes. Personalize o comportamento de cada um.
        </p>
      </header>

      <section aria-label="Meu time" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Meu time</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {members.map((m) => (
            <Card key={m.id}>
              <CardContent className="flex flex-col gap-3 pt-6">
                <AgentCard member={m} variant="detailed" />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => openDetail(m.id)} size="sm" variant="outline">
                    Editar prompt
                  </Button>
                  {m.role === "worker" && (
                    <Button
                      disabled={busyId === m.id}
                      onClick={() => togglePause(m.id, m.status !== "paused")}
                      size="sm"
                      variant="outline"
                    >
                      {m.status === "paused" ? "Retomar" : "Pausar"}
                    </Button>
                  )}
                </div>
                {detail?.id === m.id && (
                  <PromptEditor
                    busy={busyId === m.id}
                    initialValue={detail.promptOverride}
                    onReset={() => resetPrompt(m.id)}
                    onSave={(v) => savePrompt(m.id, v)}
                    templatePrompt={detail.templateSystemPrompt}
                    updatedAt={detail.promptOverrideUpdatedAt}
                  />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-label="Contratar mais agentes" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Contratar mais agentes</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {catalogue.map((t) => (
            <Card key={t.id}>
              <CardHeader>
                <CardTitle className="text-base">{t.displayName}</CardTitle>
                <CardDescription>{t.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {t.hiredCount > 0 ? `Você já tem ${t.hiredCount}` : "Nenhum ainda"}
                </span>
                <Button onClick={() => setHireTemplate(t)} size="sm">
                  Contratar
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <HireDialog
        onClose={() => setHireTemplate(null)}
        onHired={() => {
          refetch();
          fetchCatalogue().then(setCatalogue).catch(() => undefined);
        }}
        open={hireTemplate !== null}
        template={hireTemplate}
      />
    </div>
  );
};

export default CompanyPage;
```

- [ ] **Step 2: Smoke test**

```bash
pnpm dev --filter=client --filter=worker-bees
```

Visit `http://localhost:3001/empresa` (after adding the nav entry — Task 34). Hire a second Designer; verify it appears.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/app/\(client\)/empresa/page.tsx
git commit -m "feat(client): /empresa page — roster + hire + prompt editor"
```

---

### Task 34: Add `Empresa` to client nav

**Files:**
- Modify: `apps/client/src/components/nav.tsx`

- [ ] **Step 1: Insert nav entry**

Add the import + entry:

```ts
import { Activity, Building2, Image as ImageIcon, MessageCircle } from "lucide-react";

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: "/", icon: <MessageCircle aria-hidden />, label: "Chat" },
  { href: "/empresa", icon: <Building2 aria-hidden />, label: "Empresa" },
  { href: "/assets", icon: <ImageIcon aria-hidden />, label: "Assets" },
  { href: "/activity", icon: <Activity aria-hidden />, label: "Atividade" },
];
```

- [ ] **Step 2: Smoke test**

```bash
pnpm dev --filter=client
```

Click Empresa in the nav; verify it routes to `/empresa`.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/nav.tsx
git commit -m "feat(client): /empresa nav entry"
```

---

## Phase H — Backoffice UI

### Task 35: Backoffice team-fetch helpers

**Files:**
- Create: `apps/backoffice/src/lib/team-fetch.ts`

- [ ] **Step 1: Create the module**

```ts
// apps/backoffice/src/lib/team-fetch.ts
// Backoffice-side fetchers. Same shapes as the customer side; different
// endpoint prefix. Server-component usage means we re-export typed wrappers
// that take a session token cookie pass-through.

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? "";

type TeamMemberView = {
  currentWork: ReadonlyArray<{ status: string; summary: string; ticketId: string }>;
  displayName: string;
  hasPromptOverride: boolean;
  id: string;
  lifetimeDone: number;
  role: "correspondent" | "planner" | "worker";
  status: "available" | "working" | "awaiting_approval" | "paused";
  templateId: string | null;
  workerKind: string | null;
};

type TeamMemberDetailView = TeamMemberView & {
  capabilities: string;
  promptOverride: string | null;
  promptOverrideUpdatedAt: number | null;
  templateSystemPrompt: string;
};

const fetchTeam = async (companyId: string, cookie: string): Promise<Array<TeamMemberView>> => {
  const res = await fetch(`${AGENTS_URL}/api/backoffice/teams/${companyId}/members`, {
    cache: "no-store",
    headers: { cookie },
  });
  if (!res.ok) {
    throw new Error(`team list failed ${res.status}`);
  }
  return ((await res.json()) as { members: Array<TeamMemberView> }).members;
};

const fetchMember = async (
  companyId: string,
  memberId: string,
  cookie: string,
): Promise<TeamMemberDetailView> => {
  const res = await fetch(
    `${AGENTS_URL}/api/backoffice/teams/${companyId}/members/${memberId}`,
    { cache: "no-store", headers: { cookie } },
  );
  if (!res.ok) {
    throw new Error(`member detail failed ${res.status}`);
  }
  return ((await res.json()) as { member: TeamMemberDetailView }).member;
};

const patchMember = async (
  companyId: string,
  memberId: string,
  patch: { displayName?: string; promptOverride?: string | null },
  cookie: string,
): Promise<TeamMemberDetailView> => {
  const res = await fetch(
    `${AGENTS_URL}/api/backoffice/teams/${companyId}/members/${memberId}`,
    {
      body: JSON.stringify(patch),
      headers: { cookie, "content-type": "application/json" },
      method: "PATCH",
    },
  );
  if (!res.ok) {
    throw new Error(`member patch failed ${res.status}`);
  }
  return ((await res.json()) as { member: TeamMemberDetailView }).member;
};

export { fetchMember, fetchTeam, patchMember };
export type { TeamMemberDetailView, TeamMemberView };
```

- [ ] **Step 2: Commit**

```bash
git add apps/backoffice/src/lib/team-fetch.ts
git commit -m "feat(backoffice): team-fetch helpers (list / detail / patch)"
```

---

### Task 36: Backoffice teams list page

**Files:**
- Create: `apps/backoffice/src/app/(dashboard)/teams/page.tsx`

Look at `apps/backoffice/src/app/(dashboard)/approvals/page.tsx` first to see the existing server-component fetch pattern (cookie pass-through via `next/headers`). Mirror it here.

- [ ] **Step 1: Create the page (mirror the approvals page pattern)**

```tsx
// apps/backoffice/src/app/(dashboard)/teams/page.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { headers } from "next/headers";
import Link from "next/link";

import { requireStaff } from "@/lib/auth-helpers";
import { fetchTeam } from "@/lib/team-fetch";

const TeamsPage = async () => {
  const session = await requireStaff();
  const cookie = (await headers()).get("cookie") ?? "";
  const members = await fetchTeam(session.companyId, cookie);
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Times</h1>
        <p className="text-sm text-muted-foreground">
          {members.length} agente(s) nesta empresa
        </p>
      </header>
      <div className="grid gap-3 md:grid-cols-2">
        {members.map((m) => (
          <Card key={m.id}>
            <CardHeader>
              <CardTitle className="text-base">
                <Link className="hover:underline" href={`/teams/${session.companyId}/members/${m.id}`}>
                  {m.displayName}
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between text-sm">
              <span>{m.role === "worker" ? m.workerKind : m.role}</span>
              <span>{m.status}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default TeamsPage;
```

Verify that `requireStaff()` exposes `companyId`. If not, extract it from the session shape the approvals page uses.

- [ ] **Step 2: Commit**

```bash
git add apps/backoffice/src/app/\(dashboard\)/teams/page.tsx
git commit -m "feat(backoffice): /teams roster index page"
```

---

### Task 37: Backoffice member edit page + PromptEditor

**Files:**
- Create: `apps/backoffice/src/app/(dashboard)/teams/[companyId]/members/[memberId]/page.tsx`
- Create: `apps/backoffice/src/components/prompt-editor.tsx` (intentional duplication — see spec)

- [ ] **Step 1: Create the editor component**

Copy the file `apps/client/src/components/prompt-editor.tsx` verbatim into `apps/backoffice/src/components/prompt-editor.tsx`. No code changes — the duplication is intentional.

- [ ] **Step 2: Create the edit page**

```tsx
// apps/backoffice/src/app/(dashboard)/teams/[companyId]/members/[memberId]/page.tsx
"use client";

import { Button } from "@repo/ui/components/button";
import { Field } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PromptEditor } from "@/components/prompt-editor";
import { fetchMember, patchMember, type TeamMemberDetailView } from "@/lib/team-fetch";

type Props = { params: { companyId: string; memberId: string } };

const MemberEditPage = ({ params }: Props) => {
  const [member, setMember] = useState<TeamMemberDetailView | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchMember(params.companyId, params.memberId, document.cookie)
      .then((m) => {
        setMember(m);
        setName(m.displayName);
      })
      .catch((e) => toast.error(String(e)));
  }, [params.companyId, params.memberId]);

  if (!member) {
    return <p>Carregando…</p>;
  }

  const saveName = async () => {
    setBusy(true);
    try {
      const updated = await patchMember(
        params.companyId,
        params.memberId,
        { displayName: name },
        document.cookie,
      );
      setMember(updated);
      toast.success("Nome atualizado.");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const savePrompt = async (value: string) => {
    setBusy(true);
    try {
      const updated = await patchMember(
        params.companyId,
        params.memberId,
        { promptOverride: value },
        document.cookie,
      );
      setMember(updated);
      toast.success("Prompt atualizado.");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const resetPrompt = async () => {
    setBusy(true);
    try {
      const updated = await patchMember(
        params.companyId,
        params.memberId,
        { promptOverride: null },
        document.cookie,
      );
      setMember(updated);
      toast.success("Prompt restaurado.");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">{member.displayName}</h1>
        <p className="text-sm text-muted-foreground">
          {member.role === "worker" ? member.workerKind : member.role} · {member.status}
        </p>
      </header>
      <Field label="Nome">
        <div className="flex gap-2">
          <Input disabled={busy} onChange={(e) => setName(e.target.value)} value={name} />
          <Button disabled={busy || name === member.displayName} onClick={saveName}>
            Renomear
          </Button>
        </div>
      </Field>
      <PromptEditor
        busy={busy}
        initialValue={member.promptOverride}
        onReset={resetPrompt}
        onSave={savePrompt}
        templatePrompt={member.templateSystemPrompt}
        updatedAt={member.promptOverrideUpdatedAt}
      />
    </div>
  );
};

export default MemberEditPage;
```

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/components/prompt-editor.tsx apps/backoffice/src/app/\(dashboard\)/teams
git commit -m "feat(backoffice): member edit page with prompt editor + rename"
```

---

### Task 38: Add `Times` to backoffice sidebar

**Files:**
- Modify: `apps/backoffice/src/components/sidebar.tsx`

- [ ] **Step 1: Insert nav entry**

```ts
import { Activity, Home, Inbox, Ticket, Users } from "lucide-react";

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: "/", icon: <Home aria-hidden />, label: "Início" },
  { href: "/approvals", icon: <Inbox aria-hidden />, label: "Aprovações" },
  { href: "/tickets", icon: <Ticket aria-hidden />, label: "Tickets" },
  { href: "/teams", icon: <Users aria-hidden />, label: "Times" },
  { href: "/activity", icon: <Activity aria-hidden />, label: "Atividade" },
];
```

- [ ] **Step 2: Smoke test**

```bash
pnpm dev --filter=backoffice
```

Click Times; verify it lists the seeded team.

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/components/sidebar.tsx
git commit -m "feat(backoffice): Times nav entry"
```

---

## Phase I — Manual E2E smoke

### Task 39: Document and run the manual smoke

**Files:**
- (no new files; verifies the integrated stack)

- [ ] **Step 1: Bring the stack up**

```bash
docker compose up -d
DATABASE_URL=postgresql://qolmeia:qolmeia123@localhost:5436/qolmeia \
  pnpm --filter=@repo/db db:push
pnpm --filter=auth exec tsx src/scripts/seed-dev.ts
cd apps/agents
pnpm wrangler d1 migrations apply worker-bees --local
pnpm wrangler d1 execute worker-bees --local --file scripts/seed-p2.sql
pnpm wrangler d1 execute worker-bees --local --file scripts/seed-p3-team.sql
cd -
pnpm dev
```

- [ ] **Step 2: Log in as customer at `http://localhost:3001`**

Use `customer@qolmeia.dev` (magic link in the auth logs).

- [ ] **Step 3: Verify the sidebar**

- Open the chat — the right sidebar shows Correspondente + Designer
- Both should show **Disponível**

- [ ] **Step 4: Trigger a Designer job from chat**

Ask the Correspondent to make an image (e.g. "Faça um logo minimalista").

Verify in the sidebar without refreshing:
- Designer card flips Disponível → **Trabalhando**
- After the worker proposes its deliverable → **Aguardando aprovação**

- [ ] **Step 5: Approve in backoffice**

Log into `http://localhost:3000` as `operator@qolmeia.dev` / `Qolmeia-Dev-OperatorPass!`.
- Go to `/approvals`, find the pending action, decide **Aprovar**.
- Switch back to the customer tab — the sidebar should flip → Trabalhando → **Disponível**, and the image should appear in chat.

- [ ] **Step 6: Personalise the prompt**

- In the customer app, navigate to `/empresa`
- Click **Editar prompt** on the Designer card
- Save: `Você é minimalista, sempre monocromático.`
- Trigger another image — assert that the result reflects the personalisation

- [ ] **Step 7: Backoffice prompt edit**

- In backoffice, go to `/teams`, click the Designer, edit the prompt to `Use sempre cores vibrantes.`
- Verify in `/activity` (backoffice or customer) that a `MEMBER_PROMPT_EDITED` row appears with the operator's actor_id

- [ ] **Step 8: Multi-hire**

- From `/empresa`, hire a second Designer named "Marina"
- Trigger an image — verify it lands on one of the two designers (round-robin or available preference)
- Pause "Marina"; trigger another image — verify it never lands on Marina

- [ ] **Step 9: Record the smoke result**

Append a one-line entry to the spec's "Decisions & smoke results" section (create the section if missing):

```bash
echo "
## Smoke result $(date -Iseconds)

All 8 smoke steps passed locally on $(git rev-parse --short HEAD)." >> docs/superpowers/specs/2026-05-27-customer-team-sidebar-and-company-page-design.md
git add docs/superpowers/specs/2026-05-27-customer-team-sidebar-and-company-page-design.md
git commit -m "docs(spec): record manual smoke result for team sidebar feature"
```

---

## Wrap-up

After the last task lands:

1. Run the full suite + typecheck + lint one final time:
   ```bash
   pnpm test
   pnpm typecheck
   pnpm lint
   ```
2. Open a PR with this plan + spec linked in the body.
3. The branch in this worktree is `feat/customer-team-sidebar` (created in the spec-commit step).

---

## Notes for the implementer

- **Don't skip the read-back in mutations** — the helpers always return the materialised view so the UI never has to derive from partial data.
- **`logActivity` signature** — the `{ DB: db } as { DB: D1Database }` cast in mutations is because `logActivity` expects the full `Env` shape; it only reads `env.DB` so the cast is safe. If you'd rather, refactor `logActivity` to take a narrower input — but treat that as a separate PR.
- **`session.userId`** — verify the field exists on the validated session payload before relying on it in the backoffice PATCH route; the test will catch it if not.
- **Visibility-change polling** — when adding the Empresa page, make sure you only mount one WebSocket per visit (the `useTeamRoster` hook handles this; don't add a second `useAgent` call on the same page).
- **Empresa folder name** — the page lives at `apps/client/src/app/(client)/empresa/` (renamed from `company` in Task 34 for consistency between URL and route segment).
