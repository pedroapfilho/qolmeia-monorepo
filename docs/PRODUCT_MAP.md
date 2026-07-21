# Qolmeia Product Map

Every screen, flow, and feature the platform offers today, plus what it can offer next. Screenshots live in [`docs/product-map/`](product-map/) and were captured from a live local stack (real agents, real deliverable, real approval) on 2026-07-21.

## What Qolmeia is

An AI team as a service for Brazilian small businesses (pt-BR across the whole product). A customer signs up, is interviewed by a Planner agent, confirms a team of AI specialists, and from then on talks to a single Correspondent (account manager) in chat. Specialists (Designer, Marketing Strategist, Redator, Pesquisador SEO) produce real deliverables: brand images, social posts, copy, and research. Every deliverable passes through an internal human approval gate operated from the backoffice before it reaches the customer.

The runtime is Cloudflare-native: per-tenant Durable Object agents, Workflows for the approval lifecycle, D1 as the system of record, R2 for assets, KV for session caching. Auth (Better Auth on Postgres) lives in a separate Hono service.

---

## 1. Customer surface (`apps/client`)

### 1.1 Login (magic link)

Customers sign in with a magic link only; there is no password on this surface. The link arrives by email and lands on `/auth/verify`.

![Client login](product-map/client-login.png)

### 1.2 Onboarding: Planner interview + team confirmation

While `company.status === "onboarding"`, the home screen renders the Planner. It greets automatically (a hidden kickoff prompt), interviews the customer about the business (industry, goal, audience, tone, brand), and fills the company brief incrementally with the `extractBrief` tool. When it calls `proposeTeam`, the footer shows the proposed specialists as selectable cards. "Confirmar Time" materializes the team, flips the company to active, and hands the chat over to the Correspondent.

![Onboarding: planner chat with team proposal](product-map/client-onboarding.png)

### 1.3 Active chat: the Correspondent

The single point of contact. The customer asks for work in natural language; the Correspondent delegates to the right specialist (`delegateToWorker`), keeps per-company memory, searches the web, and reads the asset library. The sidebar shows the live team roster (SSE + polling): here the Designer is already "Aguardando aprovação" seconds after the request.

![Active chat: request delegated to the Designer](product-map/client-chat-active.png)

When the operator approves the deliverable, it lands back in the same conversation automatically, images inline:

![Delivery arriving in chat](product-map/client-chat-delivery.png)

The composer supports text plus image attach/paste (PNG/JPG/WEBP/GIF, up to 10 MB), Enter to send, and status-aware send button (spinner while streaming).

Empty state, before any conversation:

![Empty chat](product-map/client-chat-empty.png)

### 1.4 Empresa: brief, brand kit, and team management

Four sections on one page:

1. **Sobre a empresa**: editable brief (setor, objetivo, público, tom, cores, referências) with a live completeness meter.
2. **Identidade da marca**: brand asset upload by category (logo, post, reference, other). The Designer conditions image generation on these references.
3. **Meu time**: roster cards; workers can be renamed, paused/resumed, and have their prompt customized per instance.
4. **Contratar mais agentes**: the template catalogue with hired counts and a hire dialog (optional custom name).

![Empresa page](product-map/client-empresa.png)

### 1.5 Assets: the company library

Everything the team produced or the customer uploaded: filter chips by kind (Imagens, Documentos, Uploads, Marca, Áudio, Outros), multi-select and bulk delete with confirmation, preview dialog (image, audio, markdown) and download. The generated logo from the flow above shows up here as a `generated_image`.

![Assets gallery with the generated logo](product-map/client-assets.png)

### 1.6 Atividade: transparency feed

A read-only timeline of what the team did (delegations, proposals, approvals, deliveries), pt-BR timestamps.

![Client activity feed](product-map/client-activity.png)

### Customer flow summary

```
magic link -> /auth/verify -> /
  status onboarding: Planner interview -> extractBrief -> proposeTeam -> "Confirmar Time"
     -> POST /api/teams/:companyId/confirm -> team materialized, status active
  status active: Correspondent chat -> delegateToWorker -> ticket + workflow
     -> (internal approval) -> delivery lands in chat -> asset saved to library
```

---

## 2. Operator surface (`apps/backoffice`)

