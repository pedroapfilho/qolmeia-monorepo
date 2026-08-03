# Qolmeia Feature Catalog

Canonical inventory of features implemented in the current codebase. For screenshots and the
end-to-end product walkthrough, see [`PRODUCT_MAP.md`](PRODUCT_MAP.md). For implementation details,
see [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Status vocabulary

- **Shipped**: available through the customer or operator UI.
- **Platform**: implemented and used by the product, but not necessarily visible as its own screen.
- **Configurable**: implemented end to end, but disabled or unused by the default product setup.
- **Not shipped**: documented here only to make the product boundary explicit.

## 1. Customer experience

### 1.1 Access and authentication

- **Magic-link sign-in** for customers, with email delivery through Resend in configured
  environments and link logging in local development.
- **Email verification callback** at `/auth/verify`, including safe callback-path validation.
- **Role-aware access**: only `CUSTOMER` memberships enter the client app; other roles are sent to
  a no-access screen.
- **Persistent sessions** backed by Postgres, with secure, HTTP-only cookies and a short-lived
  session cache.
- **Sign out**, error, not-found, loading, and no-access states in pt-BR.

### 1.2 Guided onboarding

- A **Planner** greets a new customer and interviews them one question at a time about their
  industry, goal, audience, channels, voice, colors, and references.
- The Planner updates the structured company brief incrementally with `extractBrief`.
- The brief has a **completeness score** so the product can show what information is still missing.
- `proposeTeam` recommends specialists from templates the company is entitled to use.
- The customer can select the proposed specialists and confirm with **Confirmar Time**.
- Confirmation creates the team and its specialist instances, activates the company, records the
  event, and seeds the Correspondent's memory from the brief.
- After confirmation, the same home route switches from the Planner to the Correspondent.

### 1.3 Correspondent chat

- A single **Correspondent** is the customer's account manager and point of contact.
- Conversation is delivered over **HTTP + Server-Sent Events**, with durable history, replay from
  checkpoints, reconnect support, and optimistic message reconciliation.
- Responses render Markdown, links, lists, and inline images.
- The composer supports text, Enter-to-send, Shift+Enter for a new line, an auto-growing text area,
  and visible submitted/streaming/error states.
- Customers can attach or paste PNG, JPG, WEBP, and GIF images up to 10 MB. Upload progress,
  removal, validation, and failure feedback are built in.
- The Correspondent can remember facts, recall semantic memory, update the company brief, search
  the web, read pages, inspect the asset library, save files, and delegate work.
- Delegated work appears in the **live team sidebar**. Roster and ticket state update through SSE,
  with polling as a fallback.
- Approved or automatically completed specialist work returns to the same conversation through an
  internal signal. The internal delivery prompt is hidden from the customer transcript.
- Generated images are rendered inline and also stored in the asset library.

### 1.4 Company profile and brand kit

The **Empresa** screen combines four self-service areas:

1. **Company brief**: edit industry, main goal, target audience, brand voice, colors, and references;
   see the completeness meter update with the saved data.
2. **Brand kit**: upload and remove logo, post, reference, or other brand images. PNG, JPG, WEBP,
   GIF, and SVG are accepted up to 10 MB.
3. **My team**: inspect the roster and current status, add or clear a custom prompt, and pause or
   resume worker specialists.
4. **Hire specialists**: browse entitled active templates, see existing hire counts, and hire another
   instance with an optional custom name.

Team changes emit live roster events and are recorded in the activity log. The Correspondent and
Planner are protected from customer pause operations so the core experience remains reachable.

### 1.5 Asset library

- Lists customer-visible files produced by agents or uploaded by the customer, newest first.
- Supports generated images, knowledge documents, user uploads, brand assets, audio, and unknown
  future kinds.
- Filter chips are generated from the kinds currently present in the library.
- Preview support covers images, audio, Markdown, plain text, and JSON. Other file types remain
  downloadable.
- Single-select, select-all, single delete, and bulk delete are available with destructive-action
  confirmation.
- Downloads use expiring HMAC-signed URLs; R2 objects are private and SVG responses are sandboxed.
- Uploads are deduplicated per company by SHA-256.

### 1.6 Customer activity

- Read-only, company-scoped timeline of team, ticket, worker, and approval events.
- Human-readable pt-BR labels and timestamps.
- Records onboarding confirmation, delegation, pending approvals, revisions, execution, rejection,
  team changes, and proactive suggestions.

## 2. Operator experience

### 2.1 Operator access

- Email-and-password registration and sign-in with a 12-character minimum password.
- Email verification, password recovery, and password reset flows.
- Transactional emails for welcome/verification, magic link, password reset, change-email
  confirmation, and attempted duplicate registration.
- Only `OWNER` and `STAFF` memberships can enter the backoffice or call operator APIs. The UI guard
  and Worker API enforce the role independently.

### 2.2 Operational home

- Summary cards for pending approvals, age of the oldest pending item, open tickets, completed work
  in the current month, and active companies.
- Short lists of the next approvals and recent activity.
- Independent loading and failure boundaries keep one failed data source from hiding the rest of
  the dashboard.

### 2.3 Approval queue and review

- Pending actions are ordered oldest first and filtered by the signed-in operator's coverage.
- Live pending-count badge in the backoffice navigation.
- Waiting time is classified as calm, warning, or urgent, with both text and color cues.
- Review detail includes the company, specialist, ticket, brief, policy, waiting time, and proposed
  deliverable.
- `publish_post` proposals have a typed social-post renderer; other payloads fall back to Markdown
  or structured JSON.
- Operators can **approve**, **request changes**, or **reject**.
- Feedback is required when requesting changes or rejecting, and is limited to 2,000 characters.
- A decision resumes the exact Cloudflare Workflow that proposed the action.
- Requesting changes regenerates the deliverable with the prior result and operator feedback. The
  loop is capped at three revisions.
- Approving marks the action executed and ticket done, then delivers the result to the customer.
- Rejecting closes the ticket as rejected.

### 2.4 Tickets

- Cross-company list of every delegated unit of work with title, company, specialist, status, and
  last update.
- Detail view with original brief, result payload, workflow identity, related actions, and an
  execution timeline.
- Ticket states cover open, in progress, awaiting approval, done, rejected, cancelled, and blocked.
- Operator API filters support company, status, and bounded result limits.

### 2.5 Companies and teams

- Cross-company overview with company status, brief completeness, and complete team rosters.
- Member detail shows template identity, current/default prompt, status, and lifetime work stats.
- Operators can rename a worker, set or clear its per-instance prompt, and pause or resume it.
- Changes are company-scoped, logged, and pushed to the customer's live roster.

### 2.6 Specialist templates

- List active and retired specialist templates.
- Create and edit templates without adding application code.
- Configure display name, worker kind, description, system prompt, model, default action type,
  available skills, and per-action policy.
- Policies available in the editor: `require-approval`, `auto-execute`, and `notify-only`.
- Retire and reactivate templates while preserving existing specialist instances.
- Skill selections are validated against the code registry; unknown tools cannot be saved.
- Company entitlements control which active templates customers can see and hire.

### 2.7 Activity and coverage

- Cross-company activity log with URL-backed category filters for actions, tickets, workers, teams,
  and members.
- Cursor-style older-event loading and server-side time/category/company filters.
- Each operator can limit their queue to specific companies, disciplines, or both.
- Empty coverage means access to the entire approval queue.

## 3. Agent and automation platform

### 3.1 Agent roles

| Role              | Runtime                                                 | Capability                                                                                                                      |
| ----------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Planner**       | One Flue 2 Durable Object per company                   | Interviews the customer, maintains the brief, and proposes the initial team.                                                    |
| **Correspondent** | One Flue 2 Durable Object per company                   | Holds the customer conversation, remembers context, researches, manages assets, and delegates.                                  |
| **Specialist**    | Template-driven generation inside a Cloudflare Workflow | Produces a bounded deliverable using its model, prompt, and allowed skills. It is not a separate conversational Durable Object. |

Agent routes preserve one tenant identity per company. Renamed V2 Durable Object classes isolate the
Flue 2 storage schema from retired beta agent storage.

### 3.2 Default specialist catalog

| Specialist               | Shipped capability                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Designer**             | Creates brand-aligned images and visual directions; can save SVG/text deliverables and use brand references.                       |
| **Marketing Strategist** | Produces structured social drafts for Instagram, Facebook, LinkedIn, and other platforms, including copy, CTA, hashtags, and tone. |
| **Redator**              | Writes brand-voice captions, emails, blog articles, and ads; researches facts and saves 2–3 variants.                              |
| **Pesquisador SEO**      | Researches keywords, competitors, and trends; produces sourced, actionable content briefs.                                         |

Templates are data: each one selects an OpenRouter model, system prompt, skill set, action type, and
approval policy. A customer can hire multiple instances of the same template.

### 3.3 Skill catalog

There are 13 registered skills:

| Skill                | Capability                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `rememberFact`       | Persists an agent-scoped fact and adds it to semantic memory.                                                            |
| `recallMemory`       | Retrieves the most relevant remembered facts for a query.                                                                |
| `delegateToWorker`   | Selects an allowed active specialist, creates a ticket, and starts its Workflow.                                         |
| `generateBrandImage` | Generates an image through OpenRouter, conditioned on up to three recent non-SVG brand references, then stores it in R2. |
| `draftSocialPost`    | Produces a structured social post with platform, body, CTA, hashtags, and tone.                                          |
| `decideAction`       | Sends an approval decision event to a waiting Workflow; implemented but not assigned to a customer-facing agent.         |
| `extractBrief`       | Validates and merges partial company-brief information.                                                                  |
| `proposeTeam`        | Recommends entitled active specialist templates from the brief.                                                          |
| `listAssets`         | Lists the company's agent-readable assets.                                                                               |
| `readAsset`          | Reads a selected company asset.                                                                                          |
| `saveAsset`          | Saves a generated document or file to the company library.                                                               |
| `webSearch`          | Searches the live web through Exa and returns sources.                                                                   |
| `fetchUrl`           | Fetches and converts a page through Firecrawl for deeper reading.                                                        |

Database overlays can change a skill description or disable it. Flue agents refresh overlays on every
delivery, and every invocation rechecks the live kill switch before executing. Specialist Workflows
load the current overlay when assembling their tools.

### 3.4 Delegation and workload routing

- Delegation is restricted to active team members and the team's `canDelegateTo` graph.
- The requested worker kind must match an active, entitled template instance in the same company.
- Idle eligible specialists are preferred; if all are busy, work is distributed among eligible
  instances.
- Each delegation creates a tracked ticket and an isolated `WorkerJobWorkflow` instance.
- Ticket and roster changes emit live team-status events.

### 3.5 Durable workflow lifecycle

1. Load the ticket, specialist instance, current template, model, prompt override, and live skills.
2. Generate the deliverable with up to five model/tool steps.
3. Resolve the template policy. Missing or invalid policies fail closed to `require-approval`.
4. For `require-approval`, create an action and wait for `decision:<actionId>` for up to 60 days.
5. Approve and deliver, reject and close, or regenerate with feedback for at most three revisions.

`auto-execute` and `notify-only` skip the blocking gate and deliver immediately. `notify-only` also
records an operator-facing notification event.

### 3.6 Memory, research, and assets

- Durable facts are stored in Postgres and semantic vectors use Workers AI (`bge-m3`) plus
  Vectorize when those bindings are configured.
- Local/test environments fall back to an in-memory semantic adapter.
- Image generation supports `1:1`, `16:9`, `4:3`, and `9:16`; the default product flow uses `1:1`.
- Agent-created and customer-uploaded assets live in R2 with Postgres metadata, tenant-scoped keys,
  SHA-256 deduplication, customer/agent visibility, and signed delivery URLs.
- Web research combines Exa search results with Firecrawl page extraction.

### 3.7 Proactive work suggestions

- A weekly cron scans active companies with complete briefs.
- Each eligible Correspondent suggests two or three concrete tasks for the coming week.
- A company receives at most one proactive suggestion per seven-day window.
- The sweep isolates failures per company and records successful suggestions in activity history.

## 4. Platform, security, and operations

### 4.1 Multi-tenant data and authorization

- Better Auth identities, organizations, memberships, and product data share Postgres through
  Prisma.
- Roles are `OWNER`, `STAFF`, and `CUSTOMER`; role and company membership gate every surface.
- Agent chat paths require a customer role and require the path company id to match the session.
- Customer writes are rejected for staff/owner sessions; operator writes use the backoffice router.
- Product queries and mutations are scoped by company id.
- New organizations can be provisioned through the authenticated API, which creates the matching
  company, Planner, Correspondent, owner membership, and template entitlements.

### 4.2 Storage and runtime

- **Postgres + Prisma**: authentication and product system of record.
- **Flue 2 Durable Objects**: persistent Planner and Correspondent conversations.
- **Cloudflare Workflows**: durable specialist execution, approval waits, and revisions.
- **R2**: private binary and text assets.
- **KV**: hashed session and membership relay caches; cache failures degrade to the auth service.
- **Workers AI + Vectorize**: production semantic memory.
- **OpenRouter**: configurable conversational, specialist, and image-generation models.

### 4.3 Reliability and security

- Durable chat submissions, replayable history, SSE reconnection, and polling fallback for roster
  state.
- Workflow waits survive Worker and Durable Object eviction.
- Session cache keys hash bearer tokens and cookies rather than storing credentials in keys.
- HMAC-signed expiring asset URLs, content-type protection, and sandboxed SVG responses.
- Explicit CORS origins, secure headers, request IDs, request-size limits, and API/auth rate limits.
- Constant-time comparison protects the shared secret used for internal company provisioning.
- Structured logs cover agent tools, model usage, delegation, Workflows, scheduling, API errors, and
  cache failures.
- `/healthz` endpoints support service health checks.

## 5. Implemented but not part of the default customer flow

| Capability                       | Current state                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auto-execute` and `notify-only` | Configurable in templates and implemented end to end; seeded templates still resolve to human approval.                                          |
| Approval from agent chat         | The `decideAction` skill exists, but no customer-facing agent receives it. Operators decide in the backoffice.                                   |
| Team re-planning                 | The Planner remains addressable after onboarding, but the customer UI has no re-plan entry point.                                                |
| Image aspect-ratio controls      | Four ratios are supported by the skill, but chat has no explicit ratio picker.                                                                   |
| Organization creation            | Authenticated API exists; there is no self-serve organization-creation screen.                                                                   |
| Customer-side specialist rename  | The company-scoped API supports renaming, but the customer UI currently exposes naming only while hiring. Operators can rename existing members. |

## 6. Explicitly not shipped

- WhatsApp, Gmail, Slack, Discord, or other external conversation channels.
- Direct Instagram, Facebook, LinkedIn, or other social publishing. Qolmeia produces drafts only.
- Calendar scheduling, Google Drive/Sheets, analytics, CRM, invoicing, or collection integrations.
- Customer-side approval controls; approvals are intentionally an internal operator responsibility.
- Separate production verticals beyond the seeded marketing specialists.

Those items are roadmap candidates in [`agent-tools.md`](agent-tools.md), not current features.

## 7. Main API capability map

| Audience          | Prefix                                         | Capabilities                                                                                            |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Public/auth       | `/api/auth/*`                                  | Magic links, email/password, verification, recovery, session management.                                |
| Authenticated API | `/api/orgs`                                    | Organization creation and product-company provisioning.                                                 |
| Customer          | `/api/me/*`                                    | Membership relay, company brief, templates/catalogue, team management/events, assets/uploads, activity. |
| Customer          | `/api/teams/*`                                 | Onboarding team confirmation.                                                                           |
| Customer          | `/agents/planner/*`, `/agents/correspondent/*` | Durable Flue 2 chat submission and observation.                                                         |
| Operator          | `/api/backoffice/*`                            | Tickets, approvals, decisions, activity, coverage, companies/teams, skills, and templates.              |
| Internal          | `/api/internal/*`                              | Shared-secret company and agent provisioning.                                                           |
| Signed asset      | `/assets/:id`                                  | Time-limited R2 asset delivery.                                                                         |
