import type { PrismaClient } from "@repo/db";

import { controllerTemplate } from "./controller";
import { designerTemplate } from "./designer";
import type { AgentTemplateDefinition } from "./types";

const ALL_TEMPLATES: ReadonlyArray<AgentTemplateDefinition> = [
  controllerTemplate,
  designerTemplate,
];

const findTemplateBySlug = (slug: string): AgentTemplateDefinition | undefined =>
  ALL_TEMPLATES.find((t) => t.slug === slug);

const validateCanDelegateTo = (templates: ReadonlyArray<AgentTemplateDefinition>): void => {
  const adjacency = new Map<string, ReadonlyArray<string>>();
  for (const t of templates) {
    adjacency.set(t.slug, t.canDelegateTo);
  }

  // Reference integrity: every slug in canDelegateTo must exist in the registry.
  for (const t of templates) {
    for (const target of t.canDelegateTo) {
      if (!adjacency.has(target)) {
        throw new Error(`Template ${t.slug} delegates to unknown template: ${target}`);
      }
    }
  }

  // Cycle detection via DFS coloring (visited + onPath).
  const visited = new Set<string>();
  const onPath = new Set<string>();
  const visit = (slug: string, path: ReadonlyArray<string>): void => {
    if (onPath.has(slug)) {
      throw new Error(`Cycle in canDelegateTo: ${[...path, slug].join(" → ")}`);
    }
    if (visited.has(slug)) {
      return;
    }
    visited.add(slug);
    onPath.add(slug);
    for (const next of adjacency.get(slug) ?? []) {
      visit(next, [...path, slug]);
    }
    onPath.delete(slug);
  };

  for (const t of templates) {
    visit(t.slug, []);
  }
};

const syncTemplates = async (prisma: Pick<PrismaClient, "agentTemplate">): Promise<void> => {
  validateCanDelegateTo(ALL_TEMPLATES);
  await Promise.all(
    ALL_TEMPLATES.map((template) => {
      const baseFields = {
        canDelegateTo: [...template.canDelegateTo],
        compatibleInboundConnectorTypes: [...template.compatibleInboundConnectorTypes],
        compatibleOutboundConnectorTypes: [...template.compatibleOutboundConnectorTypes],
        defaultBudgetCents: template.defaultBudgetCents,
        defaultMission: template.defaultMission,
        defaultSystemPrompt: template.defaultSystemPrompt,
        description: template.description,
        displayName: template.displayName,
      };
      return prisma.agentTemplate.upsert({
        create: {
          ...baseFields,
          skills: { connect: template.defaultEnabledSkillIds.map((id) => ({ id })) },
          slug: template.slug,
        },
        update: {
          ...baseFields,
          skills: { set: template.defaultEnabledSkillIds.map((id) => ({ id })) },
        },
        where: { slug: template.slug },
      });
    }),
  );
};

export { ALL_TEMPLATES, findTemplateBySlug, syncTemplates, validateCanDelegateTo };
