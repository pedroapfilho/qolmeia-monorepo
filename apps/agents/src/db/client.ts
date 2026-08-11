import { createPrismaClient, type Prisma, type PrismaClient } from "@repo/db/worker";

type Database = PrismaClient | Prisma.TransactionClient;

const getDb = (env: Pick<Env, "DATABASE_URL" | "TEST_DATABASE_URL">): PrismaClient =>
  createPrismaClient(env.TEST_DATABASE_URL ?? env.DATABASE_URL);

export { getDb };
export type { Database };
