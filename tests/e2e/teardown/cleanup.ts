import { prisma } from "@repo/db";

// Best-effort cleanup of e2e residue. qolmeia's auth API has no user-delete
// endpoint (unlike acme's /api/v1/users/me), so the teardown goes straight at
// Postgres: Session/Account/OrgMembership cascade from User, so deleteMany on
// users is enough. auth-email specs mint one `delivered+…@resend.dev` user per
// spec per run; without this they accumulate forever.
const cleanup = async () => {
  if (!process.env.DATABASE_URL) {
    return;
  }

  try {
    const users = await prisma.user.deleteMany({
      where: {
        OR: [{ email: "e2e-test@qolmeia.localhost" }, { email: { endsWith: "@resend.dev" } }],
      },
    });
    const verifications = await prisma.verification.deleteMany({
      where: { identifier: { contains: "@resend.dev" } },
    });
    console.log(
      `[E2E Cleanup] Deleted ${users.count} user(s), ${verifications.count} verification(s)`,
    );
  } catch (error) {
    console.error("[E2E Cleanup] Failed to clean up:", error);
  } finally {
    await prisma.$disconnect();
  }
};

export default cleanup;
