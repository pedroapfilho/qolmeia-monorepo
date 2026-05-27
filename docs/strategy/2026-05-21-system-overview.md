# Qolmeia: System Overview

**Date:** 2026-05-21
**Audience:** Two views — technical (engineers, PMs) and non-technical (sales, customers, investors)
**Status:** Reflects `main` at HEAD `3f6d3b0` (10 PRs merged, 557 tests, 3 apps)

---

# Part 1 — Technical overview

## 1.1 The 30-second version

Qolmeia is a multi-tenant AI agency platform. Each tenant (an `Organization`) hires a team of AI agents that work for them through messaging channels. Three Next.js + Node apps run on top of one Postgres + Redis + R2 + OpenRouter stack. Every inbound message flows through a unified pipeline; every agent invocation produces a replayable `AgentRun`; every notable event lands in a unified `ActivityLog`.

## 1.2 The 3 apps

| App               | Runtime               | Port | Audience                   | What it does                                                                                                     |
| ----------------- | --------------------- | ---- | -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `apps/api`        | Hono on Node 24       | 4000 | All clients (machine + UI) | Inbound webhooks, REST `/api/v1/*`, Better Auth `/api/auth/*`, BullMQ workers (agent runner + routine scheduler) |
| `apps/backoffice` | Next.js 16 App Router | 3000 | Operators (OWNER + STAFF)  | Dashboard for agents, approvals, activity, soul (org-curated context), runs, team management                     |
| `apps/client`     | Next.js 16 App Router | 3001 | Customers (CUSTOMER role)  | Magic-link login, chat home, assets gallery, activity timeline                                                   |

## 1.3 The 6 packages

| Package                   | Purpose                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@repo/auth`              | Better Auth wrapper exporting `createAuth({prisma, secret, resendApiKey})`. Plugins: `username`, `bearer`, `magicLink`. Client at `@repo/auth/client`. |
| `@repo/ui`                | shadcn `base-nova/neutral` + Tailwind v4. Components: button, card, field, input, skeleton, sonner. Hooks: `use-is-mobile`.                            |
| `@repo/transactional`     | React Email templates + Resend senders. Templates: welcome, password reset, sign-up attempt, change email, magic link.                                 |
| `@repo/db`                | Prisma 7 schema (23 models) + singleton client with `@prisma/adapter-pg`.                                                                              |
| `@repo/config-vitest`     | Shared Vitest configs.                                                                                                                                 |
| `@repo/typescript-config` | Shared tsconfig bases.                                                                                                                                 |

## 1.4 The data plane

| Service       | Where                                    | What it stores                                   |
| ------------- | ---------------------------------------- | ------------------------------------------------ |
| Postgres      | Local: docker on `:5436`. Prod: Railway. | All durable data — 23 Prisma models              |
| Redis         | Local: docker on `:6382`. Prod: Railway. | BullMQ queues for agent runs + routine scheduler |
| Cloudflare R2 | `qolmeia` bucket, S3-compatible          | `BrandAsset` binaries + `KnowledgeDoc` markdown  |
| OpenRouter    | https://openrouter.ai/api/v1             | All LLM + image-gen calls, single API key        |

## 1.5 The Prisma schema (23 models, 3 logical groups)

**Auth + tenancy (7 models)**

- `Organization` — the tenant. Carries `businessProfile` (AI-extracted soul JSON), `agentInstructions` + `businessIdea` (owner-curated free text). Every other table scopes by `orgId`.
- `User`, `Session`, `Account`, `Verification`, `RateLimit` — Better Auth tables.
- `OrgMembership { userId, orgId, role: OWNER | STAFF | CUSTOMER }` — the authorization seam. Every protected route resolves OrgMembership before doing work.

**Conversation surface (6 models)**

- `Customer` — a person at an Organization who isn't a User (legacy from when Telegram-only had no auth).
- `Conversation` — one ongoing thread per `(orgId, connectorInstanceId, externalThreadId)`.
- `Message` — inbound + outbound messages. `contentType: TEXT | AUDIO | IMAGE | DOCUMENT`.
- `BrandAsset` — R2-backed visual assets, SHA-256 deduped, metadata for palette/style/typography.
- `KnowledgeDoc` — markdown/text/JSON documents for RAG-style retrieval.
- `WebhookEvent` — dedup table keyed by `(provider, externalId)`.

**Multi-agent core (10 models)**

- `AgentTemplate` — code-defined recipe (`controller`, `marketing-strategist`, `designer`). Fields: `defaultModel` (OpenRouter id), `canDelegateTo` (acyclic graph), `compatibleConnectorTypes`.
- `Skill` — code-defined capability (`extractSoul`, `generateBrandImage`, `delegateToSpecialist`, …). Carries Zod-rendered `parametersJsonSchema`.
- `AgentInstance` — per-`Organization` hired agent. Fields: `mission`, `budgetCents`, `status`, `modelOverride`.
- `AgentSkillEnablement` — join table: which skills are active per AgentInstance.
- `ConnectorInstance` — per-org channel config. `type: TELEGRAM | WHATSAPP | WEB_CHAT | …`, `senderRole: OWNER | CUSTOMER`, `config: Json`.
- `AgentConnectorBinding` — which AgentInstance receives inbound on which ConnectorInstance. `direction: INBOUND | OUTBOUND | BOTH`.
- `AgentRun` — one invocation of an agent. Carries `contextSnapshot` (JSONB, dispatched once at run start → deterministic + replayable). Parent of `AgentAction`s. Has `parentRunId` for delegation chains.
- `AgentAction` — one tool call. Lifecycle: `DRAFTED → AUTO_APPROVED | APPROVED | EDITED → EXECUTED | FAILED` (or `REJECTED`). Tracks `costCents`, `costInputTokens`, `costOutputTokens`.
- `ActivityLog` — append-only timeline. 20 event types across 6 ref types. Best-effort writes (errors swallowed).
- `Routine` — paused-by-default scheduled work via BullMQ JobScheduler.

## 1.6 The unified inbound pipeline

```
[Channel webhook arrives at apps/api]
   │
   ▼
