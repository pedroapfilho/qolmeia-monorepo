import { createPrismaClient, type Prisma, type PrismaClient } from "@repo/db/worker";

type Database = PrismaClient | Prisma.TransactionClient;

const getDb = (env: Pick<Env, "DATABASE_URL">): PrismaClient =>
  createPrismaClient(env.DATABASE_URL);

export { getDb };
export type { Database };
