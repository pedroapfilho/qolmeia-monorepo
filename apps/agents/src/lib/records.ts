import { z } from "zod";

const recordSchema = z.record(z.string(), z.json());
type RecordInput = Parameters<typeof recordSchema.safeParse>[0];

const toRecord = (value: RecordInput) => {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
};

export { toRecord };
