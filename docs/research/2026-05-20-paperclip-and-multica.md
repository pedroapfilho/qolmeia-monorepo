# Paperclip & Multica — Architecture Research and Concepts to Replicate

**Date:** 2026-05-20
**Status:** Research notes (not a spec)
**Author:** Pedro + Claude
**Purpose:** Document the architecture of two adjacent open-source platforms (Paperclip and Multica), identify concepts worth porting into Qolmeia, and explicitly mark what we should leave behind.

This document does not propose changes to Phase 5. It feeds future phase planning.

---

## 1. Why this document exists

Qolmeia is a Telegram-first AI agency that serves businesses. Phase 5 (`docs/superpowers/specs/2026-05-20-qolmeia-multi-agent-architecture-design.md`) introduces a multi-agent backend with templates, instances, skills, connectors, bindings, and an approval queue.

Two open-source projects solve adjacent problems with similar primitives:

- **Paperclip** (`paperclip.ing`, `github.com/paperclipai/paperclip`) — a control plane for autonomous AI labor. Hire AI employees, set budgets, governance from above.
- **Multica** (`multica.ai`, `github.com/multica-ai/multica`) — Linear-for-coding-agents. Issues, assignees, runtimes, daemons, a skill library.

Both have shipped working systems with thoughtful primitives. Reading their code is faster than discovering the same lessons through our own iteration. This doc captures what they are, how they're built, and which of their ideas we should pull into Qolmeia.

---

## 2. Paperclip

### 2.1 Product positioning

> _"The human control plane for AI labor."_

Paperclip lets you build and run autonomous companies. You define a goal ("Build the #1 AI note-taking app to $1M MRR"), hire AI employees (CEO, CTO, engineer, designer, marketer), set per-agent budgets, and the platform runs the company. You sit at the top as a board chair: approve hires, override strategy, pause or terminate any agent.

Self-hosted Node.js. MIT licensed. Embedded Postgres for local dev. One install can run many companies (multi-tenant by `companyId`).

### 2.2 Stack and shape

- **Language:** Node.js
- **Storage:** Postgres (embedded locally; bring your own in cloud)
- **Runtime:** CLI subprocess adapters — agents are external CLIs (Claude Code, Codex CLI, OpenClaw, OpenCode, shell, HTTP webhook)
- **Distribution:** `npx paperclipai onboard --yes`
- **Plugin model:** First-class. Plugins ship as npm packages (e.g. `@paperclipai/plugin-llm-wiki`)
- **License:** MIT

### 2.3 Core primitives

