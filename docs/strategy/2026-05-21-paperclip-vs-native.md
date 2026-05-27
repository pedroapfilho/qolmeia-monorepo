# Qolmeia Strategy: Paperclip-as-backoffice vs. Native architecture

**Date:** 2026-05-21
**Author:** Pedro + Claude (strategy session)
**Audience:** Pedro's team — for the "what do we build next" decision
**Status:** Decision pending — recommendation included

---

## TL;DR

We have two viable paths to ship the agency vision. The shape of the customer-facing product is the same either way: a company onboards through a planner agent, picks a team, gets a Correspondent who talks to them through any channel, and a backoffice where operators steer the work.

**Path A — Build Qolmeia-native.** Keep the runtime we have (557 tests, 3 apps, OpenRouter + Nano Banana Pro, unified inbound pipeline). Add the missing pieces: Company onboarding flow, Correspondent role with memory, Team builder UI, multi-channel adapter expansion. **~3 weeks** of incremental work on top of `main`.

**Path B — Pivot to Paperclip plugin.** Strip our agent runtime, package what's left as a Paperclip plugin, use Paperclip's heartbeat-driven CLI-subprocess runtime + ticketing + multi-company governance. Our backoffice becomes plugin pages; our client app stays as the customer surface. **~3 weeks** of work but with throw-away cost.

**Recommendation: Path A.** The pull toward Paperclip is real — but we've already paid the runtime cost. Switching now means throwing away the working agent loop to gain features we already have (multi-tenancy, approval queue, activity log, delegation). The unique pieces the customer experience needs (planner, Team builder, Correspondent memory, multi-channel) are buildable on top of what exists, and they slot cleanly into the seams we already shipped. Paperclip's value is real for someone starting from zero; for us it's a reset.

The rest of this doc shows the work, the trade-offs, and the roadmap.

---

## 1. What we're building (target architecture)

Restated from the requirements, normalized to a single picture:

```
                                  Company (tenant)
                                       │
              ┌────────────────────────┼─────────────────────────┐
              │                        │                         │
        Onboarding flow         Team of Workers          Correspondent (1)
        (web-only at first)     (customer-chosen)        ├─ Always-on
        ├─ Debrief planner      ├─ Marketing             ├─ Per-company memory
        │   agent               ├─ Support               ├─ Routes user requests
        ├─ Suggested team       ├─ Sales / Onboarding    ├─ Surfaces what the
        │   based on debrief    ├─ Design                │   team is doing
        └─ Customer confirms    └─ Future: any role      └─ Approval gate UX
                                                              │
                                  ┌───────────────────────────┘
                                  │
                            User (customer)
                            ├─ Business owner OR employee
                            ├─ Talks to Correspondent via:
                            │   Telegram | Slack | WhatsApp | Discord | Web
                            ├─ Sends audio, gets text + assets back
                            └─ Approves / rejects / requests changes
```

**Key invariants:**

