import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client";

// oxlint-disable-next-line no-unsafe-type-assertion -- canonical Prisma singleton: globalThis carries no typed slot for the cached client
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

export const prisma = new Proxy(
  // oxlint-disable-next-line no-unsafe-type-assertion -- Proxy target is never read; every access is routed through the get trap
  {} as PrismaClient,
  {
    get(_target, prop) {
      const client = getPrismaClient();
      const value: unknown = Reflect.get(client, prop, client);
      // oxlint-disable-next-line no-unsafe-return -- Function.prototype.bind is typed `any`; the trap forwards whatever the client exposes
      return typeof value === "function" ? value.bind(client) : value;
    },
  },
);

export * from "./generated/prisma/client";