POST /connectors/:type/:connectorInstanceId/webhook
   │
   ▼
Generic route handler (apps/api/src/routes/connectors/index.ts):
   1. Load ConnectorInstance from DB
   2. adapter = getAdapter(ci.type)
   3. await adapter.verifySignature?(headers, body, ci.config)  // optional per adapter
   4. normalized = await adapter.parseInboundPayload(rawBody, ci.config)
   │
   ▼
inbox/pipeline.handleInbound({ connectorInstance, normalizedMessage })
   1. WebhookEvent dedup (provider + externalId)
   2. inbox/ingest.resolveOrgAndConversation → upsert Conversation
   3. Owner-command branch (if senderRole === "OWNER" and parseOwnerCommand matches /instrucoes /ideia /rotinas …) → early return
   4. persistInboundMessage + logActivity(MESSAGE_INBOUND)
   5. processIncomingAttachments (uses NormalizedMessage.attachments — bytes or URL → R2)
   6. inbox/agent-step.runAgentForInbound:
        a. findInboundAgentInstanceForConnector (queries AgentConnectorBinding)
        b. buildContextSnapshot (businessIdea + agentInstructions + businessProfile + recent assets + mission)
        c. createAgentRun (snapshot persisted)
        d. dispatcher.enqueueAndAwait → BullMQ (jobId = inbox:<ci>:<thread>:<msg>)
        e. (in worker) runAgentInstance:
             - openrouter.chat(template.defaultModel || instance.modelOverride)
             - generateText({ tools = enabled skills, stopWhen: stepCountIs(5) })
             - per step.content[]: tool-call → action draft → executeAction → tool-result
             - delegation: skill.execute calls dispatcher.enqueueAndAwait again with parentRunId
        f. finalizeAgentRun (status, cost, finishedAt)
        g. postAgentResult: adapter.sendOutbound({ connectorConfig, threadId, payload: { text, files } })
            + logActivity(MESSAGE_OUTBOUND)
   │
   ▼
