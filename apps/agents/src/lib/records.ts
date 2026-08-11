import { z } from "zod";

const recordSchema = z.record(z.string(), z.unknown());

const toRecord = (value: unknown): Record<string, unknown> => {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
};

export { toRecord };
