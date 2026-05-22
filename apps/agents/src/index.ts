import { CorrespondentAgent } from "@/agents/correspondent";

// Placeholder entry — the Hono router, agent routing, CORS, and the session
// gate land in T6. The DO class export must exist for the runtime binding.
export default {
  fetch: () => new Response("Not found", { status: 404 }),
} satisfies ExportedHandler<Env>;

export { CorrespondentAgent };