[Outbound reply hits the customer's channel]
```

**Key seams:**

- `ConnectorAdapter` interface — every channel is just an implementation
- `runAgentInstance` is the only place the agent loop runs (one entry, many tools)
- `AgentRun.contextSnapshot` is the replayable artifact
- `getAdapter(type)` looks up the adapter at the boundary

## 1.7 The agent runtime in detail

Three templates ship today, each with a different OpenRouter model:

| Template               | `defaultModel`        | Role                                           | Skills                                                                                        |
| ---------------------- | --------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `controller`           | `openai/gpt-5.3-chat` | Talks to owner; routes work; briefing-gatherer | `delegateToSpecialist`, `extractSoul`, `searchKnowledge`, `readKnowledgeDoc`                  |
| `marketing-strategist` | `openai/gpt-5.4-mini` | Drafts campaigns; can delegate down            | `delegateToSpecialist`, `draftMarketingStrategy`, `searchKnowledge`, `readKnowledgeDoc`       |
| `designer`             | `openai/gpt-5.4-nano` | Tool dispatcher for visual work                | `extractSoul`, `labelBrandAsset`, `generateBrandImage`, `searchKnowledge`, `readKnowledgeDoc` |

Image generation: `lib/image-gen.ts` POSTs to OpenRouter's images endpoint with `IMAGE_GEN_MODEL` env var (default: `google/gemini-3-pro-image-preview` — Nano Banana Pro). Env-overridable so ops can swap model IDs without redeploy.

Delegation: `controller.canDelegateTo = ["designer", "marketing-strategist"]`, `marketing-strategist.canDelegateTo = ["designer"]`. Acyclic. Validated at boot.

## 1.8 Approval flow

Rule lives in `apps/api/src/agents/actions.ts`:

```
ownerSide = ConnectorInstance.senderRole === "OWNER"
status = (ownerSide || !skill.requiresApprovalDefault) ? AUTO_APPROVED : DRAFTED
```

Today `generateBrandImage` and `draftMarketingStrategy` have `requiresApprovalDefault: true`. On a CUSTOMER-side connector, those become `DRAFTED` and land in the backoffice approval queue. The schema-driven form at `/approvals/[id]` reads `Skill.parametersJsonSchema` and renders typed inputs.

Programmatic helpers in `apps/api/src/agents/approvals.ts`: `approveAction`, `rejectAction`, `editAction`, `executeApprovedAction`.

## 1.9 Auth + authorization

- **Authentication**: Better Auth at `/api/auth/*`. Email/password for operators (backoffice register). Magic-link for customers (client app). Sessions are cookies; same `BETTER_AUTH_SECRET` across all 3 apps means the cookie is portable.
- **Authorization**: 3 Hono middlewares at the API:
  - `requireStaff` — must have `OrgMembership` with role `OWNER` or `STAFF`. Gates `/api/v1/agents`, `/approvals`, `/soul`, `/team/invite`, etc.
  - `requireCustomer` — must have `OrgMembership` with role `CUSTOMER`. Gates `/api/v1/web-chat/*`.
  - `requireAnyMember` — any role works. Gates `/api/v1/me`.

## 1.10 Activity log (the customer + operator timeline)

20 event types across 6 ref types. Best-effort writes via `apps/api/src/activity/log.ts logActivity`. Pino remains source-of-truth for ops; ActivityLog is the durable counterpart for UIs.

| Category          | Types                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| Message lifecycle | `MESSAGE_INBOUND`, `MESSAGE_OUTBOUND`                                                                       |
| Run lifecycle     | `AGENT_RUN_STARTED`, `AGENT_RUN_FINISHED`, `AGENT_RUN_FAILED`                                               |
| Action lifecycle  | `ACTION_DRAFTED`, `ACTION_APPROVED`, `ACTION_REJECTED`, `ACTION_EDITED`, `ACTION_EXECUTED`, `ACTION_FAILED` |
| Budget            | `BUDGET_WARN_80`, `BUDGET_WARN_100`                                                                         |
| Org curation      | `INSTRUCTIONS_UPDATED`, `BUSINESS_IDEA_UPDATED`, `OWNER_COMMAND`                                            |
| Routine lifecycle | `ROUTINE_TRIGGERED`, `ROUTINE_ENABLED`, `ROUTINE_DISABLED`                                                  |
| Membership        | `MEMBER_INVITED`, `MEMBER_JOINED`                                                                           |

## 1.11 What's missing vs. the agency vision

| Gap                                                                 | What it'd cost                                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Onboarding planner (debriefs new Organizations)                     | New `planner` template + `suggestTeam` skill + backoffice wizard — ~3 days                |
| Correspondent persistent memory                                     | New `AgentMemory` model + `recallMemory`/`rememberFact` skills — ~3 days                  |
| Customer-chosen team builder                                        | `AgentTemplate.kind` field + backoffice toggle UI + 3-5 more optional templates — ~4 days |
| Cross-agent connector sharing (any agent can send on any connector) | New `messageOnConnector` skill — ~2 days                                                  |
| Slack + Discord adapters                                            | `connectors/{slack,discord}/adapter.ts` — ~5 days                                         |
| Audio input via multimodal Gemini                                   | Attach bytes to OpenRouter call — ~2 days                                                 |
| Event-triggered routines                                            | Extend `Routine.trigger` enum — ~2 days                                                   |

**Total to fill the gap: ~3 weeks of additive work.**

---

# Part 2 — Non-technical explanation

## 2.1 The one-line version

**Qolmeia is an AI agency you hire for your business. You message it like a person, and it does the work like a team.**

## 2.2 The slightly longer version (for a customer demo)

Imagine hiring a marketing agency, except instead of a team of humans, you get a team of AI workers. You message them on WhatsApp or Telegram or our web app, say "we need a Black Friday post," and 30 seconds later you have a draft you can approve. Behind the scenes:

- A team member talks to you (we call them your **account manager** internally — the engineers call this the "Correspondent" or "Controller")
- They know your brand: your colors, your tone of voice, your past campaigns
- They route the work to specialists — a **marketing strategist** drafts the copy, a **designer** generates the image
- For anything risky (creating something expensive, sending to a customer), the AI pauses and asks you first
- You see everything that's happening in a dashboard if you want, or just trust the team and review the highlights

Cost-wise: a fraction of a real agency. Always-on, never sleeps, remembers everything.

## 2.3 The plain-language map of the system

Think of the platform as an **office**. The office has:

| Office part                                | Plain-language description                                                                    | Internal name                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| The **front door**                         | How customers reach the office — Telegram, WhatsApp, web app, soon Slack and Discord          | Connectors                                                               |
| The **account manager**                    | The one person each customer talks to. Knows the customer; routes work to specialists         | Correspondent / Controller                                               |
| The **specialists**                        | The marketing strategist, the designer, future support agent, sales agent, etc.               | Agent Templates                                                          |
| The **memory**                             | What the office remembers about each customer's business — brand, voice, past work            | `businessProfile`, `BrandAsset`, `KnowledgeDoc`, `AgentMemory` (planned) |
| The **task list**                          | What the AI is doing right now                                                                | `AgentRun`, `AgentAction`                                                |
| The **approval drawer**                    | Things the AI wants to do but is waiting for the human to say yes                             | `AgentAction.status = DRAFTED`                                           |
| The **activity feed**                      | A live log of everything the office is doing                                                  | `ActivityLog`                                                            |
| The **scheduled work**                     | Recurring things the office does on its own (nightly summary, weekly report)                  | `Routine`                                                                |
| The **owner's office** (you, Pedro + team) | Where the operator sees what's happening, approves the risky stuff, edits memory              | apps/backoffice                                                          |
| The **customer's lobby**                   | Where the business owner sees what's being done for them and chats with their account manager | apps/client                                                              |
| The **machinery**                          | The behind-the-scenes engine that runs everything                                             | apps/api                                                                 |

## 2.4 A day in the life of a customer

Marina runs a hair salon. She signed up for Qolmeia three weeks ago. Here's what a Wednesday looks like:

**9:14 am.** Marina opens WhatsApp, taps her Qolmeia chat. _"Bom dia! Quero um post para a Black Friday."_ (Good morning! I want a Black Friday post.)

**9:14:03 am.** Her account manager (the Correspondent) gets the message. It knows Marina's salon: the brand is warm and welcoming, the colors are mauve and gold, last year's Black Friday post used the phrase "domingão de cabelo" — and it remembers that worked.

**9:14:08 am.** The account manager messages internally: "Marketing, draft a Black Friday post for Marina's salon. Designer, get ready for an image."

**9:14:20 am.** The marketing AI drafts copy. The designer AI generates an image in Marina's brand colors using the most advanced image model available (Nano Banana Pro). The image and the caption come back.

**9:14:35 am.** Because generating images costs money and posts get published, the system pauses and the account manager messages Marina: _"Pronto, Marina! Olha o post — quer que ajuste algo?"_ (Here's the post — want me to tweak anything?) and shows the image + caption.

**9:15.** Marina says _"adoro, pode postar amanhã às 9."_ (love it, schedule for tomorrow at 9.)

**The team logs everything**: Pedro (operator) can later open the backoffice and see exactly what was generated, what it cost, what tool was used. If Marina is unhappy, he can replay the exact context the AI saw.

**The schedule kicks in**: every Monday at 9am, a routine fires that scans new knowledge documents and writes Marina a summary. She didn't ask for it; the office is just doing its job.

## 2.5 What makes Qolmeia different (the pitch)

**1. The customer doesn't have to learn anything new.** They keep using WhatsApp / Telegram / whatever they already use. The AI agency comes to them.

**2. The customer never loses control.** Approval queue catches every risky action. Activity log is the receipt.

**3. The AI remembers.** Every conversation, every brand decision, every past campaign — accumulated, retrieved, applied. (This is the part most AI products skip.)

**4. The team specializes.** Different AI workers for different jobs. Each is optimized — fast cheap ones for routing, smarter ones for strategy, top-of-the-line for images. (This is the part Paperclip and similar tools don't do.)

**5. The operator (us) can audit anything.** Every agent invocation is a replayable `AgentRun`. We can reproduce what happened, why, and what it cost.

## 2.6 Frequently asked questions

**Q: How is this different from ChatGPT?**
A: ChatGPT is a generic chatbot you have to retrain every conversation. Qolmeia is an entire team of AI workers that already know your business and work for you continuously. ChatGPT forgets you closed the tab. Qolmeia remembers your Black Friday post worked last year.

**Q: How is this different from a marketing agency?**
A: A marketing agency takes a week to draft a post. Qolmeia takes 30 seconds. A marketing agency costs R$3–10k/month for a small business. Qolmeia costs roughly the value of the AI tokens consumed (~$10–100/month for typical use).

**Q: What channels can I use?**
A: Today: Telegram, WhatsApp, our web app. Coming: Slack, Discord. The system is designed so adding a new channel is one file.

**Q: What if the AI makes a mistake?**
A: For low-stakes actions (text replies), the AI just sends. For anything that costs money or has external consequences (image generation, posting to social, replying to a customer), it pauses and asks. You approve, reject, or edit before it executes.

**Q: Can my employees use it too?**
A: Yes. Owners invite team members via email. Team members get the same chat surface; the AI knows who's asking and adapts.

**Q: Does it run during the night?**
A: Yes — that's the routines feature. The owner picks which scheduled jobs run (paused by default for safety). Typical example: a Monday-morning content calendar draft.

---

# Part 3 — How to explain it in 30 seconds

> "We're building an AI agency you can hire by the message. You text a virtual account manager on WhatsApp, they understand your business, and a team of AI specialists behind them does the work — drafts copy, designs images, schedules posts. You only review what matters. It costs a fraction of a real agency, never sleeps, and remembers everything. We're not a chatbot — we're a workforce."

## How to explain it in 5 minutes (slide-deck shape)

1. **The problem** — small businesses need marketing, copywriting, customer support, scheduling. They can't afford a real agency. They can't manage AI tools themselves.

2. **The shift** — AI is no longer a single chatbot you query. It's specialists you hire. The bottleneck isn't intelligence anymore — it's orchestration.

3. **Qolmeia** — a multi-tenant platform where each business hires a team of AI agents. They communicate via the messaging channel the business owner already uses. They remember the brand. They ask before acting.

4. **The shape of one conversation** — Marina's Black Friday post (the example in §2.4).

5. **What's already shipped** — three apps, multi-channel inbound (Telegram + WhatsApp + Web Chat live; Slack + Discord next), approval queue, activity log, scheduled routines, per-agent model selection on the best models available (OpenRouter + Nano Banana Pro), 557 tests, fully working end-to-end.

6. **What's next** — onboarding planner, customer-chosen team builder, more channels, multi-agent expansion.

7. **The business** — SaaS, per-organization pricing, self-serve onboarding (planned), operator-staffed for white-glove during MVP. Self-hostable for enterprise.

---

## References for engineers

- Technical deep dive: `docs/ARCHITECTURE.md` (844 lines, 20 sections)
- Visual diagrams: `docs/architecture/current-state-2026-05-21.md` (10 Mermaid diagrams)
- Strategy for the next 3 weeks: `docs/strategy/2026-05-21-paperclip-vs-native.md`
- Original research informing the design: `docs/research/2026-05-20-paperclip-and-multica.md`

## References for non-engineers

- This document
- The customer demo path (§2.4)
- The 30-second pitch (Part 3)