| Primitive                                 | What it is                                                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- | ------------ |
| **Company**                               | A tenant. One Paperclip install runs many. All other data scopes by `companyId`.                                                                                |
| **Agent (managed)**                       | An AI employee with a `role`, `agentKey`, a configured CLI adapter, and a budget. Created either by the operator or by a plugin's `agents.managed` declaration. |
| **Adapter**                               | The thing that actually executes an agent run. Spawns the CLI as a child process. Each adapter has `timeoutSec` and `graceSec`.                                 |
| **Skill**                                 | A capability bundle attached to an agent. Plugins can install skills via `skills.managed`.                                                                      |
| **Tool**                                  | Function callable from inside an agent's CLI loop. Plugins declare their tools; the host wires them into the adapter's tool surface.                            |
| **Issue**                                 | A unit of work. Plugins create Issues to track operations (e.g. wiki ingest, query session). Has comments and a status.                                         |
| **Run (`heartbeatRuns`)**                 | A single execution of an agent. Each Run corresponds to one CLI subprocess invocation.                                                                          |
| **Wakeup request (`agentWakeupRequest`)** | A queued ask for the agent to run. Sources: `timer                                                                                                              | assignment | on_demand | automation`. |
| **Heartbeat**                             | The scheduler that picks up wakeup requests and dispatches Runs.                                                                                                |
| **Routine**                               | A scheduled job tied to an agent. Plugins ship them paused; operator enables.                                                                                   |
| **Project**                               | Managed by plugins. Groups Issues. (Wiki plugin's "LLM Wiki" project.)                                                                                          |
| **Folder (mount)**                        | A local-disk directory the plugin owns. `access: readWrite`. Path-containment + symlink checks enforced by host.                                                |
| **Database namespace**                    | Plugin-scoped SQL schema. Migrations applied through host; host rejects migrations that escape the namespace.                                                   |
| **Session (`agentTaskSessions`)**         | Conversation continuity for an agent. Keyed by `taskKey` (e.g. `plugin:telegram:session:<chatId>`). Adapters with session support resume across Runs.           |

### 2.4 Plugin system

The single most interesting architectural choice. A plugin is a published npm package that declares a **manifest** of capabilities and provides a **worker** entry point.

**Declared capabilities (the permission surface):**

```
agents.managed           — register managed agents
skills.managed           — register skills bundled per agent
routines.managed         — register paused-by-default scheduled jobs
ui.page.register         — mount React pages in named slots (sidebar, page, route-sidebar)
ui.sidebar.register      — add sidebar entries
database.namespace.*     — own a SQL schema with sandboxed migrations
local.folders            — declare folder mounts with declared access mode
webhooks.receive         — declare named webhook endpoints (board / board-or-agent / public)
agent.sessions.create    — create chat sessions with managed agents
agent.sessions.send      — send messages into a session and receive streamed events
agent.invoke             — one-shot agent run (no streaming)
http.fetch               — outbound HTTP from worker
streams.open/emit/close  — SSE to plugin UI pages
```

**Worker runtime:** the plugin exports a worker (Node.js module). The host injects a scoped `ctx` object that holds clients for every capability granted. The worker implements lifecycle hooks (`bootstrap`, `enable`, `disable`, `uninstall`) and request handlers (`handleWebhook`, REST route handlers, skill execute, routine tick).

**UI registration:** Plugins mount React pages into slots the host exposes. The host renders the chrome (nav, sidebar, breadcrumbs, plugin manager); the plugin renders its own surfaces inside slots.

**Operator install flow:** `paperclipai plugin install <pkg>` → review declared permissions → approve → first-enable wizard runs the plugin's bootstrap action. Existing files preserved.

**Database isolation:** every plugin migration runs against a plugin-scoped schema. The host's SQL validator refuses migrations that touch tables outside the namespace. Operator never has to worry about a plugin corrupting host tables.

### 2.5 Runtime and trigger model (verified from the codebase)

**Adapters spawn CLIs.** `server/src/services/heartbeat.ts:7784` — `adapter.execute(...)` spawns the configured agent CLI as a child process. Each agent has an adapter. Cold-start is meaningful (5–30s for Claude/Codex CLIs).

**Triggers come from four sources:**

```
timer       — scheduled per-agent autonomous polling (configurable, no enforced minimum)
assignment  — operator/agent assigns work; queues a wakeup
on_demand   — manual operator action
automation  — programmatic, e.g. plugin calling ctx.agents.sessions.sendMessage
```

**The on-demand path is real.** `ctx.agents.sessions.sendMessage` from a plugin webhook handler:

1. Creates a session if missing (or resumes existing).
2. Calls `heartbeat.wakeup` (`heartbeat.ts:8663`).
3. Inserts an `agentWakeupRequest` + a queued `heartbeatRuns` row.
4. Dispatches via `void executeRun(claimedRun.id)` immediately (`:6872`). No timer wait.
5. Adapter spawns CLI as subprocess.
6. Streams chunks back via `onEvent` callback (`plugin-host-services.ts:2101–2154`).

**Coalescing:** concurrent wakeups for the same `(agent, issue)` merge into one Run (`heartbeat.ts:9091, 9127` — log marker `coalesced`).

**Streaming model:** the host emits live events from the running CLI through `subscribeCompanyLiveEvents`. The plugin's `onEvent` callback receives `chunk | status | done | error` events. From within `onEvent` a plugin can call `ctx.http.fetch` to push tokens to an external channel as they arrive.

**Webhook auth:** `/api/plugins/<pluginId>/webhooks/:endpointKey` is intentionally unauthenticated at the host. The plugin's `handleWebhook` verifies signatures itself. The `auth: "webhook"` mode on `apiRoutes` exists but is explicitly stubbed (`plugins.ts:482-484`); use the `webhooks.receive` declaration path.

### 2.6 Worked example: `@paperclipai/plugin-llm-wiki`

Concrete plugin to study. Lives at `packages/plugins/plugin-llm-wiki/`.

**Declares:**

- A managed agent — _Wiki Maintainer_ (`agentKey: wiki-maintainer`, role `knowledge-maintainer`).
- A managed project — _LLM Wiki_ (`projectKey: llm-wiki`) — collects ingest/query operation Issues.
- Three paused routines: `cursor-window-processing`, `nightly-wiki-lint`, `index-refresh`.
- Six managed skills installed on the maintainer: `wiki-maintainer`, `wiki-ingest`, `wiki-query`, `wiki-lint`, `paperclip-distill`, `index-refresh`.
- A folder mount (`folderKey: wiki-root`, access `readWrite`).
- A database namespace (`namespaceSlug: llm_wiki`) with its own migrations.
- UI slots: `wiki-sidebar`, `wiki-page`, `wiki-route-sidebar`.
- REST routes: `GET /overview`, `POST /bootstrap`, `POST /sources`, `GET /spaces`, `POST /spaces`, `POST /spaces/:slug/bootstrap`, `POST /query-sessions`, etc. Each route declares auth: `board` (operator-only) or `board-or-agent` (callable from inside an agent run).
- Plugin tools exposed to agents: `wiki_search`, `wiki_list_pages`, `wiki_read_page`, `wiki_write_page`, `wiki_propose_patch`, `wiki_list_sources`, `wiki_read_source`, `wiki_list_backlinks`, `wiki_update_index`, `wiki_append_log`.

**On-disk shape after bootstrap:**

```
<wiki-root>/
  AGENTS.md       ← operator-edited instructions; agent tools can't overwrite
  IDEA.md         ← operator-curated company direction
  wiki/
    index.md
    log.md        ← every routine appends a maintenance note here
    sources/
    projects/
    entities/
    concepts/
    synthesis/
  raw/            ← captured source material before becoming pages
```

**Reserved files pattern:** `AGENTS.md` and `IDEA.md` cannot be written through agent tools. Only the operator can edit them. This is the cleanest "human-in-the-loop on the parts that matter" affordance I've seen.

### 2.7 Cost and budgets

Per-agent monthly budget. Hard stop on budget hit (Paperclip) vs. soft-warn (our spec). Tracked at the Run level. Operator dashboard rolls it up per Company / Agent / period.

### 2.8 What Paperclip is good at

- Operator-first UX. Permissions visible at install; routines paused by default; reserved files; budget hard-stops.
- Clear capability model. Plugins declare what they want; host injects scoped clients. Easy to audit.
- Plugin distribution via npm. Third parties can ship managed agents + skills + UI + routes as a single installable unit.
- Sandboxed DB namespaces with migration validation.
- Multi-adapter runtime. Different agents can use different CLIs.

### 2.9 What Paperclip is bad at (for our use case)

- Latency. Each turn spawns a CLI subprocess. 5–30s cold start. Acceptable for "schedule a market analysis routine," not for "Telegram reply."
- Heavyweight per-turn. Issue + Run + wakeup row + session row per message. Overkill for short conversational turns.
- CLI-subprocess agent model. No direct `generateText` control. Skills become MCP-style tools the CLI calls; our current AI SDK v6 step-aggregation patterns don't survive.
- Heartbeat-shaped mental model. Even though `automation` sources work, the rest of the system (Issues, Runs, routines) reads as built for long-form autonomous work, not chat turns.

---

## 3. Multica

### 3.1 Product positioning

> _"The open-source managed agents platform. Turn coding agents into real teammates — assign tasks, track progress, compound skills."_

Multica is Linear, but the assignee dropdown includes AI agents. Issues get assigned to either a human or an agent CLI; agents stream progress in real time, raise blockers, and ship code. Apache 2.0. Self-hosted via `docker compose up`.

Target users: 2–10 person engineering teams adding coding agents as teammates.

### 3.2 Stack and shape

- **Backend:** Go (Chi router, `sqlc`, `gorilla/websocket`)
- **Database:** PostgreSQL 17 with `pgvector`
- **Web frontend:** Next.js 16 (App Router)
- **Desktop:** Electron
- **State management:** React Query (server state) + Zustand (UI state)
- **Monorepo:** pnpm workspaces + Turborepo
- **Daemon:** Go CLI `multica` runs on operator machines and registers as a Runtime
- **License:** Apache 2.0

**Strict package boundaries enforced.** `packages/core/` has zero `react-dom`, zero `localStorage`, zero `process.env`. Platform-agnostic business logic that the web, desktop, and (potentially) mobile shells all reuse.

### 3.3 Core primitives

| Primitive             | What it is                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workspace**         | The tenant. Every other row carries `workspace_id`. Multi-tenancy is enforced at the column level, not the schema level.                                                    |
| **Member**            | A human or agent participant in a workspace. Authors, assignees, and actors all reference Members.                                                                          |
| **Issue**             | The unit of work. Title, description, status, assignee, comments, related issues, acceptance criteria. Linear-shaped.                                                       |
| **Agent**             | A configured AI worker. Has a CLI binding (Claude Code, Codex, Cursor, Copilot, Gemini, OpenClaw, OpenCode, Hermes, Pi, Kimi, Kiro).                                        |
| **Runtime**           | A compute environment that executes agent tasks. Daemon (local machine) or cloud. Each Runtime reports which agent CLIs are available so Multica knows where to route work. |
| **Task**              | A scheduled execution of an Agent against an Issue. Lifecycle: `queued → claimed → running → completed/failed`.                                                             |
| **Skill**             | A reusable capability bundle (code, config, context). Attached to agents explicitly via the `agent_skill` join.                                                             |
| **Squad**             | A group of agents (and humans) under a leader. Work assigned to the squad; the leader routes. Keeps assignment stable as the team grows.                                    |
| **Inbox**             | A per-member notification queue.                                                                                                                                            |
| **Activity log**      | Append-only audit trail of who did what.                                                                                                                                    |
| **Comment**           | Threaded working memory on an Issue during execution.                                                                                                                       |
| **Workspace context** | A shared prompt every agent inherits at the workspace level.                                                                                                                |

### 3.4 Memory model

This is the part worth pulling carefully. Multica deliberately chose **explicit attachment over vector retrieval** for skills:

> _"Skills aren't retrieved by similarity. They're attached to agents explicitly through `agent_skill` rows."_

Six tables form the memory architecture:

1. `workspace.context` — shared prompt all agents inherit
2. `issue` — task units with related issue IDs and acceptance criteria
3. `agent_task_queue.context` — point-in-time JSONB snapshots
4. `skill` + `skill_file` + `agent_skill` — reusable capabilities, attached per agent via joins
5. `comment` — threaded working memory during tasks
6. `activity_log` — append-only audit trail

**JSONB snapshot pattern.** When a task dispatches, the backend assembles a single JSON blob containing workspace context, the target issue, related issues, attached skills, and comments. The agent receives this snapshot once at start — no live DB queries during execution. Deterministic, debuggable, easy to replay.

The platform does ship `pgvector` (Postgres 17 + pgvector), so semantic search is available where it's actually useful. The point is they didn't reach for vector search as the primary knowledge interface. Joins first, vectors when needed.

### 3.5 Runtime registration

The daemon model is worth understanding. The `multica` CLI runs on a user's laptop (or in a cloud VM) and registers as a **Runtime** with the server. Auto-detection scans for 11 supported coding tools on PATH. Each Runtime reports its capabilities (which CLIs are available, online/offline status, usage metrics) and the server uses this to route Tasks.

**Code isolation.** Code never leaves the user's machine. Multica's server only coordinates Task state and broadcasts events over WebSocket. The Runtime claims a queued Task, executes it locally, streams progress back. This is the inverse of Paperclip's "host spawns the CLI" model — in Multica, the host dispatches and the daemon executes.

### 3.6 Real-time UX

WebSocket-driven. Tasks stream progress as they run. The web frontend uses React Query for server state; WebSocket events invalidate React Query caches rather than writing into stores directly. This keeps the data model clean (DB is source of truth; cache is a view).

### 3.7 What Multica is good at

- Linear-shaped Issue UX. Assignee dropdowns mixing humans and agents. Activity feeds. Comments. Related issues. The familiar shape Lin our owners expect.
- Squad abstraction. Stable routing as the team grows.
- Explicit skill attachment via `agent_skill` joins. Predictable, no embedding magic, easy to debug.
- JSONB context snapshots at dispatch. Deterministic. Replayable.
- Daemon-based runtime registration. Code never leaves user infra.
- `packages/core/` with strict no-platform-deps boundary. Same business logic powers web + desktop.
- Skill compounding language. Solving a problem leaves a reusable artifact.

### 3.8 What Multica is bad at (for our use case)

- Coding-agent flavor. The whole shape assumes the work product is code. Marketing assets, brand voice, conversational replies — none of those are first-class.
- No chat/messaging channel concept. Everything is Issue-shaped. Owner-talks-to-representative-on-Telegram doesn't fit Issues without distortion.
- Go backend. Different stack from ours; harder to fork or extend than the Node-based Paperclip.
- No connector abstraction. WhatsApp/Fresha/Google My Business / Instagram don't have a place to plug in.
- No approval queue for low-stakes-but-customer-facing actions. Linear-style review is heavy for "should the AI send this WhatsApp reply?"

---

## 4. Side-by-side comparison

| Axis          | Paperclip                                | Multica                                    | Qolmeia (current spec)                                        |
| ------------- | ---------------------------------------- | ------------------------------------------ | ------------------------------------------------------------- |
| Tagline       | Human control plane for AI labor         | Coding agents as teammates                 | AI agency that talks to businesses                            |
| Tenant        | Company                                  | Workspace                                  | Organization                                                  |
| Worker        | Managed Agent                            | Agent                                      | AgentInstance                                                 |
| Work unit     | Issue + Run                              | Issue + Task                               | AgentAction                                                   |
| Skill model   | Bundled per agent via `skills.managed`   | Joined via `agent_skill`                   | `Skill` table, attached via Template / per-instance overrides |
| Hierarchy     | Org chart (role + reporting)             | Squad with leader                          | `canDelegateTo` DAG                                           |
| Trigger       | Timer, assignment, on_demand, automation | Issue assignment                           | Inbound webhook → `AgentAction.draftAction`                   |
| Execution     | CLI subprocess (host-spawned)            | Daemon claim (user-machine-spawned)        | In-process AI SDK `generateText`                              |
| Streaming     | Host event bus → `onEvent`               | WebSocket                                  | None yet (would be Phase 6+)                                  |
| Memory        | Sessions per `taskKey`, project Issues   | `agent_task_queue.context` JSONB snapshots | `Organization.businessProfile` + `AgentInstance.mission`      |
| Cost          | Per-agent budget, hard stop              | Not foregrounded                           | Per-AgentAction tokens, soft-warn at 80/100%                  |
| Governance    | Board approves hires + overrides         | None foregrounded                          | `AgentAction.DRAFTED` approval queue                          |
| Plugin system | First-class                              | None                                       | None                                                          |
| Channels      | None                                     | None                                       | First-class (`ConnectorInstance`, `AgentConnectorBinding`)    |
| Stack         | Node.js                                  | Go + Next.js + Electron                    | Node.js (Hono) + Next.js (future)                             |
| License       | MIT                                      | Apache 2.0                                 | Proprietary                                                   |

---

## 5. Concepts to replicate in Qolmeia

Five buckets:

1. **Already in Phase 5 spec** — note for completeness; no action.
2. **Pull into Phase 5b–5i without re-speccing** — small, mechanical adoptions.
3. **Phase 6+ candidates** — worth their own spec later.
4. **Distant future** — interesting but not on the roadmap.
5. **Don't replicate** — flagged anti-patterns for our use case.

### 5.1 Already in Phase 5 spec

These are present; nothing to do.

| Concept                        | Where in Phase 5 spec                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Multi-tenant by tenant ID      | `Organization` is the tenant; every other table carries `orgId`. Same shape as Multica's `workspace_id`. |
| Managed agent + skill model    | `AgentTemplate` + `AgentInstance` + `Skill` + per-template skill attachment.                             |
| Per-agent budget               | `AgentInstance.budgetCents` + soft-warn rollup.                                                          |
| Approval queue                 | `AgentAction.DRAFTED → APPROVED/REJECTED/EDITED`.                                                        |
| Delegation DAG                 | `AgentTemplate.canDelegateTo` with cycle check.                                                          |
| Per-action provenance          | `AgentAction.proposedInput`, `proposedSummary`, `triggerMessageId`, `parentActionId`.                    |
| Approval rule with sender role | `ConnectorInstance.senderRole` × `Skill.requiresApprovalDefault`.                                        |
| Cost per action                | `AgentAction.costCents/costInputTokens/costOutputTokens`.                                                |

### 5.2 Pull into Phase 5b–5i (no new spec needed)

Small, additive. Each adds ~50–150 lines, no schema rework.

**Reserved files pattern (from Paperclip's wiki plugin).** Today, the `Organization.businessProfile` JSON is the only "human-curated" knowledge. Add two explicit fields the owner controls and skills can read but not write:

- `Organization.agentInstructions: String?` — equivalent of `AGENTS.md`. Free-form instructions the Controller and specialists prepend to their system prompts. Owner edits via Telegram command (`/instrucoes`) or, later, web UI. Skills can't overwrite it.
- `Organization.businessIdea: String?` — equivalent of `IDEA.md`. The owner's stated direction. Read at session start. Owner-curated.

Cost: one Prisma migration + Knowledge provider reads them + system prompt template includes them. Pays off immediately by giving the owner a stable lever over agent behavior beyond the Soul JSON.

**Explicit `agent_skill` join (from Multica).** Phase 5a's schema has `AgentTemplate.skills` (template-level attachment) and `AgentInstance.enabledSkillIds` (instance-level override list). Multica's lesson: model the join as a row, not an array column. Reasons: rows carry metadata (when attached, who attached, whether enabled, per-skill config overrides). The current array works for v0 but ages poorly.

Defer to Phase 6+ if other priorities win, but flag in the spec.

**JSONB context snapshot at dispatch (from Multica).** Today, `knowledge/provider.getContext({orgId, agentInstanceId})` runs live DB queries inside the agent runtime. Multica's pattern: assemble the full context blob (businessProfile + mission + recent messages + attached skill specs) **once** when enqueuing the AgentAction, store it on the Action row, hand it to the worker. Determinism, replayability, easier debugging.

Cost: add `AgentAction.contextSnapshot: Json?` field; runtime reads from it instead of calling provider. Knowledge provider becomes a snapshot-builder, not a runtime dependency.

**Activity log as a first-class table (from Multica).** Today, we have `AgentAction` (for AI work) and `Message` (for conversation). A unified `ActivityLog` row per noteworthy event (action drafted, action approved, action failed, message sent, budget threshold crossed, owner edited instructions) gives a single timeline. Surfaces directly as "Modo Co-piloto" feed in the future web UI.

Cost: one table + write-points scattered across runtime. Pays off when the UI lands.

**`taskKey` for conversation continuity (from Paperclip).** The current `Conversation` model is implicit per Telegram chat. Make it explicit: every AgentInstance has zero or more "task threads" keyed by `(connectorInstanceId, externalThreadId)`. Phase 5g (BullMQ dispatcher) can coalesce concurrent dispatches per `taskKey`, matching Paperclip's coalescing pattern.

Cost: an index + dispatcher dedup logic. Prevents "double image generation" when an owner sends two messages in 100ms.

### 5.3 Phase 6+ candidates (warrant their own spec)

Bigger lifts. Each has UX implications.

**Operator dashboard (`apps/web`).** Phase 5 spec defers this. When we build it, study Paperclip's company switcher, agent admin page, cost rollup view, and plugin manager surface. Borrow shapes; build our own.

**Streaming chat surface.** Multica's pattern: WebSocket events invalidate React Query caches. For our future web UI, the owner watches the Controller's reasoning stream in real time. Phase 5g (BullMQ) is the right time to add `agent.events` channel emissions that a future UI can subscribe to.

**Inbox abstraction (from Multica).** A per-owner notification queue for things that need attention: pending AgentActions, budget warnings, failed actions, customer messages flagged for human reply. Lives in the future web UI. Replaces the implicit "every DRAFTED AgentAction is in someone's inbox" assumption.

**Squad abstraction (from Multica).** Today, the Controller IS the leader of an implicit squad. Make it explicit if/when we add more roles. A `Squad` row groups `AgentInstance`s under a `leaderAgentInstanceId`; inbound to the squad routes through the leader. Defer until we have ≥4 roles per org.

**Runtime registration model (from Multica).** Currently, all skill execution happens in-process. Multica's daemon model is interesting for skills that should run on customer infrastructure (e.g., a Designer skill that needs Figma access). Defer until the customer ecosystem demands it.

**Routines as paused-by-default scheduled jobs (from Paperclip).** Cron-style work the owner enables: "Every Monday 9am: draft week's content calendar"; "Nightly: refresh brand assets index"; "Hourly: poll Google My Business for new reviews." Today, the spec is purely reactive (inbound message → action). Routines unlock proactive value. Worth its own spec when we add a second proactive use case.

### 5.4 Distant future

**Plugin system for Qolmeia itself.** If Qolmeia ever ships as a self-hosted platform for agencies to manage their clients, a plugin model lets agencies extend with industry-specific skills (e.g., "Dental clinic skills pack"). Study Paperclip's manifest + capability declaration + DB namespace pattern. Not on the roadmap.

**Multi-adapter agent runtime.** Today, all AgentInstances use the AI SDK via Vercel AI Gateway. If we ever want Designer running on a local Stable Diffusion daemon or Marketing Strategist on Anthropic direct, an adapter layer becomes necessary. Mirror Paperclip's pattern (one adapter interface, many implementations).

**Provenance + citations.** Paperclip's wiki plugin attaches citations to every agent claim. For Qolmeia, this maps to "every marketing claim links to the BrandAsset or businessProfile field that grounds it." Useful when the owner asks "por que você sugeriu isso?" Defer.

### 5.5 Don't replicate

**CLI-subprocess agent runtime.** Paperclip's approach. Wrong for chat. We keep AI SDK direct calls.

**Heartbeat-as-primary-trigger.** Paperclip's mental model. We're event-driven (webhooks).

**Issue-as-only-unit-of-work.** Multica's model. Our channel-first product needs `Message` + `AgentAction` as primary; Issues might come later but should not be the trunk.

**Hard-stop budgets.** Paperclip's choice. Wrong for our use case — owner expects responses; soft-warn is correct.

**Vector-search-first knowledge.** Both platforms underweight semantic retrieval and they're right for their use cases. We should follow the same pattern: explicit joins first, vectors only where they genuinely beat join queries.

---

## 6. Sources

- Paperclip llms.txt: https://paperclip.ing/llms.txt
- Paperclip docs (LLM Wiki plugin): operator-facing guide referenced by user during this session
- Paperclip codebase: https://github.com/paperclipai/paperclip
  - `server/src/services/heartbeat.ts` (wakeup + dispatch path)
  - `server/src/services/plugin-host-services.ts` (sendMessage, streaming)
  - `server/src/routes/plugins.ts` (webhook endpoint, route auth)
  - `packages/plugins/sdk/src/types.ts` (capability surface)
  - `packages/plugins/plugin-llm-wiki/src/wiki/core.ts` (worked example)
  - `docs/agents-runtime.md` (operator-facing runtime guide)
- Multica homepage: https://multica.ai
- Multica codebase: https://github.com/multica-ai/multica
- Multica AGENTS.md: https://github.com/multica-ai/multica/blob/main/AGENTS.md
- Multica DeepWiki: https://deepwiki.com/multica-ai/multica
- "How Memory Works in a Multi-Agent System: Inside Multica" (mem0.ai blog)
