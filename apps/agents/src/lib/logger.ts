// Structured logger for the agent loop. Every call lands as a single
// `console.log(JSON.stringify({...}))` so:
//   - `wrangler tail` shows one line per event (easy grep)
//   - Cloudflare Workers Observability (already enabled in wrangler.jsonc
//     via `"observability": { "enabled": true }`) indexes each top-level
//     JSON field — query with `event:"agent.tool" companyId:"<id>"`.
//
// We log success paths, not just errors. The point is "tail the worker and
// see what the agent is doing right now." Error-only logging produces the
// surprise: a chat happens but the tail is empty.

type Level = "info" | "warn" | "error";

type LogPayload = Record<string, unknown>;

// Truncate any string field that could be huge (LLM completions, full
// prompts). Keeps log payloads in the bytes-per-line range rather than
// KB-per-line, which matters for Workers Observability ingestion.
const MAX_STRING_LEN = 500;

const truncate = (value: unknown): unknown => {
  if (typeof value === "string" && value.length > MAX_STRING_LEN) {
    return `${value.slice(0, MAX_STRING_LEN)}…[+${value.length - MAX_STRING_LEN}]`;
  }
  return value;
};

const truncatePayload = (payload: LogPayload): LogPayload => {
  const out: LogPayload = {};
  for (const [key, value] of Object.entries(payload)) {
    out[key] = truncate(value);
  }
  return out;
};

const emit = (level: Level, event: string, payload: LogPayload): void => {
  const line = {
    event,
    level,
    timestamp: new Date().toISOString(),
    ...truncatePayload(payload),
  };
  const serialised = JSON.stringify(line);
  if (level === "error") {
    // oxlint-disable-next-line no-console
    console.error(serialised);
    return;
  }
  if (level === "warn") {
    // oxlint-disable-next-line no-console
    console.warn(serialised);
    return;
  }
  // oxlint-disable-next-line no-console
  console.log(serialised);
};

const logInfo = (event: string, payload: LogPayload = {}): void => emit("info", event, payload);
const logError = (event: string, payload: LogPayload = {}): void => emit("error", event, payload);

export { logError, logInfo };
export type { LogPayload };
