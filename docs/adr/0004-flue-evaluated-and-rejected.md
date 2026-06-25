# Evaluated and rejected the Flue agent framework

> **⚠️ SUPERSEDED (2026-06).** This decision was reversed: `apps/agents` is now **fully migrated to Flue**, and the legacy `agents`-SDK `AIChatAgent` Durable Objects have been removed. Flue reached `1.0.0-beta.2` with a durable HTTP+SSE story, the client transport was rewritten onto `@flue/sdk`, and the approval Workflow + `scheduled()` cron were kept on Cloudflare exactly as this ADR anticipated. The concerns below (entry ownership, transport rewrite, beta risk) were accepted and resolved during the migration. See [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) §6 for the current design. The record below is retained as the original rationale.

We evaluated migrating `apps/agents` onto the Flue "agent harness" framework (withastro/flue, 1.0-beta) to make the agents autonomous, including a Phase-0 spike against the real packages and its bundled docs.

**Decision:** stay on the current Cloudflare-native stack (`agents` SDK Durable Objects + Cloudflare Workflows). Flue would take over the Worker entry (`flue build` owns the build, via a generated `app.ts`/`cloudflare.ts`), force a client transport rewrite (Flue agents are HTTP + Durable Streams; our client speaks the `agents` WebSocket), and put the live runtime on a 1.0-beta API, all while delivering ~no net autonomy. The genuinely autonomous parts (the approval Workflow's durable wait and the async result push) must stay on Cloudflare regardless, and Flue ships no scheduler. Proactive autonomy was instead built directly as a Worker `scheduled()` cron (the weekly "suggest next work" sweep).

## Note

The research first flagged a hard `agents`-SDK version conflict; the spike disproved it: Flue's Cloudflare DOs extend the same `agents` `Agent` base we already use. The rejection rests on entry ownership, transport rewrite, beta risk, and autonomy ROI, not a dependency conflict. Re-open only if Flue reaches a stable release AND offers a durable human-in-the-loop pause + a WebSocket-compatible client transport.
