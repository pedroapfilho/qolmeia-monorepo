import type { PrismaClient } from "@repo/db";

import { logActivity } from "../activity/log";
import { ensureAgentInstance } from "../agents/agent-instance";
import { buildContextSnapshot } from "../agents/context-snapshot";
import type { AgentDispatcher } from "../agents/dispatcher";
import { createAgentRun, finalizeAgentRun } from "../agents/runs";
import { findTemplateBySlug } from "../agents/templates/registry";
import { renderSystemPrompt } from "../agents/templates/renderer";
import { logger } from "../lib/logger";

import { findRoutineByName } from "./registry";

type ExecutorPrisma = Pick<
  PrismaClient,
  "activityLog" | "agentInstance" | "agentRun" | "knowledgeDoc" | "organization" | "routine"
>;

type ExecuteRoutineArgs = {
  dispatcher: AgentDispatcher;
  prisma: ExecutorPrisma;
  routineId: string;
};

type ExecuteRoutineOutcome = {
  agentRunId: string | null;
  status: "FAILED" | "SUCCEEDED";
};

// Runs one fire of a routine: load the DB row + the code definition, build
// the prompt, dispatch through the agent runtime (same path as inbound
// messages but with a synthetic text input and a null triggerMessageId),
// then update lastRunAt/lastRunStatus.
//
// Errors during prompt-build or dispatch are caught and recorded — the
// worker NEVER throws back to BullMQ here, because routine failures are
// owner-visible via lastRunStatus and the ActivityLog instead of via
// queue retries (which would compound a flaky downstream).
const executeRoutine = async (args: ExecuteRoutineArgs): Promise<ExecuteRoutineOutcome> => {
  const { dispatcher, prisma, routineId } = args;

  const routine = await prisma.routine.findUnique({
    select: {
      agentInstanceId: true,
      config: true,
      enabled: true,
      id: true,
      name: true,
      orgId: true,
    },
    where: { id: routineId },
  });

  if (!routine) {
    logger.warn({ routineId }, "routines.execute.missing_routine");
    return { agentRunId: null, status: "FAILED" };
  }

  if (!routine.enabled) {
    // Disabled mid-flight: bail without a run. The reconciler will pick
    // this up on its next pass and remove the scheduler.
    logger.info({ routineId }, "routines.execute.skipped_disabled");
    return { agentRunId: null, status: "FAILED" };
  }

  const definition = findRoutineByName(routine.name);
  if (!definition) {
    logger.error({ name: routine.name, routineId }, "routines.execute.unknown_definition");
    await prisma.routine.update({
      data: { lastRunAt: new Date(), lastRunStatus: "FAILED" },
      where: { id: routine.id },
    });
    return { agentRunId: null, status: "FAILED" };
  }

  // Always-on activity event so the owner-facing timeline knows the routine
  // fired even when the agent itself blows up downstream.
  await logActivity({
    orgId: routine.orgId,
    payload: { name: routine.name, routineId: routine.id },
    prisma,
    refId: routine.id,
    refType: "ROUTINE",
    summary: `Rotina ${routine.name} disparada`,
    type: "ROUTINE_TRIGGERED",
  });

  try {
    const agentInstance = await ensureAgentInstance({
      orgId: routine.orgId,
      prisma,
      templateSlug: definition.defaultAgentTemplate,
    });

    const template = findTemplateBySlug(agentInstance.templateSlug);
    if (!template) {
      throw new Error(`Unknown agent template: ${agentInstance.templateSlug}`);
    }

    const promptText = await definition.buildPrompt(
      (routine.config ?? {}) as Record<string, unknown>,
      { orgId: routine.orgId, prisma },
    );

    const contextSnapshot = await buildContextSnapshot({
      existingAssets: [],
      mission: agentInstance.mission,
      newAssets: [],
      orgId: routine.orgId,
      oversizeCount: 0,
      prisma,
    });

    const baseSystem = renderSystemPrompt(template.defaultSystemPrompt, {
      currentContext: contextSnapshot.businessContext,
      existingAssets: contextSnapshot.existingAssets,
      newAssets: contextSnapshot.newAssets,
      oversizeCount: contextSnapshot.oversizeCount,
    });
    const systemPrompt =
      contextSnapshot.mission.length > 0
        ? `${baseSystem}\n\nMissão deste agente:\n${contextSnapshot.mission}`
        : baseSystem;

    const activityContext = {
      agentDisplayName: agentInstance.displayName,
      orgId: routine.orgId,
      templateSlug: agentInstance.templateSlug,
    };

    const run = await createAgentRun({
      activityContext,
      agentInstanceId: agentInstance.id,
      contextSnapshot,
      prisma,
      systemPrompt,
      // No inbound Message — this is a scheduled invocation.
      triggerMessageId: null,
    });

    try {
      const result = await dispatcher.enqueueAndAwait({
        agentInstance,
        dispatcher,
        existingAssets: [],
        input: { imageBytes: [], text: promptText },
        newAssets: [],
        oversizeCount: 0,
        prisma: prisma as PrismaClient,
        runId: run.id,
        // Scheduled runs have no inbound connector — senderRole is null so
        // the approval rule treats every drafted action as auto-approve-eligible
        // (the rule keys off CUSTOMER specifically).
        senderRole: null,
        systemPrompt,
      });

      await finalizeAgentRun({ activityContext, prisma, result, runId: run.id });
      await prisma.routine.update({
        data: { lastRunAt: new Date(), lastRunStatus: "SUCCEEDED" },
        where: { id: routine.id },
      });
      return { agentRunId: run.id, status: "SUCCEEDED" };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await finalizeAgentRun({ activityContext, error: err, prisma, runId: run.id }).catch(
        (finalizeError: unknown) => {
          logger.error({ error: finalizeError, runId: run.id }, "routines.finalize.failed");
        },
      );
      await prisma.routine.update({
        data: { lastRunAt: new Date(), lastRunStatus: "FAILED" },
        where: { id: routine.id },
      });
      return { agentRunId: run.id, status: "FAILED" };
    }
  } catch (error) {
    logger.error({ error, routineId: routine.id }, "routines.execute.failed");
    await prisma.routine.update({
      data: { lastRunAt: new Date(), lastRunStatus: "FAILED" },
      where: { id: routine.id },
    });
    return { agentRunId: null, status: "FAILED" };
  }
};

export { executeRoutine };
export type { ExecuteRoutineArgs, ExecuteRoutineOutcome, ExecutorPrisma };
