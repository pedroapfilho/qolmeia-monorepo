# Agent tools & integrations

What the Qolmeia agents can do today, and the integrations worth adding next —
each mapped to the agent(s) that use it. Companion to
[`docs/deploy.md`](./deploy.md).

## Two ways an agent reaches the outside world

1. **Skill** — a code module (`{ id, description, inputSchema, execute }`) in
   `apps/agents/src/skills/`, registered in `skills/registry.ts` `ALL_SKILLS`.
   An agent only gets a skill if its skill set lists the id: the **Correspondent**
   has a hardcoded set (`CORRESPONDENT_SKILLS` in `agents/correspondent.ts`);
   **Workers** get `template.skill_ids` (D1, set via a migration). Adding a tool
   = a new skill file + registry entry + the template/correspondent skill list.
2. **Connector** — an inbound/outbound **channel** (e.g. Telegram today). Configs
   live in the `CONNECTOR_SECRETS` KV namespace and the `connector` table; inbound
   messages arrive via provider webhooks and are routed to the Correspondent.
   Adding a channel = a connector type + webhook handler + KV secret, no per-agent
   skill change.

Outward, hard-to-reverse tools (publishing, sending, spending) should propose a
**gated action** (`require-approval` policy, ADR 0006) rather than firing
directly; deliverables (drafts, images, research) `auto-execute`.

## Current tools (live)

| Tool (skill)                             | What it does                              | External dep                                     | Used by                                                      |
| ---------------------------------------- | ----------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| `webSearch`                              | web search                                | **Exa** (`EXA_API_KEY`)                          | Correspondent, Redator, SEO Researcher, + all workers (0010) |
| `fetchUrl`                               | read a page as markdown                   | **Firecrawl** (`FIRECRAWL_API_KEY` or self-host) | Correspondent + all workers (0010)                           |
| `generateBrandImage`                     | image generation                          | OpenRouter image model                           | Designer                                                     |
| `draftSocialPost`                        | structured post draft (platform/body/CTA) | — (LLM)                                          | Marketing Strategist                                         |
| `listAssets` / `readAsset` / `saveAsset` | the asset library (R2)                    | R2                                               | Correspondent + all workers (0008)                           |
| `rememberFact` / `recallMemory`          | semantic memory                           | Workers AI + Vectorize                           | every agent                                                  |
| `delegateToWorker`                       | spawn a child ticket                      | —                                                | Correspondent                                                |
| `extractBrief` / `proposeTeam`           | onboarding                                | — (LLM)                                          | Planner                                                      |
| `decideAction`                           | resume a gated action                     | —                                                | operator path                                                |

**Inbound channel connector (infra live):** **Telegram** — webhook → Correspondent,
secret in `CONNECTOR_SECRETS` KV.

### Agent → tools today

- **Correspondent** — `rememberFact`, `recallMemory`, `delegateToWorker`,
  `listAssets`, `readAsset`, `saveAsset`, `webSearch`, `fetchUrl`
- **Planner** — `extractBrief`, `proposeTeam` (+ memory)
- **Designer** — `generateBrandImage` + assets + web + memory
- **Marketing Strategist** — `draftSocialPost` + assets + web + memory
- **Redator** — `webSearch`, assets, memory (+ `fetchUrl`)
- **SEO Researcher** — `webSearch`, assets, memory (+ `fetchUrl`)

## Recommended additions

Ordered roughly by value. "Type" is **skill** (agent action) or **connector**
(channel). Publishing/sending ones should be `require-approval`.

| Integration                                           | Value                                                                      | Type      | Agent(s)                                   | Needs                                                 | Gating                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------- | --------- | ------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------- |
| **WhatsApp** (Cloud API / Twilio)                     | the dominant pt-BR customer channel — inbound+outbound chat, like Telegram | connector | Correspondent                              | Meta WhatsApp Business or Twilio creds (KV) + webhook | n/a (channel)                                  |
| **Email send** (`sendEmail`)                          | outbound campaigns / replies; Resend is already wired for transactional    | skill     | Marketing Strategist, Correspondent        | reuse `RESEND_API_KEY` (or per-tenant domain)         | require-approval                               |
| **Instagram / Meta Graph** (`publishPost`)            | actually publish the Strategist's drafts + read reach/insights             | skill     | **Social Media Manager** (new), Strategist | Meta app + per-tenant OAuth token (KV)                | require-approval                               |
| **Gmail / inbound email**                             | treat email as a Correspondent channel (parse + reply)                     | connector | Correspondent                              | Gmail API OAuth or IMAP (KV) + webhook/poll           | n/a                                            |
| **Google Calendar** (`scheduleEvent`)                 | content calendar, go-live dates, reminders                                 | skill     | Planner, Strategist                        | Google OAuth (KV)                                     | notify-only                                    |
| **Google Drive / Sheets**                             | read/write content calendars & long docs beyond the asset library          | skill     | Redator, Strategist                        | Google OAuth (KV)                                     | auto-execute (read) / require-approval (write) |
| **LinkedIn** (`publishPost`)                          | B2B publishing                                                             | skill     | Social Media Manager                       | LinkedIn app + OAuth (KV)                             | require-approval                               |
| **Analytics** (GA4 / Meta Insights) (`readAnalytics`) | close the loop — measure what shipped                                      | skill     | SEO Researcher, Strategist                 | GA4 / Meta tokens (KV)                                | auto-execute                                   |
| **Slack / Discord**                                   | team-channel connector for orgs that live there                            | connector | Correspondent                              | bot token (KV) + webhook                              | n/a                                            |
| **Stock / Canva / Figma**                             | source or templatize visuals                                               | skill     | Designer                                   | provider API key                                      | auto-execute                                   |

