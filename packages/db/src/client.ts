import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client";

// SAFETY: globalThis has no typed slot for Prisma's process-wide singleton.
// oxlint-disable-next-line no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const createPrismaClient = (): PrismaClient => {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("DATABASE_URL is required");
  }
  const schema = new URL(databaseUrl).searchParams.get("schema") ?? undefined;
  const adapter = new PrismaPg(
    {
      connectionString: databaseUrl,
      options: schema === undefined || schema === "" ? undefined : `-c search_path=${schema}`,
    },
    { schema },
  );
  return new PrismaClient({ adapter });
};

const getPrismaClient = (): PrismaClient => {
  globalForPrisma.prisma ??= createPrismaClient();
  return globalForPrisma.prisma;
};

const isPrismaClientKey = (client: PrismaClient, key: PropertyKey): key is keyof PrismaClient =>
  key in client;

export const prisma = new Proxy(
  // SAFETY: The proxy target is never read because every access runs through get.
  // oxlint-disable-next-line no-unsafe-type-assertion
  {} as PrismaClient,
  {
    get(_target, prop) {
      const client = getPrismaClient();
      if (!isPrismaClientKey(client, prop)) {
        return undefined;
      }
      const value: unknown = client[prop];
      // oxlint-disable-next-line no-unsafe-return -- Function.prototype.bind is typed `any`; the trap forwards whatever the client exposes
      return typeof value === "function" ? value.bind(client) : value;
    },
  },
);

export * from "./generated/prisma/client";
