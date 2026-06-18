# Qolmeia

An AI marketing agency: each customer company gets a Team of AI agents that does marketing work, with human operators approving sensitive actions before they ship.

## Language

### Actors

**Company**:
A customer tenant. Its id (`companyId`) is the unit of isolation **for the customer surface** — the `/agents/<name>/<companyId>` and `/api/me/*` paths authorize `companyId` against the session and never trust it from the URL (ADR 0001). It is also the Durable Object instance id every agent is keyed by. Operators are cross-tenant and reach any Company by role, not by membership (ADR 0005).
_Avoid_: org, tenant, client

**Account**:
A login that belongs to a Company (the `CUSTOMER` role). A Company has one or more Accounts; they all share the Company's surface and agents.
_Avoid_: user, seat

**Customer**:
The role of an Account — an end-user of a Company who chats with its agents. Used for the human; **Account** is the login record.
_Avoid_: user, end user

**Operator**:
Qolmeia platform staff who vet AI prompts and results — the human quality layer, and the product's differentiator. The `OWNER`/`STAFF` members of the single internal **Qolmeia org**; they belong to no customer Company and are authorized by role, acting on any Company through backoffice REST (never an agent connection). An Operator may have optional assigned Companies and disciplines (ADR 0005).
_Avoid_: admin, moderator, customer

**Assignment**:
The optional link from an Operator to the Companies and disciplines they cover, used to route the approval queue. No assignment means the Operator sees everything.
_Avoid_: scope, permission

**Discipline**:
The kind of work an Action represents (`design`, `copy`, `strategy`, `social`…), derived from the producing agent's `worker_kind`. Routes an Action to the Operator who reviews that craft.
_Avoid_: category, tag, type, skill

### Agents

**Correspondent**:
The single point of contact for a Company, one per Company. Talks to the Customer, delegates specialist work, and presents finished deliverables back in chat.
_Avoid_: assistant, bot, concierge

**Planner**:
The onboarding-interview agent that runs before a Team exists: it debriefs the Company and proposes a Team.
_Avoid_: onboarder, setup agent

**Worker**:
A specialist agent instantiated from a Template (e.g. Designer, Marketing Strategist) that produces a specific kind of deliverable.
_Avoid_: specialist bot, sub-agent

**Team**:
The confirmed set of agents (one Correspondent + its Workers) for a Company. Materialized when the Customer confirms during onboarding.

### Work

**Brief**:
The structured profile of a Company's business: industry, primary goal, audience, channels, and brand (voice, palette, references). Drives what the agents produce; "complete" means all of those are filled. A selected **channel** carries its URL (a bare checkbox without the link is meaningless).
_Avoid_: profile, questionnaire

**Ticket**:
A unit of delegated work the Correspondent hands to a Worker; tracked through `in_progress` → `awaiting_approval` → `done`.
_Avoid_: task, job

**Action**:
A side-effect a Worker proposes (e.g. publish a post). Distinct from a Ticket: the Ticket is the work, the Action is the effect. Its **Policy** decides whether it executes freely, runs-and-notifies, or blocks for an Operator (ADR 0006).
_Avoid_: approval, request

**Deliverable**:
The artifact a Worker produces — a generated image, copy, a research brief. Deliverables `auto-execute` straight to the customer / asset library; only impactful Actions are gated.
_Avoid_: output, result, asset

**Policy**:
The gating tier of an Action, declared per action-type on the producing template: `auto-execute` (runs silently), `notify-only` (runs immediately but surfaces to an Operator feed for spot-check), `require-approval` (blocks until an Operator decides). Only outward, hard-to-reverse Actions get `require-approval`.
_Avoid_: rule, permission, gate

**Decision**:
An Operator's verdict on a gated Action: **approve** (it executes), **reject** (the Ticket ends), or **request-changes** (a revise loop — the feedback returns to the Worker, which regenerates and re-proposes; they iterate until approve or reject). The customer sees only the final approved Deliverable.
_Avoid_: review, vote, outcome

### Storage

**Library**:
A Company's files in R2, split into two **folders**: the **customer folder** (visible to the customer and the agents — finished work + the customer's uploads, including a `brand/` subfolder for brand identity) and the **agent folder** (agent-only working material — scrapes, drafts). An asset's `visibility` (`customer`/`agent`) decides which folder it lives in (ADR 0007).
_Avoid_: assets, files, bucket

**Memory**:
The agent's semantic recall of important facts — saved on purpose with `rememberFact`, retrieved with `recallMemory`, backed by Cloudflare Vectorize. Distinct from the **Library**: a fact is not a file.
_Avoid_: knowledge base, context, RAG
