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

const syncTemplates = async (prisma: Pick<PrismaClient, "agentTemplate">): Promise<void> => {
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

export { ALL_TEMPLATES, findTemplateBySlug, syncTemplates };
