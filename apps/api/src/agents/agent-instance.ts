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

type InboundAgentLookupResult =
  | { agentInstance: AgentInstance; kind: "found" }
  | { candidateTemplateSlugs: ReadonlyArray<string>; kind: "ambiguous" }
  | { kind: "none" };

// Resolves the AgentInstance that should handle inbound messages for a
// ConnectorInstance via AgentConnectorBinding (Phase 5 §7). Replaces the
// hard-coded "controller" lookup. v0 expects exactly one binding per
// ConnectorInstance in direction INBOUND/BOTH; zero or multiple bindings
// surface as `none` / `ambiguous` so the caller can fail closed and log.
const findInboundAgentInstanceForConnector = async (args: {
  connectorInstanceId: string;
  prisma: Pick<PrismaClient, "agentConnectorBinding">;
}): Promise<InboundAgentLookupResult> => {
  const bindings = await args.prisma.agentConnectorBinding.findMany({
    include: { agentInstance: true },
    where: {
      connectorInstanceId: args.connectorInstanceId,
      direction: { in: ["INBOUND", "BOTH"] },
    },
  });

  const [first, ...rest] = bindings;
  if (!first) {
    return { kind: "none" };
  }
  if (rest.length > 0) {
    return {
      candidateTemplateSlugs: bindings.map((b) => b.agentInstance.templateSlug),
      kind: "ambiguous",
    };
  }
  return { agentInstance: first.agentInstance, kind: "found" };
};

export { ensureAgentInstance, findInboundAgentInstanceForConnector };
export type { InboundAgentLookupResult };