Operators (OWNER/STAFF) use email + password (12+ chars), with register, recover, and reset-password screens. Gating is enforced twice: in Next middleware plus `requireStaff()`, and again by the Worker on every `/api/backoffice/*` call.

![Backoffice login](product-map/backoffice-login.png)

### 2.1 Início: operational overview

Four stat cards (pending approvals with oldest age, open tickets, done this month, active companies), the next approvals, and recent events. Sections degrade independently if one fetch fails.

![Backoffice home](product-map/backoffice-home.png)

### 2.2 Aprovações: the queue

Pending actions oldest-first, filtered by the operator's coverage. The age cell is color-tiered: calm under 1h, warning 1-4h, urgent past 4h. The sidebar badge shows the live pending count.

![Approvals queue](product-map/backoffice-approvals.png)

### 2.3 Revisar ação: proposal + decision

The full proposal (typed renderer for `publish_post`, markdown/JSON fallback otherwise), a context panel (company, agent, ticket, waiting time, policy, brief), and the decision form: **Aprovar** (executes and resumes the workflow), **Pedir ajustes** (sends the deliverable back with feedback, up to 3 revision rounds), **Rejeitar** (ends it). Feedback is required for the last two.

![Approval detail with decide form](product-map/backoffice-approval-detail.png)

### 2.4 Tickets: every unit of work

List plus a detail view with the execution timeline (each action as a step), the deliverable payload, and a link to the related approval.

![Tickets list](product-map/backoffice-tickets.png)

![Ticket detail with execution timeline](product-map/backoffice-ticket-detail.png)

### 2.5 Times: companies and rosters

All companies with status, brief completeness, and their agent rosters. Each member opens an edit screen: rename, per-instance prompt override (with the template default shown for reference), pause/resume, and lifetime stats.

![Teams overview](product-map/backoffice-teams.png)

![Member edit](product-map/backoffice-member-edit.png)

### 2.6 Modelos: the specialist catalog

Full CRUD over worker templates: display name, worker kind, description, system prompt, LLM model, default action type, skill picker (from the 13-skill registry), and per-action-type policies (`auto-execute`, `notify-only`, `require-approval`). Templates can be retired and reactivated. This is the product's authoring surface: a new specialist is data, not code.

![Templates list](product-map/backoffice-templates.png)

![Template editor](product-map/backoffice-template-edit.png)

### 2.7 Atividade and Cobertura

The full cross-company activity log with category filter chips (Tudo, ACTION, TICKET, WORKER, TEAM, MEMBER; the filter lives in the URL) and cursor pagination, and the coverage screen where each operator picks which companies and disciplines they review (empty selection means the whole queue).

![Backoffice activity log](product-map/backoffice-activity.png)

![Coverage settings](product-map/backoffice-cobertura.png)

### Operator flow summary

```
login -> Início -> Aprovações (coverage-filtered, oldest first)
  -> Revisar ação -> Aprovar | Pedir ajustes (feedback) | Rejeitar
  -> POST /api/backoffice/actions/:id/decide -> workflow resumes
approve  -> action executed, ticket done, delivery pushed to customer chat
adjust   -> worker revises with feedback (max 3 rounds)
reject   -> ticket rejected, customer notified via chat
```

---

## 3. The engine (`apps/agents` + `apps/api`)

### 3.1 Agents (Durable Objects, one per company)

| Agent | Role | Tools |
|---|---|---|
| **Planner** | Onboarding interview; stays in standby for re-planning | `extractBrief`, `proposeTeam` |
| **Correspondent** | Single point of contact; delegates, remembers, researches | `rememberFact`, `recallMemory`, `delegateToWorker`, `extractBrief`, `listAssets`, `readAsset`, `saveAsset`, `webSearch`, `fetchUrl` |
| **Worker** | Template-driven specialist; prompt = template + per-instance override | the template's `skillIds` |

### 3.2 The 13 skills

| Skill | What it gives the customer |
|---|---|
| `rememberFact` / `recallMemory` | Per-company semantic memory across conversations |
| `delegateToWorker` | Work routed to the right specialist as a tracked ticket |
| `generateBrandImage` | Images conditioned on up to 3 brand references, stored in R2, signed URLs |
| `draftSocialPost` | Structured post drafts (platform, body, CTA, hashtags, tone) |
| `extractBrief` | The brief fills itself from conversation |
| `proposeTeam` | Team recommendations grounded in the brief |
| `listAssets` / `readAsset` / `saveAsset` | Agents read and write the company library |
| `webSearch` (Exa) / `fetchUrl` (Firecrawl) | Fresh research with sources |
| `decideAction` | Approve/reject from chat. Fully built, currently assigned to no agent |

