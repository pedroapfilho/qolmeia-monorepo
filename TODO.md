# TODO

Open work items, ordered by leverage. Each top-level entry is a PR-sized slice.

## 1. Update the architecture review (closing deliverable)

`docs/architecture/2026-05-26-post-p7-review.md` describes the post-P7.1 system. Since then the following has shipped and the doc is stale:

- **P7.2 cutover** — `apps/api` renamed to `apps/auth`; legacy `connectors/`, `inbox/`, `agents/`, `workers/`, `routines/`, OpenRouter wiring, BullMQ deps all deleted. Prisma schema pruned to Better Auth + `Organization` + `OrgMembership`. Redis removed from `docker-compose.yml`.
- **Org-create hook** — `POST /api/v1/orgs` on `apps/auth` creates the Postgres `Organization` + `OrgMembership` row, then relays to `apps/agents` `POST /api/internal/companies` (gated by `INTERNAL_SHARED_SECRET`) to provision the D1 `company` + Correspondent + Planner `agent_instance` rows. Replaces the hand-rolled `seed-dev.ts` seed.
- **60s session KV cache** — `apps/agents/src/lib/auth.ts → validateSession` memoises `/api/v1/me` in a new `SESSIONS` KV namespace keyed on bearer token (or hash of cookie). Same KV namespace caches the `/api/me` relay in `routes/me.ts`. Takes Better Auth's per-IP 100/15min rate limit off the page-render hot path. Responses carry `X-Cache: hit|miss`.
- **Structured agent observability** — `apps/agents/src/lib/logger.ts` emits single-line JSON via `console.log`. Workers Logs (already enabled via `observability.enabled`) indexes top-level fields. Hooked at: `agent.turn.start/ok`, `agent.tool.start/ok/err` (auto-wrapped in the skill registry), `agent.connector.start/ok/err`, `agent.presentAction`, `workflow.start/generate.start/generate.ok/propose.ok/waiting/decision.received/ok`.
- **Image-gen fix** — `generateBrandImage` now uses OpenRouter's `/api/v1/chat/completions` with `modalities: ["image","text"]` (the dedicated `/images/generations` endpoint doesn't exist on OpenRouter). Default model `google/gemini-2.5-flash-image`; Pro and 3.1-flash are hot-swap alternates via `IMAGE_GEN_MODEL`. Response is a `data:image/png;base64,…` URL on `choices[0].message.images[0].image_url.url`.
- **Redirect-loop fix** — `requireStaff` / `requireCustomer` no longer catch-and-redirect to `/login` on transient `/api/me` failures (the cause of `ERR_TOO_MANY_REDIRECTS` when the auth service rate-limited). 401/403 still redirect; everything else throws so Next renders the error boundary.
- **Streamdown img override** — markdown `![alt](url)` rendered by the Correspondent no longer creates a `<div>`-inside-`<p>` hydration error; `<MessageResponse>` passes a `components.img` override that emits a plain `<img>`.
- **Second action type — `publish_post`** — migration `0004_p8_marketing_strategist.sql` adds `default_action_type` column to `template`. `WorkerJobWorkflow.run` reads it to drive `proposeAction(actionType)`. Marketing Strategist template seeded with `default_action_type = 'publish_post'`. New `draftSocialPost` skill emits structured `{platform, body, callToAction, hashtags, tone}`. Workflow captures `result.steps[].toolResults` into `proposed.draft` for typed renderers (stringified at the `step.do` boundary because `Serializable<T>` rejects `unknown`). Backoffice has a new `components/action-renderers/` registry; `PublishPostCard` shows the draft as a real card.
- **API casing normalization** — bare `GET /api/backoffice/actions` (no query) and `GET /api/backoffice/tickets` previously returned raw snake_case rows while `?status=pending&sort=age` returned camelCase via the mapper. Both list endpoints now pipe through the typed mapper (`mapActionRow`, `mapTicketListItem` via a new `listTickets` helper in `db/ticket.ts`). The backoffice never sees raw column names.
- **Correspondent multimodal** — the DO now reads `<img>` parts from incoming `UIMessage`s, extracts them into `AttachedImage[]`, and `buildModelMessages` swaps the last user turn for a multi-part `text + image` payload so the vision-capable model can see them. `POST /api/me/uploads` accepts file uploads (≤10MB, PNG/JPEG/WebP/GIF), dedups by sha256, and returns a signed asset URL the client can drop into the prompt. Custom oxlint override on `correspondent.ts` raises the max-lines limit to 500 (the class concentrates three coherent paths — web chat, connector webhook, memory seed — and splitting hurts readability more than the line count does).
- **Architecture review refactors** — five deepenings landed off the post-P8 architecture review (`/tmp/architecture-review-…html`). C5: `safeJson` consolidated from six call sites into one `db/mappers.ts` helper; `mapAction` + `listActions` + `listActionsForTicket` exported from `db/action.ts` so `routes/backoffice.ts` never reads raw `ActionRow` shapes. C2: KV-cache plumbing (sha256 + key-build + read/write) lifted into `lib/session-cache.ts`; `validateSession` + `/api/me` relay both compose. C3: `activity_log` event types are now a discriminated `ActivityEvent` union in `activity/types.ts` with exhaustive `eventCategory`; `logActivity` constrains `(type, refType, payload)` triplets at compile time. C4: `/api/me/assets` + `/api/me/uploads` split into `routes/me-assets.ts` (the multi-step upload transaction was the cleavage point). C1: Correspondent's web-chat + connector-inbound paths now compose with one `prepareConversationTurn` primitive; the SSRF-guard image resolver lives in `agents/asset-url-resolver.ts`.

