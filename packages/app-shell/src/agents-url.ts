/**
 * Server-side reads go straight to the Worker; NEXT_PUBLIC_AGENTS_URL only wins
 * for a cross-origin production Worker, where there is no internal address.
 */
const AGENTS_SERVER_URL =
  process.env.AGENTS_INTERNAL_URL ?? process.env.NEXT_PUBLIC_AGENTS_URL ?? "http://127.0.0.1:8787";

export { AGENTS_SERVER_URL };
