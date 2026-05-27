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
const logWarn = (event: string, payload: LogPayload = {}): void => emit("warn", event, payload);
const logError = (event: string, payload: LogPayload = {}): void => emit("error", event, payload);

// Wraps an async block in a try/catch + duration measurement. Emits a
// `<event>.start`, `<event>.ok`, and on throw a `<event>.err` line —
// rethrowing so the caller's control flow doesn't change.
const withSpan = async <T>(
  event: string,
  payload: LogPayload,
  fn: () => Promise<T>,
): Promise<T> => {
  const start = Date.now();
  logInfo(`${event}.start`, payload);
  try {
    const result = await fn();
    logInfo(`${event}.ok`, { ...payload, durationMs: Date.now() - start });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`${event}.err`, { ...payload, durationMs: Date.now() - start, error: message });
    throw error;
  }
};

export { logError, logInfo, logWarn, withSpan };
export type { LogPayload };