The §14 "next move" list in the existing doc has been completed. Rewrite the doc post-P8 — same single-read intent, new state.

## 2. Error boundaries on the Next apps

`requireStaff` / `requireCustomer` now throw on transient `/api/me` failures instead of redirecting (see redirect-loop fix above). Without an `error.tsx` at the route segment, the user sees Next's stock "Application error" page.

Action: add `apps/backoffice/src/app/(dashboard)/error.tsx` and `apps/client/src/app/(client)/error.tsx` with a friendly retry UI ("Connection to the auth service hiccuped — refresh in a moment") plus a `reset()` button.

## 3. Customer-side `decideAction` E2E

The Correspondent's `decideAction` skill is wired into its system prompt and the tool registry, but only the **operator** path is tested end-to-end (`scripts/e2e-chat-flow.mjs`, `scripts/e2e-marketing-flow.mjs`). The customer-side path — "the user types 'aprovado' in the chat, the model maps it to `decision: approved`, the workflow resumes" — has no test.

Action: add `scripts/e2e-customer-decide.mjs` that triggers a `worker_deliverable` proposal, then sends "aprovado" as the next user turn via WS, then polls `/api/backoffice/actions` until the action is `executed`.

## 4. Onboarding / Planner E2E

`apps/agents/scripts/seed-p2.sql` sets `company.status = 'active'` so the Planner is never exercised in the dev seed. The flow exists (`apps/agents/src/agents/planner.ts`, `apps/agents/src/routes/teams.ts → POST /api/teams/:companyId/confirm`) but no test proves the full status-driven routing.

Action:

- Add `scripts/e2e-onboarding-flow.mjs` that flips a test company to `status='onboarding'`, opens a WS to the Planner, runs a debrief, confirms a team, then verifies (a) the status flipped to `active` (b) the Correspondent has its memory seeded with the brief facts (c) a Correspondent chat works.

## 5. §11 product gaps from the prior arch review

Each of these is a separate PR.

- **WhatsApp / Slack / Discord adapters** — placeholders in `apps/agents/src/connectors/`. WhatsApp is the highest-value: Meta Cloud API webhook + outbound. The Telegram adapter is the model to copy.
- **Telegram outbound `sendPhoto`** — outbound is text-only today. Adding image outbound means the Designer's results round-trip to a Telegram bot conversation too, not just the web chat.
- **Multi-org switcher** — `requireAnyMember` / `requireStaff` resolve `currentOrg` via `prisma.orgMembership.findFirst` ordered by `createdAt asc`, which is nondeterministic for a multi-membership user. Better Auth's organization plugin supports `setActiveOrganization`; wire it through and add a switcher to the backoffice sidebar + client nav.
- **Activity-log payload renderer registry** — mirror of the `action-renderers` registry. Each `activity_log.type` gets an optional per-type renderer for the payload; unknown types fall back to the JSON dump.

## 6. Smaller cleanup

- **Pinned trigger — third action type:** the `proposed.draft` extraction in `WorkerJobWorkflow.run` is a hard-coded `if (actionType === "publish_post")` reading the `draftSocialPost` skill result. **When a third structured action type is added (e.g. `send_email` reading `draftEmail`, `schedule_meeting` reading `draftMeeting`), do this refactor as part of that PR:**
  1. Add an `ACTION_TYPE_DRAFT_SKILL: Record<string, string>` constant near the top of `worker-job.ts` (e.g. `{ publish_post: "draftSocialPost", send_email: "draftEmail" }`).
  2. Replace the `if (actionType === "publish_post" && draft !== undefined)` branch with a lookup against this record. The Workflow body stops branching per action type.
  3. Mirror the same record in `apps/backoffice/src/components/action-renderers/index.tsx` so the renderer registry is config-only too.
     Rationale for waiting: with one structured action type today, the abstraction (~30 LOC + a type) costs more than the one-line `if`. Two types is the inflection point — three guarantees the pattern.
- The slug validator (`isValidSlug` / `SLUG_CHARS`) is still duplicated between `apps/agents/src/routes/internal.ts` and `apps/auth/src/routes/v1/orgs.ts`. Cross-app, so it needs a shared package (probably `@repo/shared-validation`). Low priority — the duplication is ~15 LOC and both apps already cite the rationale.