### 3.3 Approval lifecycle (`WorkerJobWorkflow`)

Every delegation spawns a Cloudflare Workflow: generate the deliverable (LLM + skills, up to 5 steps), then check the template's policy for the action type.

- `require-approval` (the default and the only policy shipped templates use): propose the action, set the ticket to `awaiting_approval`, and pause on `waitForEvent("decision:<id>")` for up to 60 days.
- `approved`: execute, mark the ticket done, push the result into the customer chat.
- `changes_requested`: loop back with feedback, at most 3 revision rounds.
- `rejected`: end the ticket.
- `auto-execute` / `notify-only`: skip the gate entirely. Implemented and reachable from the template editor, unused by shipped templates.

### 3.4 Data model (D1)

`company`, `agent_instance`, `template`, `skill` (overlay: enable/disable, description and param hints), `company_template_entitlement`, `team`, `team_member` (with a cycle-checked `can_delegate_to` graph), `ticket`, `action`, `activity_log`, `memory_fact`, `operator_assignment`, `asset` (kinds: `generated_image`, `knowledge_doc`, `audio`, `brand_asset`, `user_upload`; customer/agent visibility; sha256 dedup).

### 3.5 Auth and tenancy

Better Auth (magic link, email + password, verification, reset, change-email, username, bearer tokens) on Postgres. Roles: OWNER, STAFF, CUSTOMER. The Postgres organization id is reused verbatim as the D1 company id, so a user's org role directly gates the Worker surfaces. The agents Worker validates sessions by relaying to `/api/me` with a 60s KV cache.

---

## 4. What we can offer customers

### Offered today

1. An AI account manager in chat with memory, web research, and full context on the company.
2. Guided onboarding that produces a structured business brief and a working team in minutes.
3. Human-reviewed deliverables in chat: brand images, social post drafts, copy, SEO and content research.
4. Self-serve team management: hire, rename, pause, and customize each specialist's prompt.
5. A brand kit and asset library the team both reads from and delivers into.
6. Full transparency: activity feed and live team status.

### Built but unsurfaced (cheapest wins first)

1. **Approvals from chat**: `decideAction` is complete and registered; it just is not assigned to any agent. Turning it on is a product decision plus one line in the Correspondent's skill list.
2. **Trusted fast lane**: `auto-execute` and `notify-only` policies work end to end; the template editor already exposes the knob. Offer faster turnaround on low-risk work.
3. **New verticals as pure data**: Cobrança and Comercial (per [`docs/agent-tools.md`](agent-tools.md)) need new skills and templates only, no engine change.
4. **Team re-planning**: the Planner stays alive per company with a working chat route; it needs a UI entry point ("quero replanejar meu time").
5. **Image controls**: `generateBrandImage` supports 1:1, 16:9, 4:3, and 9:16 plus reference selection; none of it is exposed in the chat UI.
6. **Scheduled work as tickets**: the schema supports `origin='scheduled'`; today the weekly proactive sweep only sends a chat nudge.

### Documented roadmap (no code yet)

WhatsApp, Gmail, and Slack connectors; real social publishing (Instagram/LinkedIn/Meta Graph); transactional email sending; calendar scheduling; Google Drive/Sheets; analytics; a Social Media Manager agent; the Cobrança vertical (`listOpenInvoices`, `draftCollectionReminder`) and Comercial vertical (`createLead`). See [`docs/agent-tools.md`](agent-tools.md).

---

## Appendix: how the screenshots were made

Local stack (Postgres + auth API + agents Worker + both Next apps) with the seeded dev org. The flow captured is real end to end: the customer asked the Correspondent for a logo, the Correspondent delegated to the Designer, the Designer generated the image through OpenRouter and proposed the deliverable, the operator approved it in the backoffice, the workflow executed, and the delivery landed in the customer chat and asset library. The onboarding screenshot was taken by temporarily setting the seeded company back to `onboarding`.
