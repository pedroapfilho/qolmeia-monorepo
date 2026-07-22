import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const createPrismaClient = (): PrismaClient => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const schema = new URL(databaseUrl).searchParams.get("schema") ?? undefined;
  const adapter = new PrismaPg(
    { connectionString: databaseUrl, options: schema ? `-c search_path=${schema}` : undefined },
    { schema },
  );
  return new PrismaClient({ adapter });
};

const getPrismaClient = (): PrismaClient => {
  globalForPrisma.prisma ??= createPrismaClient();
  return globalForPrisma.prisma;
};

// Lazy so the module stays importable without DATABASE_URL (tests skip via
// describe.skipIf); the missing-env error surfaces on first query instead.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrismaClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? (value as CallableFunction).bind(client) : value;
  },
});

export * from "./generated/prisma/client";
