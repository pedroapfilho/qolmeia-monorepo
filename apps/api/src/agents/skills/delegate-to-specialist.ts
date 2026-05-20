import { z } from "zod";

import { logger } from "../../lib/logger";
import { findTemplateBySlug } from "../templates/registry";

import { defineSkill } from "./types";

const delegateToSpecialistInput = z.object({
  subtask: z.string().min(1).max(2000),
  targetTemplateSlug: z.string().min(1),
});

type DelegateToSpecialistInput = z.infer<typeof delegateToSpecialistInput>;

type DelegateToSpecialistOutput =
  | {
      generatedAssetIds: ReadonlyArray<string>;
      ok: true;
      text: string;
      usage: { inputTokens: number; outputTokens: number };
    }
  | { error: string; ok: false };

const delegateToSpecialistSkill = defineSkill<
  DelegateToSpecialistInput,
  DelegateToSpecialistOutput
>({
  description:
    "Delegue parte do trabalho para um agente especialista. Use quando a tarefa envolver expertise específica (design, marketing, atendimento). Passe o templateSlug do especialista e uma descrição clara do subtask em pt-BR.",
  displayName: "Delegate to Specialist",
  execute: async ({ subtask, targetTemplateSlug }, ctx) => {
    try {
      const parentTemplate = findTemplateBySlug(ctx.parentRunArgs.agentInstance.templateSlug);
      const targetTemplate = findTemplateBySlug(targetTemplateSlug);

      if (!parentTemplate || !parentTemplate.canDelegateTo.includes(targetTemplateSlug)) {
        const error = `Template ${ctx.parentRunArgs.agentInstance.templateSlug} cannot delegate to ${targetTemplateSlug}`;
        logger.error({ error, orgId: ctx.orgId }, "delegateToSpecialist.unauthorized");
        return { error, ok: false };
      }

      if (!targetTemplate) {
        const error = `Unknown template: ${targetTemplateSlug}`;
        logger.error({ error, orgId: ctx.orgId }, "delegateToSpecialist.unknown_template");
        return { error, ok: false };
      }

      const childAgent = await ctx.prisma.agentInstance.upsert({
        create: {
          displayName: targetTemplate.displayName,
          mission: "",
          orgId: ctx.orgId,
          templateSlug: targetTemplateSlug,
        },
        update: {},
        where: {
          orgId_templateSlug: { orgId: ctx.orgId, templateSlug: targetTemplateSlug },
        },
      });

      const childResult = await ctx.dispatcher.enqueueAndAwait({
        ...ctx.parentRunArgs,
        agentInstance: childAgent,
        input: {
          ...ctx.parentRunArgs.input,
          text: subtask,
        },
      });

      return {
        generatedAssetIds: childResult.generatedAssetIds,
        ok: true,
        text: childResult.text,
        usage: childResult.usage,
      };
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      logger.error({ error: message, orgId: ctx.orgId }, "delegateToSpecialist.failed");
      return { error: message, ok: false };
    }
  },
  id: "delegateToSpecialist",
  inputSchema: delegateToSpecialistInput,
  requiredConnectorTypes: [],
  requiresApprovalDefault: false,
});

export { delegateToSpecialistSkill };
export type { DelegateToSpecialistInput, DelegateToSpecialistOutput };
