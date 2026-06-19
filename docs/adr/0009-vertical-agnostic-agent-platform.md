# Qolmeia is a vertical-agnostic agent platform; a vertical = templates + skills + connectors; marketing is just the first one

The product was built as an "AI marketing agency." A customer-discovery session with a coworking operator (Multi.Spaço) wanted almost none of the marketing surface — their ranked needs were collections (cobrança), pre-sales attendance (pré-atendimento), and a lightweight CRM, with "redes sociais" dead last. The principal dor was financial follow-up: "não deixe dinheiro na mesa." This forces the question of whether marketing is _the product_ or _the first vertical_.

**Decision:** marketing is the first vertical, not the product. The orchestration core is domain-neutral and stays that way; a new vertical is added as **data + a few code modules + connectors**, never by forking the engine.

## What a vertical is (the contract)

A vertical plugs in through the existing seams — no change to the Planner→Correspondent→Worker→Workflow→approval pipeline:

- **Templates** (D1 `template` rows, `db/template.ts`) — one per agent role. The vertical-specific fields are `workerKind`, `skillIds`, `systemPrompt`, `defaultActionType`, and `defaultPolicies`. `proposeTeam` already lists the live catalog, so a confirmed template set surfaces in onboarding automatically.
- **Deliverable skills** (code modules in `ALL_SKILLS`, `skills/registry.ts`, + a D1 `skill` overlay row) — the domain verbs. Marketing ships `generateBrandImage` / `draftSocialPost`; a collections vertical adds e.g. `listOpenInvoices` / `draftCollectionReminder`.
- **Connectors** (`CONNECTOR_SECRETS` KV + `connector` table) — the channels and external systems the vertical needs (WhatsApp, a financial system, NF/prefeitura), per the Telegram precedent.
- **Action types + a backoffice renderer** (`components/action-renderers/`) — one branch at the `worker-job.ts` propose step (where `publish_post` attaches its draft) plus a card renderer.

## What stays domain-neutral (do not fork)

- The **Worker job loop** (`workflows/worker-job.ts` `run()`): generate → propose `defaultActionType` → gate on `defaultPolicies` → `waitForEvent` → execute. A "draft cobrança → operator approves → send" flow is the same code path as "draft post → approve → publish." The most-validated customer requirement — `automação assistida, aprovação antes de qualquer ação sensível` — is already this loop (ADR 0006), unchanged.
- The **skill registry / overlay** split, **memory**, **asset library**, **operator coverage** (ADR 0005), and **tenant isolation** (ADR 0001) are all vertical-blind.

## What is currently marketing-locked and must generalize

These are the only spots that assume marketing; generalizing them is the cost of the second vertical:

- **Planner prompt** (`agents/planner.ts` `BASE_SYSTEM_PROMPT`) — hardcoded "agência de marketing" and brand-voice discovery. Discovery must become vertical-aware (pick the vertical up front, or branch the debrief).
- **Brief schema** (`lib/company-brief.ts`) — brand-shaped fields. The brief must flex per vertical (superset, or a per-vertical schema).

## New subsystem this implies

- **Modular entitlements.** The discovery session priced by module (R$99–350). A company should only materialise the templates/skills it pays for. There is no billing/entitlement gate today — teams are materialised from the full catalog at confirm time. A per-company module entitlement is a genuinely new concern, gating which templates `proposeTeam` and the confirm step may offer.

## Consequences

- Onboarding a non-marketing customer is **~80% new skills + connectors + template rows, ~20% Planner/brief generalization + entitlements**; the engine doesn't change.
- The roadmap for the first non-marketing vertical (Cobrança + Comercial) and the connectors it needs lives in [`docs/agent-tools.md`](../agent-tools.md).
- "Qolmeia is a marketing agency" stops being load-bearing in copy and prompts; it becomes "Qolmeia runs your repetitive business work with a human approving anything sensitive," with marketing as one team you can hire.
