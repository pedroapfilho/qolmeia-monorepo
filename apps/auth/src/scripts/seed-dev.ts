import "dotenv/config";

import { createAuth } from "@repo/auth/server";
import { prisma } from "@repo/db";

import { env } from "../lib/env";

// E2E dev seed: spins up one Organization (id pinned to match the D1 dev
// seed in apps/agents/scripts/seed-p2.sql), one OWNER user for the
// backoffice, and one CUSTOMER user for the client app. Idempotent — safe
// to re-run.
//
// After running, also run:
//   pnpm --filter=worker-bees wrangler d1 execute worker-bees \
//     --local --file scripts/seed-p2.sql
//
// then start the four dev processes:
//   pnpm dev --filter=auth         (port 4000)
//   pnpm dev --filter=worker-bees  (port 8787 via wrangler dev)
//   pnpm dev --filter=client       (port 3001)
//   pnpm dev --filter=backoffice   (port 3000)
//
// Credentials (printed on creation):
//   OWNER:    operator@qolmeia.dev / Qolmeia-Dev-OperatorPass!
//   CUSTOMER: customer@qolmeia.dev / Qolmeia-Dev-CustomerPass!

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

const main = async () => {
  const org = await upsertOrg();
  console.log(`Organization: ${org.id} (${org.slug})`);

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

  console.log("");
  console.log("Next: seed the D1 company row + Correspondent agent_instance:");
  console.log(
    "  pnpm --filter=worker-bees wrangler d1 execute worker-bees --local --file scripts/seed-p2.sql",
  );
};

await main();
await prisma.$disconnect();
