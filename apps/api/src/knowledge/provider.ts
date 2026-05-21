import { type PrismaClient, prisma as defaultPrisma } from "@repo/db";

const serializeBusinessProfile = (profile: unknown): string | null => {
  if (profile === null || profile === undefined) {
    return null;
  }
  return `# Business Context\n\n\`\`\`json\n${JSON.stringify(profile, null, 2)}\n\`\`\`\n`;
};

/**
 * Seam #1: agent/bot code MUST call this instead of reading
 * Organization.businessProfile, agentInstructions, or businessIdea directly.
 *
 * Returns owner-curated sections BEFORE the AI-extracted soul so they take
 * precedence in the agent's attention. Mirrors Paperclip's plugin-llm-wiki
 * AGENTS.md + IDEA.md reserved files.
 */
const getBusinessContext = async (
  orgId: string,
  client: Pick<PrismaClient, "organization"> = defaultPrisma,
): Promise<string> => {
  const org = await client.organization.findUnique({
    select: { agentInstructions: true, businessIdea: true, businessProfile: true },
    where: { id: orgId },
  });

  if (!org) {
    return "";
  }

  const sections: Array<string> = [];

  if (org.businessIdea !== null && org.businessIdea !== undefined) {
    sections.push(`## Ideia do negócio (definida pelo dono)\n\n${org.businessIdea}`);
  }
  if (org.agentInstructions !== null && org.agentInstructions !== undefined) {
    sections.push(
      `## Instruções para a equipe de IA (definidas pelo dono)\n\n${org.agentInstructions}`,
    );
  }

  const profileSection = serializeBusinessProfile(org.businessProfile);
  if (profileSection !== null) {
    sections.push(profileSection);
  }

  return sections.join("\n\n");
};

export { getBusinessContext };