1. **Channels are commodity** — Telegram is just one inbound; the user picks whichever channel they prefer. This is already true in our codebase (PR #8 unified `ConnectorAdapter`). Slack and Discord are the missing adapters.

2. **Connectors are shareable across agents** — a Slack workspace connector belongs to the Company, not to a specific agent. Any agent (Correspondent, marketing worker, etc.) can use any connector that's been provisioned for the company.

3. **The Correspondent is the comms layer** — the customer doesn't talk to "marketing worker" or "support worker" directly. They talk to the Correspondent, who delegates internally.

4. **Workers have memory and context** — each agent (including the Correspondent) has access to the company's accumulated knowledge: business profile, brand assets, past conversations, ongoing campaigns.

5. **The customer assembles their own team** — there's no fixed agent roster. The planner debriefs the customer, suggests a team based on their business, and the customer picks. The system instantiates those agents for that Company.

---

## 2. Where we are today (`main` at HEAD `3f6d3b0`)

Already shipped (10 PRs over 2 days, 557 tests, all gates green):

| Capability                                                       | Status | Where                                                        |
| ---------------------------------------------------------------- | ------ | ------------------------------------------------------------ |
| 3 apps (api / backoffice / client)                               | ✅     | `apps/{api,backoffice,client}`                               |
| Better Auth + magic-link + `OrgMembership` roles                 | ✅     | `@repo/auth`, all 3 apps                                     |
| Multi-tenant via `Organization` (= "Company")                    | ✅     | Prisma schema                                                |
| Unified inbound pipeline around `NormalizedMessage`              | ✅     | `apps/api/src/inbox/*`                                       |
| Generic webhook route `/connectors/:type/:id/webhook`            | ✅     | `apps/api/src/routes/connectors/index.ts`                    |
| `ConnectorAdapter` interface + registry                          | ✅     | `apps/api/src/connectors/{types,registry}.ts`                |
| Live adapters: Telegram, WhatsApp, WEB_CHAT                      | ✅     | `apps/api/src/connectors/*/adapter.ts`                       |
| Stub adapters: Fresha, Google My Business, Instagram             | ⏸️     | Placeholders; need real impl                                 |
| 3 seeded agent templates (Controller, Strategist, Designer)      | ✅     | `apps/api/src/agents/templates/*.ts`                         |
| Per-agent model selection via OpenRouter                         | ✅     | `apps/api/src/lib/ai.ts` + `AgentTemplate.defaultModel`      |
| 7 skills (extractSoul, generateBrandImage, …)                    | ✅     | `apps/api/src/agents/skills/*.ts`                            |
| `AgentRun` + context snapshot at dispatch (replayable)           | ✅     | `apps/api/src/agents/runs.ts`                                |
| Delegation via `delegateToSpecialist` skill + `parentRunId`      | ✅     | `apps/api/src/agents/skills/delegate-to-specialist.ts`       |
| Approval flow (senderRole-aware, schema-driven editor)           | ✅     | `apps/api/src/agents/approvals.ts` + backoffice `/approvals` |
| `ActivityLog` unified timeline (20 event types)                  | ✅     | `apps/api/src/activity/*`                                    |
| Routines (paused-by-default BullMQ JobScheduler)                 | ✅     | `apps/api/src/routines/*`                                    |
| Owner Telegram commands (`/instrucoes`, `/ideia`, `/rotinas`, …) | ✅     | `apps/api/src/inbox/owner-commands.ts`                       |
| Backoffice UI (Next.js 16)                                       | ✅     | `apps/backoffice`                                            |
| Client web chat UI with SSE                                      | ✅     | `apps/client`                                                |
| Invite flow (backoffice → magic-link → client)                   | ✅     | `/api/v1/team/invite` + `/team` page                         |
| `BrandAsset` + R2 storage                                        | ✅     | `apps/api/src/lib/storage.ts`                                |
| `KnowledgeDoc` registry                                          | ✅     | `searchKnowledge` + `readKnowledgeDoc` skills                |
| Image generation (Nano Banana Pro)                               | ✅     | `apps/api/src/lib/image-gen.ts`                              |

**What's NOT yet built** (gap vs. target architecture):

| Gap                             | Detail                                                                                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company onboarding planner      | No "debrief the customer" agent flow exists. We have `extractSoul` (one-shot capture), not a guided onboarding.                                                                                     |
| Correspondent role              | We have a `Controller` template (briefing-gatherer). It's similar but not branded/positioned as the "Correspondent." Doesn't have explicit persistent memory beyond `Organization.businessProfile`. |
| Team builder UI                 | The 3 agent templates are hardcoded + seeded at boot. There's no UI for the customer to pick/remove/configure agents.                                                                               |
| Per-agent persistent memory     | We have run-level context snapshots (good for replay) but no rolling per-agent memory across runs.                                                                                                  |
| Cross-agent connector sharing   | `AgentConnectorBinding(direction)` gates inbound per agent. Outbound is implicit. We don't model "any agent can use this Slack workspace when needed."                                              |
| Slack adapter, Discord adapter  | We have Telegram + WhatsApp + WEB_CHAT live. Slack and Discord need adapters (probably via Chat SDK as the library inside each adapter).                                                            |
| Audio input                     | Inbound supports audio attachments via `NormalizedMessage.attachments[].kind = "audio"`, but the Correspondent doesn't yet transcribe + route.                                                      |
| Suggested team catalog          | No "marketing template", "support ticket template", "sales template" exist as suggestions. Just 3 hardcoded ones.                                                                                   |
| Heartbeat-driven worker pattern | Routines exist (cron-based, paused-by-default). Paperclip's "heartbeat" model is similar but more general (event-driven + timer-driven). Ours is timer-only today.                                  |

---

## 3. The two paths

### Path A — Build Qolmeia-native

Extend the current 10-PR codebase to cover the gap.

**What we ADD (concrete work):**

1. **`Company` first-class rename + onboarding** _(3 days)_
   - Rename `Organization` model to `Company` (concept clarification; one Prisma migration + grep+replace).
   - New `OnboardingSession` model — tracks the debrief: state, planner agent run id, suggested team, customer choices.
   - New agent template: `planner` — single-skill agent that runs the debrief conversation, captures `Company.businessProfile`, and returns a suggested team via `suggestTeam` skill.
   - Backoffice page `/onboard/[companyId]` — wizard that drives the conversation step-by-step and lets the customer accept/edit the suggested team.

2. **`Correspondent` role + persistent memory** _(4 days)_
   - Rename `Controller` template → `Correspondent` (positioning; not a code rewrite — it's already the briefing-gatherer + delegator).
   - New `AgentMemory` model: `{ agentInstanceId, key, value: Json, createdAt, updatedAt }`. Append-only rolling memory; pruning policy TBD.
   - New skill: `recallMemory(query)` — retrieves matching keys from `AgentMemory`. New skill: `rememberFact(key, value)` — writes to it.
   - The Correspondent's system prompt includes a "recent memory" block fetched at dispatch (via `buildContextSnapshot` already exists).
   - Persistent memory complements (doesn't replace) `Organization.businessProfile` (the curated soul).

3. **Team builder + agent template catalog** _(4 days)_
   - Mark `AgentTemplate.kind = "core" | "optional"`. Core = Correspondent (always exists). Optional = the rest (Designer, Strategist, support agent, etc.).
   - Add 3-5 more optional templates: `support-agent`, `sales-agent`, `marketing-strategist` (already exists), `designer` (already exists), `analyst`.
   - Backoffice page `/team` (already exists as invite UI) gains a "Manage Agents" section: list of all available templates, customer toggles which ones are active. Toggling instantiates / pauses an `AgentInstance`.
   - `Correspondent.canDelegateTo` becomes dynamic — computed from active instances.

4. **Cross-agent connector sharing** _(2 days)_
   - Change `AgentConnectorBinding` semantics: still per-agent for INBOUND (only one agent receives webhooks from a given connector), but OUTBOUND becomes implicit — any agent can call `getAdapter(type).sendOutbound(...)` for any of the company's `ConnectorInstance`s.
   - New skill: `messageOnConnector({ connectorInstanceId, payload })` — exposed to all agents. Used by Correspondent to switch channels, or by other workers to notify the customer when relevant.

5. **Slack + Discord adapters** _(3-5 days; depends on Chat SDK fit)_
   - `apps/api/src/connectors/slack/adapter.ts` — implements `ConnectorAdapter` against Slack's Events API + Web API. Internally uses Chat SDK's `@chat-adapter/slack` if it cleanly maps. Else direct fetch.
   - Same for Discord.
   - Webhook URLs become `/connectors/slack/:id/webhook`, `/connectors/discord/:id/webhook` (no per-channel route file — generic handler).

6. **Audio input → transcription** _(2 days)_
   - When `NormalizedMessage.attachments[].kind === "audio"` arrives, the inbox attaches the bytes; the Correspondent's runtime gets the bytes in its prompt (Gemini supports audio input natively via OpenRouter).
   - Alternative: dedicated transcription skill called BEFORE the Correspondent's main loop. Decision: rely on multimodal models (Gemini) for now; add a transcription skill only if cost becomes an issue.

7. **Heartbeat pattern** _(3 days)_
   - Extend `Routine` to support `trigger: "cron" | "event"`. Today only cron.
   - New event triggers: `inactivity` (Correspondent reaches out if no message in N days), `budget-threshold`, `new-asset-uploaded`.
   - Routines stay paused-by-default. Customer enables via backoffice UI.

8. **Polish + integration tests** _(2-3 days)_
   - End-to-end test: company creation → onboarding → team selection → first message → Correspondent reply.
   - Backoffice + client smoke tests.
   - Documentation refresh.

**Total: ~20 days (3 weeks) of focused work.**

**What we KEEP from current `main`:**

- Every line of code on `main` today. Net delta is additions + a few semantic relabels (`Organization` → `Company`, `Controller` → `Correspondent`).
- All 557 tests stay green. New tests bring the total to ~700+.
- OpenRouter + Nano Banana Pro per-agent model selection. (This is a unique competitive advantage — Paperclip can't easily do this because its agents are CLI subprocesses.)
- Sub-second to ~few-second turn latency (no CLI subprocess cold start per message).
- The deterministic `AgentRun + contextSnapshot` pattern (replayable).

**What we GIVE UP:**

- Nothing — we're extending.

**What we LOSE by NOT going Paperclip:**

- Built-in multi-Company governance dashboard (we have to keep building it ourselves)
- Built-in ticketing UI (we have `AgentAction` + `ActivityLog`; we'd build the ticketing UX on top)
- Plugin distribution narrative (we ship as a hosted SaaS, not a Paperclip plugin)

---

### Path B — Pivot to Paperclip plugin

Restructure as a Paperclip plugin + customer-facing layer. Paperclip becomes the agent runtime + backoffice; we provide the customer surface.

**What we ADD:**

1. **Paperclip plugin manifest** _(2 days)_
   - `@qolmeia/plugin` package. Declares: `agents.managed` (Correspondent, optional team members), `skills.managed` (translated from our 7 skills), `routines.managed` (paused-by-default), `webhooks.receive` (Telegram, WhatsApp, Slack, Discord, WEB_CHAT), `ui.page.register` (customer-facing pages — chat, onboarding, team builder), `database.namespace.qolmeia` (our schema becomes plugin-scoped), `local.folders` (brand assets if not on R2).

2. **Translate skills into Paperclip plugin tools** _(3 days)_
   - Our 7 skills → 7 Paperclip plugin tools (`qolmeia_extract_soul`, `qolmeia_generate_brand_image`, etc.).
   - Plugin tools are exposed to whichever Claude CLI / Codex CLI adapter Paperclip is configured with.
   - This is a porting exercise — same logic, different interface.

3. **Replace `runAgentInstance` with Paperclip session API** _(3 days)_
   - `apps/api/src/inbox/pipeline.ts` calls `ctx.agents.sessions.create(...)` + `.sendMessage(...)` instead of `dispatcher.enqueueAndAwait(...)`.
   - Streaming via Paperclip's `onEvent` callback → fed into our SSE bus → fed to client.
   - `AgentRun` model in our DB is no longer the source of truth; Paperclip's `heartbeatRuns` is. We keep `AgentRun` as a translation/cache layer for the customer UI.

4. **Webhook routes → Paperclip routes** _(2 days)_
   - Our `/connectors/:type/:id/webhook` becomes a Paperclip plugin route (`/api/plugins/qolmeia/webhooks/:type`).
   - The plugin's `handleWebhook` calls our existing `parseInboundPayload` (the adapter logic stays) and then `ctx.agents.sessions.sendMessage(...)`.

5. **Customer onboarding + team builder as plugin UI** _(3 days)_
   - The customer-facing wizard becomes plugin UI pages (registered via `ui.page.register`).
   - Onboarding kicks off a Paperclip-managed `planner` agent via `sessions.sendMessage`.
   - Team builder calls `ctx.agents.managed.reconcile(...)` to add/remove managed agents per the customer's choices.

6. **Activity log + ticketing translation** _(3 days)_
   - Paperclip's `Issue` + `Run` events → our `ActivityLog` schema (for the customer UI).
   - Paperclip's approval queue (`agentAction.DRAFTED` analog) → our approval UI.
   - Operator surfaces (the backoffice we built) become plugin pages inside Paperclip's chrome.

7. **Polish + integration tests** _(2-3 days)_

**Total: ~18-21 days (3 weeks) of work.**

**What we KEEP from current `main`:**

- Connector adapter code (`apps/api/src/connectors/*/adapter.ts`) — moves into the plugin
- Web-chat-bus + SSE endpoint — stays for the client app
- Client app (`apps/client`) — almost untouched; just calls plugin routes instead of `/api/v1/*`
- Backoffice (`apps/backoffice`) — pages become plugin UI slots
- Database models that don't conflict with Paperclip's namespace
- `@repo/ui`, `@repo/transactional`, `@repo/auth` — partially reusable

**What we THROW AWAY:**

- `apps/api/src/agents/runtime.ts` (the agent loop — replaced by Paperclip's heartbeat-driven runtime)
- `apps/api/src/agents/runs.ts` + `AgentRun` model (Paperclip owns this concept now)
- `apps/api/src/agents/approvals.ts` (Paperclip has its own approval primitives)
- `apps/api/src/routines/*` (Paperclip has routines)
- `apps/api/src/lib/ai.ts` + OpenRouter integration (Paperclip uses CLI subprocesses; we lose direct AI SDK control)
- `AgentRun.contextSnapshot` deterministic pattern (different programming model)
- Per-agent OpenRouter model selection (Paperclip picks CLI, not model — major capability loss)
- `BullMQDispatcher` + dispatcher coalescing (Paperclip's heartbeat scheduler replaces this)

**What we GAIN by going Paperclip:**

- Multi-Company governance UI for free (Paperclip's dashboard)
- Plugin distribution narrative — we ship as `@qolmeia/plugin` on npm
- Heartbeat + ticketing model (instead of building our own)
- Paperclip's operator audit trail + cost rollup
- Less code we own forever

**What we LOSE by going Paperclip:**

- Sub-second turn latency potential (CLI subprocess cold start is 5-30s per message)
- OpenRouter + per-agent model selection (Paperclip uses CLI adapters, not models)
- Nano Banana Pro (would have to be invoked from inside a CLI subprocess; awkward)
- Deterministic AgentRun pattern
- Independence from Paperclip's alpha plugin runtime (they say "expect breaking changes")
- Direct AI SDK control over generation parameters, tools, streaming

---

## 4. Side-by-side

| Axis                                   | Path A — Native                       | Path B — Paperclip plugin                    |
| -------------------------------------- | ------------------------------------- | -------------------------------------------- |
| Time to working onboarding flow        | ~3 weeks                              | ~3 weeks                                     |
| Code thrown away                       | None                                  | ~50% of `apps/api`                           |
| Tests retained                         | 557 → ~700                            | 557 → ~300 (after porting)                   |
| Per-agent model selection (OpenRouter) | ✅ Keep                               | ❌ Lose (CLI-bound)                          |
| Nano Banana Pro image gen              | ✅ Keep                               | ⚠️ Awkward (via CLI tool)                    |
| Turn latency floor                     | Sub-second possible                   | 5-30s (CLI subprocess)                       |
| Multi-Company governance UI            | Build (~5 days extra)                 | Free (Paperclip's dashboard)                 |
| Multi-channel inbound                  | Mostly built; +Slack/Discord adapters | Same; just inside plugin                     |
| Approval queue UI                      | ✅ Already built (schema-driven)      | Need to translate to Paperclip's primitives  |
| ActivityLog                            | ✅ Already built                      | Need translation layer from Paperclip events |
| Customer surface (chat UI)             | ✅ Already built                      | ✅ Already built (stays)                     |
| External dependency on alpha runtime   | None                                  | Yes (Paperclip plugin runtime is alpha)      |
| Operator buys: "self-hostable"         | Yes                                   | Yes (Paperclip is self-hostable)             |
| Operator buys: "hosted SaaS"           | Easy                                  | Possible but Paperclip-shaped                |
| Plugin distribution model              | None                                  | Built-in (npm package)                       |
| Cost per Telegram turn                 | Low (one AI SDK call)                 | Higher (CLI cold start every message)        |

---

## 5. Recommendation: Path A (Native), with selective Paperclip-inspired patterns

### Why

1. **We've already paid the runtime cost.** The agent loop, AgentRun, approvals, routines, ActivityLog, ConnectorAdapter — all working, all tested, all extensible. The pull toward Paperclip is real, but it's the pull of "starting from zero." We're not at zero.

2. **The unique features the customer experience needs are 3 weeks of additive work.** Onboarding planner, Correspondent memory, Team builder, Slack/Discord adapters — these are NEW code, not REPLACEMENT code. They slot into seams we already shipped (`AgentTemplate`, `ConnectorAdapter`, `Skill`, the runtime).

3. **OpenRouter + Nano Banana Pro is a real competitive advantage.** Paperclip can't easily do per-agent model selection because it picks CLI adapters (Claude Code, Codex CLI) and the CLI owns model choice. We can give the Correspondent gpt-5.3-chat, the Designer gpt-5.4-nano, the image skill Nano Banana Pro. Customers who care about chat UX will feel this.

4. **Turn latency matters for the Correspondent.** The customer is conversational. CLI subprocess cold starts (5-30s) are too slow for "how's the campaign going?". Our AI SDK path is sub-second to few-second.

5. **The Paperclip plugin runtime is alpha.** They explicitly say "expect breaking changes between releases; pin your version." For a product going to market, that's a real coupling cost.

6. **We can borrow Paperclip's good ideas without adopting their runtime.** Heartbeats → already in our Routines (timer-based; add event-based in step 7 above). Ticketing → already in `AgentAction` (just add a UI surface). Multi-Company → already in our schema (`Organization` is multi-tenant; rename to `Company`).

### Where Paperclip-thinking still wins

Two ideas we should steal from Paperclip without adopting their substrate:

- **The "managed agents" concept as a customer onboarding affordance.** In Paperclip the operator approves hires from a catalog. We should do the same: the planner suggests, the customer toggles, the system instantiates. This is step 3 in the native roadmap (Team builder).

- **Routines paused-by-default + owner-enables.** This is already our pattern (we explicitly copied it). Confirms the design.

### What changes my recommendation

I'd flip to Path B if:

- **Sub-second turn latency is irrelevant.** If the product is shaped more like "the AI works overnight, the customer sees results in the morning," then Paperclip's heavyweight per-turn model is fine and the governance UI is free.
- **We want to ship on the Paperclip marketplace.** If "plug into someone's existing Paperclip install" is the GTM, we go plugin.
- **Building a multi-Company operator dashboard turns out to be 10+ days of work.** It probably isn't — we have most of it in the backoffice — but if discovery shows it's heavier than expected, the Paperclip dashboard becomes attractive.

If none of those flip, native wins.

---

## 6. Concrete roadmap (recommended path)

**Sprint 1 (week 1) — Company concept + onboarding planner**

- Rename `Organization` → `Company` (one migration + grep)
- New `OnboardingSession` model
- New `planner` agent template + `suggestTeam` skill
- Backoffice `/onboard/[companyId]` wizard

**Sprint 2 (week 2) — Correspondent + Team builder**

- Rename `Controller` → `Correspondent` (template + UI strings; no code rewrite)
- New `AgentMemory` model + `recallMemory` + `rememberFact` skills
- `AgentTemplate.kind = "core" | "optional"` + 3-5 new optional templates (support, sales, analyst, content)
- Backoffice `/team` gains agent-toggle UI
- Cross-agent connector sharing (`messageOnConnector` skill)

**Sprint 3 (week 3) — Multi-channel + polish**

- Slack adapter + Discord adapter (`apps/api/src/connectors/{slack,discord}/adapter.ts`)
- Audio input wired through multimodal Gemini (no separate transcription skill)
- Event-triggered routines (extend `Routine.trigger` enum)
- End-to-end integration test: new Company → onboarding → team pick → first Telegram message → Correspondent reply
- Doc refresh

**At the end of week 3:**

- A customer can sign up, get debriefed by the planner, pick a team, plug in Slack/Telegram/WhatsApp, and start working with their Correspondent.
- The operator can watch via backoffice, approve risky actions, view ActivityLog, manage routines.
- We're at ~700 tests, 3 apps, zero new external dependencies (other than Slack/Discord SDKs if we use them inside adapters).

---

## 7. The Paperclip-plugin path, if you choose it instead

If after reading this the team still wants Paperclip-as-backoffice:

**Sprint 1 — Plugin shell + skills**

- `@qolmeia/plugin` package with manifest
- Port 7 skills to Paperclip plugin tools
- Plugin webhook routes

**Sprint 2 — Pipeline replacement**

- Strip `agents/runtime.ts`, replace with `ctx.agents.sessions.sendMessage` calls
- Translate Paperclip events → our SSE bus → client
- Move backoffice pages into plugin UI slots

**Sprint 3 — Customer surface + onboarding**

- Onboarding planner as a managed agent
- Team builder via `ctx.agents.managed.reconcile`
- Translation layer for ActivityLog + approvals

**Risks specific to this path:**

- Paperclip's alpha plugin runtime may break our deploy. Pin a version, but breakage on upgrade is likely over the next 6 months.
- CLI subprocess cold start may make the Correspondent feel laggy. Mitigation: stream "thinking..." early, accept the latency.
- We lose per-agent OpenRouter model selection. Mitigation: pick one CLI (Claude Code) for all agents.

---

## 8. Decision criteria for the team

Pick **Path A (native)** if:

- [x] We want sub-few-second turn latency on the Correspondent
- [x] We want to keep per-agent OpenRouter model selection
- [x] We want to keep Nano Banana Pro for image gen
- [x] We value owning the full stack (smaller surface area to audit)
- [x] We don't want to bet on Paperclip's alpha plugin runtime

Pick **Path B (Paperclip plugin)** if:

- [ ] Multi-Company governance UI is the most valuable missing piece AND we don't want to build it
- [ ] Shipping on Paperclip's marketplace is the GTM
- [ ] Heavy turn latency is acceptable (overnight work pattern)
- [ ] We want plugin distribution as the product model
- [ ] We're OK losing direct AI SDK control

Today the boxes lean heavily toward Path A. If next month a customer asks "can you run this on our existing Paperclip install?", we revisit.

---

## 9. The minimal change required to start

Whichever path: **rename `Organization` → `Company`** in one migration. This is free (one Prisma rename + grep+replace + one data migration). It clarifies the entire conceptual frame the team is now working from.

After that, the paths diverge.

---

## References

- Earlier research: `docs/research/2026-05-20-paperclip-and-multica.md` (§5 has the "concepts to replicate" matrix)
- Current architecture: `docs/ARCHITECTURE.md` (post-restructure final review)
- Visual baseline: `docs/architecture/current-state-2026-05-21.md` (Mermaid diagrams)
- Paperclip plugin SDK docs: https://paperclip.ing (the LLM Wiki plugin walkthrough is the best worked example)
