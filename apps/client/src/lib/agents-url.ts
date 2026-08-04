// Its own module so api-server can depend on auth-helpers for the active org
// without the two importing each other.
const AGENTS_SERVER_URL =
  process.env.AGENTS_INTERNAL_URL ?? process.env.NEXT_PUBLIC_AGENTS_URL ?? "http://127.0.0.1:8787";

export { AGENTS_SERVER_URL };
