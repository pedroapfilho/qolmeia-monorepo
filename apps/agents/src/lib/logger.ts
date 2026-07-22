type Level = "info" | "warn" | "error";

type LogPayload = Record<string, unknown>;

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

const logInfo = (event: string, payload: LogPayload = {}): void => {
  emit("info", event, payload);
};
const logError = (event: string, payload: LogPayload = {}): void => {
  emit("error", event, payload);
};

export { logError, logInfo };
export type { LogPayload };
