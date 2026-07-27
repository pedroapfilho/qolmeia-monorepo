import { z } from "zod";

const recordSchema = z.record(z.string(), z.unknown());

// JSON columns and JSON.parse results arrive as `unknown`. Falling back to an empty record
// instead of throwing keeps a malformed payload from failing the whole job: callers read
// optional fields off the result and already handle them being absent.
const toRecord = (value: unknown): Record<string, unknown> => {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
};

export { toRecord };
