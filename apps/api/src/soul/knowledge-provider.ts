import { type PrismaClient, prisma as defaultPrisma } from "@repo/db";

/**
 * Seam #1: agent/bot code MUST call this instead of reading
 * Organization.businessProfile directly. v1 swaps the implementation to read
 * wiki markdown without touching callers.
 */
const getBusinessContext = async (
  orgId: string,
  client: Pick<PrismaClient, "organization"> = defaultPrisma,
): Promise<string> => {
  const org = await client.organization.findUnique({
    select: { businessProfile: true },
    where: { id: orgId },
  });

  const profile = org?.businessProfile;
  if (profile === null || profile === undefined) {
    return "";
  }

  return `# Business Context\n\n\`\`\`json\n${JSON.stringify(profile, null, 2)}\n\`\`\`\n`;
};

export { getBusinessContext };
