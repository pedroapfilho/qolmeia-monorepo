// Prisma's Json columns can't store functions (the SDK's attachments carry a
// `fetchData` AsyncFunction). Walk the value and strip anything not
// JSON-representable.
const toJsonSafe = (value: unknown): unknown => {
  if (value === null) {
    return null;
  }
  if (value === undefined || typeof value === "function") {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((v) => toJsonSafe(v)).filter((v) => v !== undefined);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const cleaned = toJsonSafe(v);
      if (cleaned !== undefined) {
        out[k] = cleaned;
      }
    }
    return out;
  }
  return value;
};

export { toJsonSafe };
