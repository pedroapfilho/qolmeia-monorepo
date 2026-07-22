import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma-worker/client";
import { DEFAULT_SKILLS, DEFAULT_TEMPLATES } from "./product-seed";

const createPrismaClient = (connectionString: string): PrismaClient => {
  const schema = new URL(connectionString).searchParams.get("schema") ?? undefined;
  const adapter = new PrismaPg(
    { connectionString, options: schema ? `-c search_path=${schema}` : undefined },
    { schema },
  );
  return new PrismaClient({ adapter });
};

const seedProductDefaults = async (db: PrismaClient): Promise<void> => {
  await Promise.all(
    DEFAULT_TEMPLATES.map((template) =>
      db.agentTemplate.upsert({
        create: { ...template, skillIds: [...template.skillIds] },
        update: {},
        where: { id: template.id },
      }),
    ),
  );
  await Promise.all(
    DEFAULT_SKILLS.map((skill) =>
      db.skill.upsert({
        create: { ...skill, enabled: 1 },
        update: {},
        where: { id: skill.id },
      }),
    ),
  );
  const [companies, templates] = await Promise.all([
    db.company.findMany({ select: { id: true } }),
    db.agentTemplate.findMany({ select: { id: true }, where: { status: "active" } }),
  ]);
  await db.companyTemplateEntitlement.createMany({
    data: companies.flatMap(({ id: companyId }) =>
      templates.map(({ id: templateId }) => ({ companyId, templateId })),
    ),
    skipDuplicates: true,
  });
};

export * from "./generated/prisma-worker/client";
export { DEFAULT_SKILLS, DEFAULT_TEMPLATES } from "./product-seed";
export { createPrismaClient, seedProductDefaults };
