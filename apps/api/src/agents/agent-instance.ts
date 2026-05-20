import type { AgentInstance, PrismaClient } from "@repo/db";

import { findTemplateBySlug } from "./templates/registry";

// Ensures an AgentInstance exists for (orgId, templateSlug). Uses the
// in-code template registry to derive displayName, so callers never need
// to know it. Throws if the template isn't registered — fail-fast prevents
// orphaned AgentInstance rows pointing at a missing template.
const ensureAgentInstance = (args: {
  orgId: string;
  prisma: Pick<PrismaClient, "agentInstance">;
  templateSlug: string;
}): Promise<AgentInstance> => {
  const template = findTemplateBySlug(args.templateSlug);
  if (!template) {
    throw new Error(`Cannot ensure AgentInstance: unknown template "${args.templateSlug}"`);
  }
  return args.prisma.agentInstance.upsert({
    create: {
      displayName: template.displayName,
      mission: "",
      orgId: args.orgId,
      templateSlug: args.templateSlug,
    },
    update: {},
    where: {
      orgId_templateSlug: { orgId: args.orgId, templateSlug: args.templateSlug },
    },
  });
};

export { ensureAgentInstance };
