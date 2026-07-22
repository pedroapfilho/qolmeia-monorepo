import { createPrismaClient, type Prisma, type PrismaClient } from "@repo/db/worker";

type Database = PrismaClient | Prisma.TransactionClient;

// Cloudflare requires database clients to be created inside the active request,
// scheduled event, agent turn, or Workflow execution context. Callers that make
// multiple queries should retain this client locally for that execution.
const getDb = (env: Pick<Env, "DATABASE_URL" | "TEST_DATABASE_URL">): PrismaClient =>
  createPrismaClient(env.TEST_DATABASE_URL ?? env.DATABASE_URL);

export { getDb };
export type { Database };
