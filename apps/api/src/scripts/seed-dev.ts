import "dotenv/config";

import { envAuthConfig } from "@repo/auth/env-config";
import { createAuth } from "@repo/auth/server";
import { prisma, seedProductDefaults } from "@repo/db";

import { env } from "../lib/env";

const ORG_ID = "cmpg10ke30000147uj4gpeadb";
const ORG_NAME = "Qolmeia Dev";
const ORG_SLUG = "qolmeia-dev";

const OWNER_EMAIL = "operator@qolmeia.dev";
const OWNER_NAME = "Operador Qolmeia";
const OWNER_PASSWORD = "Qolmeia-Dev-OperatorPass!";

const CUSTOMER_EMAIL = "customer@qolmeia.dev";
const CUSTOMER_NAME = "Cliente Demo";
const CUSTOMER_PASSWORD = "Qolmeia-Dev-CustomerPass!";

const auth = createAuth({
  ...envAuthConfig(),
  prisma,
  resendApiKey: env.RESEND_API_KEY,
  secret: env.BETTER_AUTH_SECRET,
});

const upsertOrg = async () => {
  const existing = await prisma.organization.findUnique({ where: { id: ORG_ID } });
  if (existing) {
    return existing;
  }
  return prisma.organization.create({
    data: {
      id: ORG_ID,
      name: ORG_NAME,
      slug: ORG_SLUG,
    },
  });
};

const upsertUser = async (
  email: string,
  name: string,
  password: string,
): Promise<{ created: boolean; userId: string }> => {
  const existing = await prisma.user.findUnique({
    select: { id: true },
    where: { email },
  });
  if (existing) {
    return { created: false, userId: existing.id };
  }
  const result = await auth.api.signUpEmail({ body: { email, name, password } });
  if (!result.user?.id) {
    throw new Error(`Better Auth signUpEmail returned no user id for ${email}`);
  }
  return { created: true, userId: result.user.id };
};

const upsertMembership = async (
  userId: string,
  role: "OWNER" | "STAFF" | "CUSTOMER",
): Promise<void> => {
  await prisma.orgMembership.upsert({
    create: { orgId: ORG_ID, role, userId },
    update: { role },
    where: { userId_orgId: { orgId: ORG_ID, userId } },
  });
};

const seedProductCompany = async (): Promise<void> => {
  await prisma.company.upsert({
    create: { id: ORG_ID, name: ORG_NAME, slug: ORG_SLUG, status: "active" },
    update: { name: ORG_NAME, slug: ORG_SLUG },
    where: { id: ORG_ID },
  });
  await seedProductDefaults(prisma);

  const correspondentId = `corr-${ORG_ID}`;
  const workerId = `worker-tpl-designer-${ORG_ID}`;
  const teamId = `team-${ORG_ID}`;
  await prisma.agentInstance.createMany({
    data: [
      {
        companyId: ORG_ID,
        displayName: "Correspondente Qolmeia",
        id: correspondentId,
        role: "correspondent",
      },
      {
        companyId: ORG_ID,
        displayName: "Designer",
        id: workerId,
        role: "worker",
        templateId: "tpl-designer",
        templateVersion: 1,
      },
    ],
    skipDuplicates: true,
  });
  await prisma.team.upsert({
    create: { companyId: ORG_ID, confirmedAt: new Date(), id: teamId },
    update: {},
    where: { companyId: ORG_ID },
  });
  await prisma.teamMember.upsert({
    create: { agentInstanceId: correspondentId, canDelegateTo: [workerId], teamId },
    update: { canDelegateTo: [workerId] },
    where: { teamId_agentInstanceId: { agentInstanceId: correspondentId, teamId } },
  });
  await prisma.teamMember.upsert({
    create: { agentInstanceId: workerId, canDelegateTo: [], teamId },
    update: {},
    where: { teamId_agentInstanceId: { agentInstanceId: workerId, teamId } },
  });
};

const main = async () => {
  const org = await upsertOrg();
  console.log(`Organization: ${org.id} (${org.slug})`);
  await seedProductCompany();
  console.log("  Product company, catalog, and demo team seeded with Prisma");

  const owner = await upsertUser(OWNER_EMAIL, OWNER_NAME, OWNER_PASSWORD);
  await upsertMembership(owner.userId, "OWNER");
  console.log(
    `  OWNER user:    ${OWNER_EMAIL}${owner.created ? ` (password: ${OWNER_PASSWORD})` : " (already existed)"}`,
  );

  const customer = await upsertUser(CUSTOMER_EMAIL, CUSTOMER_NAME, CUSTOMER_PASSWORD);
  await upsertMembership(customer.userId, "CUSTOMER");
  console.log(
    `  CUSTOMER user: ${CUSTOMER_EMAIL}${customer.created ? ` (password: ${CUSTOMER_PASSWORD})` : " (already existed)"}`,
  );
};

await main();
await prisma.$disconnect();
