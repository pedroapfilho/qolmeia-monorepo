# Operator approval gate runs on Cloudflare Workflows, not inside the agent

Every gated Worker job spawns a `WorkerJobWorkflow`. A `require-approval` action pauses on `step.waitForEvent("decision:<actionId>")` for up to ~60 days until an operator decides via `POST /api/backoffice/actions/:id/decide` (`instance.sendEvent`); the workflow then executes the side-effect and the Correspondent presents the result in chat.

**Decision:** keep the durable human-in-the-loop pause on Cloudflare Workflows rather than modelling it inside the conversational agent/DO turn loop. Workflows give a months-long, durable, resumable wait with no live connection held open; an agent turn loop has no equivalent durable pause. This boundary was re-affirmed when evaluating Flue (see [ADR-0004](./0004-flue-evaluated-and-rejected.md)): its bounded workflows expose no durable `waitForEvent`, so the gate stays on Cloudflare Workflows regardless of what runs the conversation.
