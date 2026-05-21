import { z } from "zod";

import { logger } from "../../lib/logger";
import { ensureAgentInstance } from "../agent-instance";
import { buildContextSnapshot } from "../context-snapshot";
import { createAgentRun, finalizeAgentRun, hashSubtask } from "../runs";
import { findTemplateBySlug } from "../templates/registry";
import { renderSystemPrompt } from "../templates/renderer";

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

      const childAgent = await ensureAgentInstance({
        orgId: ctx.orgId,
        prisma: ctx.prisma,
        templateSlug: targetTemplateSlug,
      });

      // Rebuild the snapshot for the child — keeps the seam clean and
      // ensures the child run sees the businessProfile as of its own
      // dispatch time. We reuse parentRunArgs.existingAssets/newAssets so
      // the child sees the same asset window as the parent.
      const childSnapshot = await buildContextSnapshot({
        existingAssets: ctx.parentRunArgs.existingAssets,
        mission: childAgent.mission,
        newAssets: ctx.parentRunArgs.newAssets,
        orgId: ctx.orgId,
        oversizeCount: ctx.parentRunArgs.oversizeCount,
        prisma: ctx.prisma,
      });

      const baseSystem = renderSystemPrompt(targetTemplate.defaultSystemPrompt, {
        currentContext: childSnapshot.businessContext,
        existingAssets: childSnapshot.existingAssets,
        newAssets: childSnapshot.newAssets,
        oversizeCount: childSnapshot.oversizeCount,
      });
      const childSystemPrompt =
        childSnapshot.mission.length > 0
          ? `${baseSystem}\n\nMissão deste agente:\n${childSnapshot.mission}`
          : baseSystem;

      const childRun = await createAgentRun({
        agentInstanceId: childAgent.id,
        contextSnapshot: childSnapshot,
        parentRunId: ctx.parentRunId,
        prisma: ctx.prisma,
        systemPrompt: childSystemPrompt,
      });

      try {
        const childResult = await ctx.dispatcher.enqueueAndAwait({
          ...ctx.parentRunArgs,
          agentInstance: childAgent,
          // Override the parent's inbound dispatchOrigin so the child gets a
          // delegation coalesce key. Keyed by the parent's runId so identical
          // subtasks issued from the same parent run dedup against each other
          // and so two distinct delegations get distinct jobIds.
          dispatchOrigin: {
            childTemplateSlug: targetTemplateSlug,
            kind: "delegation",
            parentRunId: ctx.parentRunId,
            subtaskHash: hashSubtask(subtask),
          },
          input: {
            ...ctx.parentRunArgs.input,
            text: subtask,
          },
          runId: childRun.id,
          systemPrompt: childSystemPrompt,
        });

        await finalizeAgentRun({ prisma: ctx.prisma, result: childResult, runId: childRun.id });

        return {
          generatedAssetIds: childResult.generatedAssetIds,
          ok: true,
          text: childResult.text,
          usage: childResult.usage,
        };
      } catch (childError) {
        const err = childError instanceof Error ? childError : new Error(String(childError));
        await finalizeAgentRun({ error: err, prisma: ctx.prisma, runId: childRun.id }).catch(
          (error: unknown) => {
            logger.error({ error, runId: childRun.id }, "agentRun.finalize.failed");
          },
        );
        throw childError;
      }
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
