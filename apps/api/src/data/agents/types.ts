import type { Prisma, PrismaClient } from "@repo/db";
import { z } from "zod";

type Database = PrismaClient | Prisma.TransactionClient;
type JsonValue = z.infer<typeof jsonValueSchema>;
type JsonRecord = z.infer<typeof jsonRecordSchema>;

const jsonValueSchema = z.json();
const jsonRecordSchema = z.record(z.string(), jsonValueSchema);

const nullableJsonRecord = (value: Prisma.JsonValue): JsonRecord | null => {
  const parsed = jsonRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

class AgentDataError extends Error {
  code: string;
  status: 400 | 404 | 409 | 500;

  constructor(code: string, message: string, status: 400 | 404 | 409 | 500) {
    super(message);
    this.code = code;
    this.name = "AgentDataError";
    this.status = status;
  }
}

export { AgentDataError, jsonRecordSchema, jsonValueSchema, nullableJsonRecord };
export type { Database, JsonRecord, JsonValue };