### Suggested new agent

- **Social Media Manager** — owns the publishing surface (`publishPost` across
  Instagram/LinkedIn + `scheduleEvent`). Distinct from the **Marketing
  Strategist**, which _drafts_ (`draftSocialPost`); the Manager _ships_ on a
  schedule. Its `publish_post` actions route to the `social` discipline in the
  operator approval queue (ADR 0005 coverage).

## Roadmap: the first non-marketing vertical (Cobrança + Comercial)

Everything above is the **marketing** vertical. Per ADR 0009 the platform is
vertical-agnostic — a new vertical is templates + skills + connectors, not a new
engine. Customer discovery (a coworking operator) ranked **collections,
pre-sales, and a light CRM** far above marketing, with `automação assistida +
aprovação antes de ação sensível` as the gating requirement (already the ADR
0006 loop). This is the first vertical to build out.

### New agents (templates)

- **Agente de Cobrança** (`workerKind: collections`) — open-invoice panel,
  reminders, approved-message follow-up. `defaultActionType:
send_collection_message`, `default_policies: { send_collection_message:
require-approval }`.
- **Agente Comercial / Pré-atendimento** (`workerKind: sales`) — leads,
  orçamentos, retornos, follow-up; acts as the light CRM's system of record.

### New skills

| Skill                      | What it does                            | Type  | Agent     | Gating        |
| -------------------------- | --------------------------------------- | ----- | --------- | ------------- |
| `listOpenInvoices`         | read cobranças em aberto (synced)       | skill | Cobrança  | auto-execute  |
| `draftCollectionReminder`  | draft an approved-tone cobrança message | skill | Cobrança  | — (LLM draft) |
| `scheduleFollowUp`         | queue the next cobrança touch           | skill | Cobrança  | notify-only   |
| `createLead` / `listLeads` | CRM lead capture + listing              | skill | Comercial | auto-execute  |
| `draftQuote`               | draft an orçamento                      | skill | Comercial | — (LLM draft) |
| `logInteraction`           | record a commercial touch               | skill | Comercial | auto-execute  |

### New connectors (the gating dependency)

| Connector                     | Why                                                          | Needs                                       | Gating           |
| ----------------------------- | ------------------------------------------------------------ | ------------------------------------------- | ---------------- |
| **WhatsApp** (Cloud API)      | dominant pt-BR channel — outbound cobrança + pré-atendimento | Meta WhatsApp Business creds (KV) + webhook | n/a (channel)    |
| **Financial system** (Conexa) | read open invoices + client list (complement, not replace)   | provider API creds (KV)                     | auto (read)      |
| **NF / prefeitura**           | emissão de nota fiscal — high-trust, later                   | municipal integration creds (KV)            | require-approval |

### Smallest slice that proves the model

WhatsApp **outbound** + `listOpenInvoices` (manual sync to start) +
`draftCollectionReminder` + a `send_collection_message` action type/renderer +
one Agente de Cobrança template. Exercises every new layer end-to-end while
reusing the entire approval engine; matches the customer's willingness-to-pay
(R$150 for cobrança + pré-atendimento). Reporting (cobranças em aberto / vendas
/ DRE) and modular entitlements (ADR 0009) follow.

### Document previews — Extend UI (deferred to this vertical)

[Extend UI](https://www.extend.ai/ui/docs) (MIT, shadcn copy-in) is the chosen
viewer stack for when Cobrança produces **documents** — boletos / NF (PDF) and a
DRE (XLSX). Deferred until then because today's deliverables are only images +
markdown; the viewers would ship heavy and idle. Integration notes from a
spike (2026-06-19):

- **Do NOT use `npx shadcn add @extend/<name>`.** Even with `--yes` it stops on
  an interactive "overwrite button.tsx?" prompt and wants to clobber our
  customized `@repo/ui` primitives. Copy the registry JSON's source in by hand
  instead.
- Each viewer pulls a heavy renderer (`csv-viewer` → `@glideapps/glide-data-grid`
  - `papaparse`; PDF → pdf.js; XLSX → sheetjs) and **Hugeicons** — swap those to
    **lucide** to match our `iconLibrary`. Register the namespace with
    `"registries": { "@extend": "https://www.extend.ai/ui/r/{name}.json" }` in
    `packages/ui/components.json`.
- `csv-viewer` also needs 5 primitives we don't have yet (`popover`, `select`,
  `separator`, `spinner`, `tooltip`) — add them from the `base-nova` registry
  (they don't exist, so no overwrite prompt).
- Wire a `mime → viewer` dispatcher + a preview dialog into the Assets gallery,
  behind `next/dynamic` so the renderers stay out of the main bundle.

## How to wire a new one (checklist)

**Skill:** create `src/skills/<name>.ts` (`{ id, description, inputSchema,
execute }`) → add to `ALL_SKILLS` in `registry.ts` → add the id to the relevant
template `skill_ids` (new migration) and/or `CORRESPONDENT_SKILLS` → declare any
secret in `env.d.ts` + `wrangler secret put` + `docs/deploy.md` → if it's an
outward action, give the template a `default_policies` entry so it's gated.

**Connector:** add the connector type + webhook route → store per-tenant secret
in `CONNECTOR_SECRETS` KV → route inbound messages to the Correspondent DO.

Per-tenant credentials (OAuth tokens, channel secrets) belong in
`CONNECTOR_SECRETS` KV keyed by company id — never in env vars or D1.
