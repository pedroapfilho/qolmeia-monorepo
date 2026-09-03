import { log } from "@repo/observability";
import type { DecisionOutcome } from "@repo/worker-api/contracts";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import { generateDeliverable } from "#/jobs/worker-job-generate";
import {
  applyDecision,
  type DecisionEvent,
  type GenerateResult,
  type JobContext,
  logRevisionCapped,
  MAX_REVISIONS,
  proposeDeliverable,
  type ProposeResult,
} from "#/jobs/worker-job-steps";

type WorkerJobParams = {
  agentInstanceId: string;
  companyId: string;
  ticketId: string;
};

type WorkerJobResult =
  | { ok: true; summary: string }
  | { decision: DecisionOutcome; revisionCapped?: true; revisions: number; summary: string };

const isRevisionCapReached = (round: number, decision: DecisionOutcome): boolean =>
  decision === "changes_requested" && round >= MAX_REVISIONS;

class WorkerJobWorkflow extends WorkflowEntrypoint<Env, WorkerJobParams> {
  async run(
    event: Readonly<WorkflowEvent<WorkerJobParams>>,
    step: WorkflowStep,
  ): Promise<WorkerJobResult> {
    const { agentInstanceId, companyId, ticketId } = event.payload;
    const ctx: JobContext = { agentInstanceId, companyId, env: this.env, ticketId };
    const workflowStart = Date.now();

    log.info({ agentInstanceId, companyId, message: "workflow.start", ticketId });

    let revision = 0;
    let priorSummary: string | null = null;
    let latestFeedback: string | null = null;

    /* oxlint-disable react-doctor/async-await-in-loop */
    for (;;) {
      const round = revision;
      const priorForRound = priorSummary;
      const feedbackForRound = latestFeedback;

      const current = await step.do(`generate-${round}`, (): Promise<GenerateResult> =>
        generateDeliverable(ctx, round, priorForRound, feedbackForRound),
      );

      const proposed = await step.do(`propose-${round}`, (): Promise<ProposeResult> =>
        proposeDeliverable(ctx, round, feedbackForRound, current),
      );

      if (proposed.actionId === null || proposed.actionId === "") {
        log.info({
          agentInstanceId,
          companyId,
          durationMs: Date.now() - workflowStart,
          message: "workflow.done.nogate",
          policy: proposed.policy,
          ticketId,
        });
        return { ok: true, summary: current.summary };
      }

      const actionId = proposed.actionId;
      log.info({
        actionId,
        agentInstanceId,
        companyId,
        message: "workflow.waiting",
        revision: round,
        ticketId,
      });

      const evt = await step.waitForEvent<DecisionEvent>(`wait-${actionId}`, {
        timeout: "60 days",
        type: `decision:${actionId}`,
      });

      const decision = await step.do(`decide-${round}`, (): Promise<DecisionOutcome> =>
        applyDecision(ctx, actionId, current, evt.payload),
      );

      if (decision === "approved" || decision === "rejected") {
        log.info({
          agentInstanceId,
          companyId,
          decision,
          durationMs: Date.now() - workflowStart,
          message: "workflow.ok",
          revisions: round,
          ticketId,
        });
        return { decision, revisions: round, summary: current.summary };
      }

      priorSummary = current.summary;
      latestFeedback = evt.payload.feedback ?? null;
      revision = round + 1;

      if (isRevisionCapReached(round, decision)) {
        await step.do("revise-capped", () => logRevisionCapped(ctx, actionId));
        log.info({ companyId, message: "workflow.revise.capped", revision, ticketId });
        return { decision, revisionCapped: true, revisions: round, summary: current.summary };
      }
      log.info({ companyId, message: "workflow.revise", revision, ticketId });
    }
    /* oxlint-enable react-doctor/async-await-in-loop */
  }
}

export { buildRevisionMessages } from "#/jobs/worker-job-generate";
export { MAX_REVISIONS } from "#/jobs/worker-job-steps";
export { isRevisionCapReached, WorkerJobWorkflow };
export type { WorkerJobParams, WorkerJobResult };
